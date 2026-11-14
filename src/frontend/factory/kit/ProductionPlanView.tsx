"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { api, fmtDate, fmtQty, vnToday } from "../api";
import { Button, Card, Empty, ErrorNote, inputClass, StatusBadge, Table } from "../ui";

export const TEAM_LEAD_PRESETS = [
  "Nguyễn Cao Mỹ Anh (NV-ABT-039 · Trưởng nhóm Sản xuất tách chiết)",
  "Nguyễn Thị Tuyết Nhi (NV-ABT-042 · Trưởng nhóm Sản xuất mix)",
  "Đặng Thị Thanh Mai (NV-ABT-044 · Nhân viên sản xuất)",
];

export const QA_STAFF_PRESETS = [
  "Phan Thị Thảo Trinh (NV-ABT-059 · Phó Trưởng phòng QC-QA)",
  "Nguyễn Thị Thông (NV-ABT-060 · Nhân viên QC)",
  "Bạch Ngọc Mai (NV-ABT-061 · Nhân viên QC)",
  "Nguyễn Ngọc Yến Nhi (NV-ABT-062 · Nhân viên QC)",
  "Phan Yến Ngọc (NV-ABT-063 · Nhân viên QC)",
  "Huỳnh Thị Kim Anh (NV-ABT-064 · Nhân viên QC)",
  "Lâm Kiều Mi (NV-ABT-065 · Nhân viên QC)",
  "Ngụy Thảo Ngân (NV-ABT-066 · Nhân viên ISO)",
];

type PlanStep = {
  id: string;
  seq: number;
  step_code: string;
  step_name: string;
  status: string;
  is_qc: boolean;
  qc_gate_status: string | null;
  assigned_to_name: string | null;
  qa_assignee_name: string | null;
  started_at: string | null;
  completed_at: string | null;
};

type PlanOrder = {
  id: string;
  code: string;
  status: string;
  priority: string;
  planned_qty: number;
  uom: string;
  planned_start_date: string | null;
  planned_end_date: string | null;
  team_lead_name: string | null;
  qa_assignee_name: string | null;
  plan_note: string | null;
  product_code: string;
  product_name: string;
  lot_code: string | null;
  internal_order_code: string | null;
  kd_po_code: string | null;
  po_committed_date: string | null;
  steps: PlanStep[];
};

type DeptStaffItem = {
  user_id: number;
  employee_code?: string;
  full_name: string;
  display_name?: string;
  position: string;
  label: string;
  is_lead: boolean;
};

type PlanResponse = {
  orders: PlanOrder[];
  unplanned_po_lines: any[];
  kit_staff?: DeptStaffItem[];
  qa_staff?: DeptStaffItem[];
  can_plan: boolean;
  can_assign_qa: boolean;
};

const todayStr = () => vnToday();
const isDoneStatus = (s: string) => s === "DONE" || s === "SKIPPED";

function daysBetween(a: string, b: string) {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000);
}

/** Phân loại trạng thái hiển thị của một công đoạn (có xét khóa bởi bước QC xen kẽ phía trước). */
function stepVisual(step: PlanStep, steps: PlanStep[]) {
  if (isDoneStatus(step.status)) {
    return { key: "DONE", icon: "✓", label: "Đã hoàn tất", cls: "bg-emerald-500 text-white border-emerald-600" };
  }
  if (step.status === "FAILED" || step.qc_gate_status === "REJECTED") {
    return { key: "FAILED", icon: "✕", label: "Lỗi / QC từ chối", cls: "bg-rose-500 text-white border-rose-600" };
  }
  const allPrevDone = steps.filter((p) => p.seq < step.seq).every((p) => isDoneStatus(p.status));
  if (step.is_qc && step.qc_gate_status === "WAITING_QC" && (step.status !== "PENDING" || allPrevDone)) {
    return { key: "WAITING_QC", icon: "🛡️", label: "Chờ QC xác nhận thông qua", cls: "bg-amber-400 text-amber-950 border-amber-500" };
  }
  if (step.status === "IN_PROGRESS" || step.status === "AWAITING_CHECK") {
    return {
      key: "RUNNING",
      icon: step.is_qc ? "🛡️" : "",
      label: step.status === "AWAITING_CHECK" ? "Chờ ký kiểm tra chéo" : "Đang thực hiện",
      cls: "bg-sky-500 text-white border-sky-600",
    };
  }
  const locked = steps.some((p) => p.seq < step.seq && p.is_qc && p.qc_gate_status !== "PASSED");
  if (locked) {
    return {
      key: "LOCKED",
      icon: "🔒",
      label: "Đang khóa — chờ bước QC xen kẽ trước",
      cls: "bg-slate-100 text-slate-400 border-slate-200 dark:bg-slate-800/70 dark:text-slate-500 dark:border-slate-700",
    };
  }
  if (step.is_qc && step.qc_gate_status === "WAITING_QC") {
    return {
      key: "QC_PENDING",
      icon: "🛡️",
      label: "Cổng QC xen kẽ (chưa đến lượt)",
      cls: "bg-amber-50 text-amber-800 border-amber-300 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800",
    };
  }
  return {
    key: "PENDING",
    icon: step.is_qc ? "🛡️" : "",
    label: "Chưa bắt đầu",
    cls: "bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700",
  };
}

export function ProductionPlanView({
  mode,
  onOpenOrder,
  onPlanFromPo,
  onCreateOrder,
}: {
  /** LEAD: Trưởng nhóm sản xuất lập & theo dõi kế hoạch · QA: Phòng QA/QC phân bổ nhân viên giám sát */
  mode: "LEAD" | "QA";
  onOpenOrder?: (orderId: string) => void;
  onPlanFromPo?: (poLineId: string) => void;
  /** Opens the "Phát hành lệnh sản xuất" form (a plan is a production order with leader and planned dates). */
  onCreateOrder?: () => void;
}) {
  const [data, setData] = useState<PlanResponse | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"ALL" | "LATE" | "NO_QA" | "ACTIVE">(mode === "QA" ? "NO_QA" : "ACTIVE");
  const [editingId, setEditingId] = useState<string>("");
  const [form, setForm] = useState({ planned_start_date: "", planned_end_date: "", team_lead_name: "", plan_note: "", qa_assignee_name: "" });
  const [qaDraft, setQaDraft] = useState<Record<string, string>>({});
  const [showUnplanned, setShowUnplanned] = useState(false);
  const [showStageSummary, setShowStageSummary] = useState(true);
  const [saving, setSaving] = useState(false);
  const [expandedStepsIds, setExpandedStepsIds] = useState<Record<string, boolean>>({});
  const [hoveredStep, setHoveredStep] = useState<{ orderId: string; stepId: string } | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await api<PlanResponse>("/api/factory/kit/plan"));
    } catch (e) {
      setError(e);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const today = todayStr();
  const orders = data?.orders ?? [];
  const unplanned = data?.unplanned_po_lines ?? [];
  const teamLeadOptions = useMemo(() => {
    const fromDb = (data?.kit_staff ?? []).map((s) => s.label);
    return fromDb.length > 0 ? fromDb : TEAM_LEAD_PRESETS;
  }, [data?.kit_staff]);
  const qaStaffOptions = useMemo(() => {
    const fromDb = (data?.qa_staff ?? []).map((s) => s.label);
    return fromDb.length > 0 ? fromDb : QA_STAFF_PRESETS;
  }, [data?.qa_staff]);

  const isLate = (o: PlanOrder) => Boolean(o.planned_end_date && o.planned_end_date < today && o.status !== "COMPLETED");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return orders.filter((o) => {
      if (filter === "LATE" && !isLate(o)) return false;
      if (filter === "NO_QA" && (o.qa_assignee_name || o.status === "COMPLETED")) return false;
      if (filter === "ACTIVE" && o.status === "COMPLETED") return false;
      if (q) {
        const hay = `${o.code} ${o.product_code} ${o.product_name} ${o.lot_code ?? ""} ${o.kd_po_code ?? ""} ${o.team_lead_name ?? ""} ${o.qa_assignee_name ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders, filter, search, today]);

  const activeOrders = orders.filter((o) => o.status !== "COMPLETED");
  const lateCount = activeOrders.filter(isLate).length;
  const noQaCount = activeOrders.filter((o) => !o.qa_assignee_name).length;

  // Tổng hợp tiến độ theo công đoạn của quy trình (gộp theo tên công đoạn trên các lệnh đang chạy)
  const stageSummary = useMemo(() => {
    const map = new Map<string, { seq: number; name: string; is_qc: boolean; total: number; done: number; running: number; waitingQc: number; failed: number; pending: number; orders: string[] }>();
    for (const o of activeOrders) {
      for (const s of o.steps) {
        const key = s.step_code || s.step_name;
        const cur = map.get(key) ?? { seq: s.seq, name: s.step_name, is_qc: s.is_qc, total: 0, done: 0, running: 0, waitingQc: 0, failed: 0, pending: 0, orders: [] };
        const v = stepVisual(s, o.steps).key;
        cur.total += 1;
        if (v === "DONE") cur.done += 1;
        else if (v === "RUNNING") {
          cur.running += 1;
          cur.orders.push(o.code);
        } else if (v === "WAITING_QC") {
          cur.waitingQc += 1;
          cur.orders.push(o.code);
        } else if (v === "FAILED") {
          cur.failed += 1;
          cur.orders.push(o.code);
        } else cur.pending += 1;
        map.set(key, cur);
      }
    }
    return Array.from(map.values()).sort((a, b) => a.seq - b.seq);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders]);

  const startEdit = (o: PlanOrder) => {
    setEditingId(o.id);
    setForm({
      planned_start_date: o.planned_start_date?.slice(0, 10) ?? today,
      planned_end_date: o.planned_end_date?.slice(0, 10) ?? today,
      team_lead_name: o.team_lead_name ?? teamLeadOptions[0] ?? "",
      plan_note: o.plan_note ?? "",
      qa_assignee_name: o.qa_assignee_name ?? "",
    });
  };

  const savePlan = async (orderId: string, payload: Record<string, unknown>) => {
    setError(null);
    setSaving(true);
    try {
      await api(`/api/factory/kit/orders/${orderId}`, { method: "POST", json: { operation: "update_plan", ...payload } });
      setEditingId("");
      await load();
    } catch (e) {
      setError(e);
    } finally {
      setSaving(false);
    }
  };

  const canPlan = Boolean(data?.can_plan) && mode === "LEAD";
  const canAssignQa = Boolean(data?.can_assign_qa);

  return (
    <div className="space-y-4">
      <ErrorNote error={error} />

      {/* Chỉ số tổng quan kế hoạch */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Lệnh sản xuất đang thực hiện theo kế hoạch" value={`${activeOrders.length} lệnh`} tone="sky" onClick={() => setFilter("ACTIVE")} />
        <Kpi label="⏰ Lệnh trễ so với ngày kết thúc kế hoạch" value={`${lateCount} lệnh`} tone={lateCount ? "rose" : "emerald"} onClick={() => setFilter("LATE")} />
        <Kpi label="🛡️ Lệnh chưa được phân công QA giám sát" value={`${noQaCount} lệnh`} tone={noQaCount ? "amber" : "emerald"} onClick={() => setFilter("NO_QA")} />
        <Kpi
          label="📥 Dòng PO Kit chưa lập kế hoạch sản xuất"
          value={`${unplanned.length} dòng PO`}
          tone={unplanned.length ? "indigo" : "emerald"}
          onClick={() => setShowUnplanned(true)}
        />
      </div>

      {/* PO chưa lập kế hoạch — thu gọn mặc định */}
      {mode === "LEAD" && unplanned.length > 0 && (
        <Card
          title={`📥 Đơn PO Kinh doanh chưa lập kế hoạch sản xuất (${unplanned.length})`}
          actions={
            <Button variant="ghost" onClick={() => setShowUnplanned((v) => !v)}>
              {showUnplanned ? "Thu gọn" : "Mở danh sách"}
            </Button>
          }
        >
          {showUnplanned ? (
            <Table head={["Đơn PO / Đơn nội bộ", "Sản phẩm Kit", "SL cần sản xuất", "Hạn giao cam kết", "Thao tác"]}>
              {unplanned.map((p) => {
                const remain = Math.max(0, Number(p.qty || 0) - Number(p.qty_delivered || 0));
                const due = p.committed_date || p.requested_date;
                const dLeft = due ? daysBetween(today, due) : null;
                return (
                  <tr key={p.line_id}>
                    <td className="px-3 py-2 text-xs">
                      <div className="font-bold text-indigo-700 dark:text-indigo-300">📦 PO {p.kd_po_code}</div>
                      <div className="text-[11px] text-slate-500 font-mono">
                        {p.internal_order_code} · <StatusBadge status={p.po_status} />
                      </div>
                    </td>
                    <td className="px-3 py-2 text-xs">
                      <span className="font-mono font-semibold">{p.item_code}</span> — {p.item_name}
                    </td>
                    <td className="px-3 py-2 text-xs font-mono font-bold">
                      {fmtQty(remain)} {p.uom}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {due ? (
                        <span className={dLeft != null && dLeft < 3 ? "text-rose-700 font-bold" : ""}>
                          {fmtDate(due)} {dLeft != null && `(${dLeft >= 0 ? `còn ${dLeft} ngày` : `quá ${-dLeft} ngày`})`}
                        </span>
                      ) : (
                        "Chưa có"
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {canPlan && onPlanFromPo ? (
                        <Button
                          title="Mở form Phát hành Lệnh sản xuất Kit đã điền sẵn sản phẩm & số lượng theo dòng PO này để lập kế hoạch"
                          onClick={() => onPlanFromPo(p.line_id)}
                        >
                          📅 Lập kế hoạch &amp; Phát lệnh
                        </Button>
                      ) : (
                        <span className="text-slate-400">Chờ Trưởng nhóm lập kế hoạch</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </Table>
          ) : (
            <div className="text-xs text-slate-500">
              Có {unplanned.length} dòng PO chưa có lệnh sản xuất. Bấm &ldquo;Mở danh sách&rdquo; để lập kế hoạch.
            </div>
          )}
        </Card>
      )}

      {/* Bảng kế hoạch chính */}
      <Card
        title={
          mode === "QA"
            ? `🛡️ Phân công Nhân viên QA Giám sát Quá trình Sản xuất Kit (${filtered.length} lệnh)`
            : `🗓️ Kế hoạch Sản xuất theo PO & Tiến độ Công đoạn (${filtered.length} lệnh)`
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <select className={`${inputClass} !w-52 !py-1 text-xs`} value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
              <option value="ACTIVE">Lệnh đang thực hiện</option>
              <option value="LATE">⏰ Chỉ lệnh trễ kế hoạch</option>
              <option value="NO_QA">🛡️ Chỉ lệnh chưa phân công QA</option>
              <option value="ALL">Tất cả (gồm đã hoàn tất)</option>
            </select>
            <input
              className={`${inputClass} !w-56 !py-1 text-xs`}
              placeholder="Tìm PO, lệnh, lô, trưởng nhóm, QA..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {canPlan && onCreateOrder && (
              <Button title="Lập kế hoạch mới: phát hành lệnh sản xuất Kit (chọn dòng PO hoặc nhập sản phẩm, số lượng, trưởng nhóm, ngày bắt đầu / kết thúc)" onClick={onCreateOrder}>
                + Lập kế hoạch / Phát lệnh
              </Button>
            )}
            <Button variant="ghost" title="Tải lại dữ liệu kế hoạch và tiến độ mới nhất" onClick={load}>
              ↻ Làm mới
            </Button>
          </div>
        }
      >
        {!data ? (
          <div className="text-xs text-slate-400 p-4">Đang tải kế hoạch…</div>
        ) : filtered.length === 0 ? (
          <Empty>Không có lệnh sản xuất nào khớp bộ lọc hiện tại.</Empty>
        ) : (
          <Table
            head={[
              "Đơn PO / Lệnh SX / Lô",
              "Kế hoạch (Trưởng nhóm)",
              "QA phụ trách giám sát",
              "Tiến độ theo công đoạn quy trình",
              "Thao tác",
            ]}
          >
            {filtered.map((o) => {
              const total = o.steps.length;
              const done = o.steps.filter((s) => isDoneStatus(s.status)).length;
              const pct = total ? Math.round((done / total) * 100) : 0;
              const current = o.steps.find((s) => !isDoneStatus(s.status));
              const late = isLate(o);
              const dLeft = o.planned_end_date ? daysBetween(today, o.planned_end_date.slice(0, 10)) : null;
              // Tiến độ kỳ vọng theo thời gian kế hoạch (để so với tiến độ thực tế)
              let expectedPct: number | null = null;
              if (o.planned_start_date && o.planned_end_date) {
                const span = Math.max(1, daysBetween(o.planned_start_date.slice(0, 10), o.planned_end_date.slice(0, 10)) + 1);
                const elapsed = daysBetween(o.planned_start_date.slice(0, 10), today) + 1;
                expectedPct = Math.min(100, Math.max(0, Math.round((elapsed / span) * 100)));
              }
              const behind = expectedPct != null && o.status !== "COMPLETED" && pct + 15 < expectedPct;
              const isEditing = editingId === o.id;

              return (
                <React.Fragment key={o.id}>
                  <tr className={late ? "bg-rose-50/50 dark:bg-rose-950/20" : ""}>
                    <td className="px-3 py-2 text-xs align-top">
                      {o.kd_po_code ? (
                        <div className="font-bold text-indigo-700 dark:text-indigo-300">📦 PO {o.kd_po_code}</div>
                      ) : (
                        <div className="text-[11px] text-slate-400">Lệnh độc lập (không gắn PO)</div>
                      )}
                      <div className="font-mono font-semibold text-sky-700 dark:text-sky-400">
                        {o.code} · <StatusBadge status={o.status} />
                      </div>
                      <div className="text-[11px] text-slate-600 dark:text-slate-300">
                        {o.product_code} · Lô <b className="font-mono">{o.lot_code ?? "chưa cấp"}</b> · {fmtQty(o.planned_qty)} {o.uom}
                      </div>
                      {o.po_committed_date && <div className="text-[11px] text-slate-500">Hạn giao PO: {fmtDate(o.po_committed_date)}</div>}
                    </td>
                    <td className="px-3 py-2 text-xs align-top space-y-0.5">
                      <div className="font-semibold">👤 {o.team_lead_name ?? "Chưa có trưởng nhóm"}</div>
                      <div>
                        {o.planned_start_date ? fmtDate(o.planned_start_date) : "?"} → {o.planned_end_date ? fmtDate(o.planned_end_date) : "?"}
                      </div>
                      {o.status !== "COMPLETED" && dLeft != null && (
                        <div className={late ? "text-rose-700 font-bold" : dLeft <= 1 ? "text-amber-700 font-semibold" : "text-slate-500"}>
                          {late ? `⏰ Trễ ${-dLeft} ngày` : dLeft === 0 ? "Hạn kết thúc hôm nay" : `Còn ${dLeft} ngày`}
                        </div>
                      )}
                      {o.plan_note && <div className="text-[11px] text-slate-500 italic">📝 {o.plan_note}</div>}
                    </td>
                    <td className="px-3 py-2 text-xs align-top">
                      {canAssignQa && o.status !== "COMPLETED" ? (
                        <div className="space-y-1">
                          <input
                            list={`qa-staff-${o.id}`}
                            className={`${inputClass} !py-1 text-xs ${!o.qa_assignee_name ? "border-amber-400" : ""}`}
                            placeholder="Chọn nhân viên QA..."
                            value={qaDraft[o.id] ?? o.qa_assignee_name ?? ""}
                            onChange={(e) => setQaDraft((p) => ({ ...p, [o.id]: e.target.value }))}
                          />
                          <datalist id={`qa-staff-${o.id}`}>
                            {qaStaffOptions.map((n) => (
                              <option key={n} value={n} />
                            ))}
                          </datalist>
                          {(qaDraft[o.id] ?? o.qa_assignee_name ?? "") !== (o.qa_assignee_name ?? "") && (
                            <Button
                              variant="secondary"
                              disabled={saving}
                              title="Lưu phân công nhân viên QA giám sát lệnh này; nhân viên QA sẽ được gán vào mọi bước QC xen kẽ (IPQC) và nhận thông báo"
                              onClick={() => savePlan(o.id, { qa_assignee_name: qaDraft[o.id] ?? "" })}
                            >
                              🛡️ Lưu phân công QA
                            </Button>
                          )}
                        </div>
                      ) : o.qa_assignee_name ? (
                        <div className="font-semibold text-emerald-800 dark:text-emerald-300">🛡️ {o.qa_assignee_name}</div>
                      ) : (
                        <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-900 font-bold text-[10px]">Chưa phân công QA</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs align-top min-w-[260px] max-w-[400px]">
                      {total === 0 ? (
                        <span className="text-slate-400">Chưa xác nhận lệnh — chưa sinh công đoạn</span>
                      ) : (() => {
                        const isStepsExpanded = Boolean(expandedStepsIds[o.id]);
                        const hoveredStepObj =
                          hoveredStep?.orderId === o.id
                            ? o.steps.find((x) => x.id === hoveredStep.stepId) ?? null
                            : null;
                        const toggleExpandSteps = () =>
                          setExpandedStepsIds((p) => ({ ...p, [o.id]: !p[o.id] }));

                        return (
                          <div className="space-y-1.5">
                            <div className="flex items-start justify-between gap-2">
                              <div
                                className="flex flex-wrap items-center gap-y-1"
                                onMouseLeave={() =>
                                  setHoveredStep((prev) => (prev?.orderId === o.id ? null : prev))
                                }
                              >
                                {o.steps.map((s, idx) => {
                                  const v = stepVisual(s, o.steps);
                                  const prevDone = idx > 0 && isDoneStatus(o.steps[idx - 1].status);
                                  const isHovered = hoveredStep?.orderId === o.id && hoveredStep.stepId === s.id;
                                  return (
                                    <React.Fragment key={s.id}>
                                      {idx > 0 && (
                                        <span
                                          aria-hidden="true"
                                          className={`w-2 h-0.5 shrink-0 ${
                                            prevDone ? "bg-emerald-500" : "bg-slate-200 dark:bg-slate-700"
                                          }`}
                                        />
                                      )}
                                      <button
                                        type="button"
                                        onMouseEnter={() => setHoveredStep({ orderId: o.id, stepId: s.id })}
                                        onFocus={() => setHoveredStep({ orderId: o.id, stepId: s.id })}
                                        onClick={toggleExpandSteps}
                                        title={`Bước #${s.seq}: ${s.step_name}\nTrạng thái: ${v.label}\nNhân viên: ${s.assigned_to_name ?? "Chưa phân công"}${
                                          s.is_qc
                                            ? `\nQA phụ trách: ${s.qa_assignee_name ?? o.qa_assignee_name ?? "Chưa phân công"}`
                                            : ""
                                        }`}
                                        className={`h-6 px-1.5 rounded-md border text-[10px] font-mono font-bold inline-flex items-center gap-0.5 transition-all cursor-pointer shrink-0 ${v.cls} ${
                                          current?.id === s.id
                                            ? "ring-2 ring-sky-600 ring-offset-1 dark:ring-offset-slate-900"
                                            : ""
                                        } ${isHovered ? "ring-1 ring-slate-400" : ""}`}
                                      >
                                        {v.icon && <span>{v.icon}</span>}
                                        <span>{s.seq}</span>
                                      </button>
                                    </React.Fragment>
                                  );
                                })}
                              </div>
                              <div className="flex items-center gap-1.5 shrink-0 pt-0.5">
                                <span className="font-mono font-bold text-[11px] text-slate-700 dark:text-slate-200">
                                  {done}/{total} ({pct}%)
                                </span>
                                <button
                                  type="button"
                                  onClick={toggleExpandSteps}
                                  title={
                                    isStepsExpanded ? "Thu gọn danh sách công đoạn" : "Xem đầy đủ tên các bước công đoạn"
                                  }
                                  className="px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-[10px] font-semibold text-slate-600 dark:text-slate-300 cursor-pointer"
                                >
                                  {isStepsExpanded ? "Ẩn ▴" : "Chi tiết ▾"}
                                </button>
                              </div>
                            </div>

                            <div className="relative h-1.5 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                              <div className="h-full bg-emerald-600 transition-all" style={{ width: `${pct}%` }} />
                              {expectedPct != null && o.status !== "COMPLETED" && (
                                <div
                                  title={`Tiến độ kỳ vọng theo thời gian kế hoạch: ${expectedPct}%`}
                                  className="absolute top-0 h-full w-0.5 bg-rose-600"
                                  style={{ left: `${expectedPct}%` }}
                                />
                              )}
                            </div>

                            {hoveredStepObj ? (
                              <div
                                className="text-[11px] text-sky-800 dark:text-sky-300 truncate"
                                title={`Bước #${hoveredStepObj.seq}: ${hoveredStepObj.step_name}`}
                              >
                                🔎 <b>Bước #{hoveredStepObj.seq}:</b> {hoveredStepObj.step_name}{" "}
                                <span className="text-slate-500 dark:text-slate-400">
                                  ({stepVisual(hoveredStepObj, o.steps).label})
                                </span>
                              </div>
                            ) : current ? (
                              <div
                                className="text-[11px] text-slate-600 dark:text-slate-300 truncate"
                                title={`Đang ở Bước #${current.seq}: ${current.step_name}${current.assigned_to_name ? ` — ${current.assigned_to_name}` : ""}`}
                              >
                                ▶ Đang ở <b>#{current.seq}:</b> {current.step_name}
                                {current.assigned_to_name ? ` — ${current.assigned_to_name}` : ""}
                              </div>
                            ) : (
                              <div className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
                                ✅ Đã hoàn tất {total}/{total} công đoạn
                              </div>
                            )}

                            {behind && (
                              <div className="text-[11px] font-bold text-rose-700">
                                ⚠️ Chậm tiến độ: thực tế {pct}% so với kỳ vọng {expectedPct}%
                              </div>
                            )}

                            {isStepsExpanded && (
                              <div className="mt-1 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-900/50 p-1.5 space-y-1">
                                {o.steps.map((s) => {
                                  const v = stepVisual(s, o.steps);
                                  const assignee = s.is_qc
                                    ? s.qa_assignee_name ?? o.qa_assignee_name
                                    : s.assigned_to_name;
                                  return (
                                    <div
                                      key={s.id}
                                      className={`flex items-start justify-between gap-2 text-[11px] px-1.5 py-1 rounded ${
                                        current?.id === s.id ? "bg-sky-50/80 dark:bg-sky-950/30" : ""
                                      }`}
                                    >
                                      <div className="flex items-start gap-1.5 min-w-0">
                                        <span
                                          className={`px-1.5 py-0.5 rounded border font-mono text-[10px] font-bold shrink-0 ${v.cls}`}
                                        >
                                          {v.icon}#{s.seq}
                                        </span>
                                        <span className="font-medium text-slate-800 dark:text-slate-200 break-words">
                                          {s.step_name}
                                        </span>
                                      </div>
                                      <div className="text-[10px] text-right shrink-0 text-slate-500 dark:text-slate-400">
                                        <div>{v.label}</div>
                                        {assignee && (
                                          <div className="text-slate-400 dark:text-slate-500 truncate max-w-[140px]">
                                            {assignee}
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </td>
                    <td className="px-3 py-2 text-xs align-top">
                      <div className="flex flex-col gap-1">
                        {canPlan && o.status !== "COMPLETED" && (
                          <Button
                            variant={isEditing ? "secondary" : "ghost"}
                            title="Điều chỉnh ngày bắt đầu/kết thúc kế hoạch, trưởng nhóm phụ trách và ghi chú kế hoạch"
                            onClick={() => (isEditing ? setEditingId("") : startEdit(o))}
                          >
                            {isEditing ? "Đóng sửa" : "✏️ Sửa kế hoạch"}
                          </Button>
                        )}
                        {onOpenOrder && (
                          <Button
                            variant="ghost"
                            title="Mở chi tiết Hồ sơ lô điện tử (EBR) của lệnh để phân công nhân viên từng bước và thực hiện công đoạn"
                            onClick={() => onOpenOrder(o.id)}
                          >
                            🔎 Mở Hồ sơ Lô (EBR)
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                  {isEditing && (
                    <tr>
                      <td colSpan={5} className="px-3 py-2">
                        <form
                          className="grid grid-cols-1 md:grid-cols-12 gap-2 items-end p-2.5 rounded-lg border border-sky-200 dark:border-sky-900 bg-sky-50/60 dark:bg-sky-950/30"
                          onSubmit={(e) => {
                            e.preventDefault();
                            savePlan(o.id, form);
                          }}
                        >
                          <label className="md:col-span-2 text-[11px] font-semibold space-y-0.5">
                            <span>Ngày bắt đầu kế hoạch</span>
                            <input type="date" className={inputClass} value={form.planned_start_date} onChange={(e) => setForm({ ...form, planned_start_date: e.target.value })} required />
                          </label>
                          <label className="md:col-span-2 text-[11px] font-semibold space-y-0.5">
                            <span>Ngày kết thúc kế hoạch</span>
                            <input type="date" className={inputClass} value={form.planned_end_date} onChange={(e) => setForm({ ...form, planned_end_date: e.target.value })} required />
                          </label>
                          <label className="md:col-span-3 text-[11px] font-semibold space-y-0.5">
                            <span>Trưởng nhóm phụ trách</span>
                            <input list={`lead-${o.id}`} className={inputClass} value={form.team_lead_name} onChange={(e) => setForm({ ...form, team_lead_name: e.target.value })} />
                            <datalist id={`lead-${o.id}`}>
                              {teamLeadOptions.map((n) => (
                                <option key={n} value={n} />
                              ))}
                            </datalist>
                          </label>
                          <label className="md:col-span-3 text-[11px] font-semibold space-y-0.5">
                            <span>Ghi chú kế hoạch</span>
                            <input className={inputClass} placeholder="VD: Ưu tiên chạy trước PO khách bệnh viện..." value={form.plan_note} onChange={(e) => setForm({ ...form, plan_note: e.target.value })} />
                          </label>
                          <div className="md:col-span-2 flex gap-1.5">
                            <Button type="submit" disabled={saving} title="Lưu kế hoạch sản xuất của lệnh này">
                              💾 Lưu kế hoạch
                            </Button>
                          </div>
                        </form>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </Table>
        )}
        <div className="mt-2 flex flex-wrap gap-2 text-[10px] text-slate-500">
          <Legend cls="bg-emerald-500" label="✓ Đã hoàn tất" />
          <Legend cls="bg-sky-500" label="Đang thực hiện / Chờ ký kiểm tra chéo" />
          <Legend cls="bg-amber-400" label="🛡️ Bước QC xen kẽ chờ QC xác nhận thông qua" />
          <Legend cls="bg-amber-50 border border-amber-300" label="🛡️ Cổng QC (chưa đến lượt)" />
          <Legend cls="bg-rose-500" label="✕ Lỗi / QC từ chối" />
          <Legend cls="bg-slate-200 border border-slate-300" label="🔒 Đang khóa chờ QC / Chưa bắt đầu" />
          <span className="flex items-center gap-1">
            <span className="inline-block w-0.5 h-3 bg-rose-600" /> Vạch đỏ = tiến độ kỳ vọng theo kế hoạch
          </span>
          <span className="text-slate-400 dark:text-slate-500">
            · Rê chuột lên số bước để xem nhanh, bấm &ldquo;Chi tiết ▾&rdquo; để mở đầy đủ
          </span>
        </div>
      </Card>

      {/* Tiến độ tổng hợp theo công đoạn */}
      <Card
        title={`📊 Tiến độ Sản xuất theo Công đoạn của Quy trình (${stageSummary.length} công đoạn · ${activeOrders.length} lệnh đang chạy)`}
        actions={
          <Button variant="ghost" onClick={() => setShowStageSummary((v) => !v)}>
            {showStageSummary ? "Thu gọn" : "Mở bảng"}
          </Button>
        }
      >
        {showStageSummary &&
          (stageSummary.length === 0 ? (
            <Empty>Chưa có công đoạn nào đang chạy.</Empty>
          ) : (
            <Table head={["Công đoạn", "Tổng lệnh", "Đã hoàn tất", "Đang thực hiện", "Chờ QC thông qua", "Lỗi", "Chưa đến lượt", "Lệnh đang ở công đoạn này"]}>
              {stageSummary.map((st) => {
                const pct = st.total ? Math.round((st.done / st.total) * 100) : 0;
                return (
                  <tr key={st.name}>
                    <td className="px-3 py-2 text-xs font-semibold">
                      {st.is_qc && <span title="Bước QC xen kẽ — cần QC xác nhận thông qua để chạy bước kế tiếp">🛡️ </span>}
                      {st.name}
                      <div className="w-32 h-1.5 mt-1 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                        <div className="h-full bg-emerald-600" style={{ width: `${pct}%` }} />
                      </div>
                    </td>
                    <td className="px-3 py-2 text-xs font-mono">{st.total}</td>
                    <td className="px-3 py-2 text-xs font-mono text-emerald-700 font-bold">{st.done}</td>
                    <td className="px-3 py-2 text-xs font-mono text-sky-700 font-bold">{st.running}</td>
                    <td className="px-3 py-2 text-xs font-mono text-amber-700 font-bold">{st.waitingQc}</td>
                    <td className="px-3 py-2 text-xs font-mono text-rose-700 font-bold">{st.failed}</td>
                    <td className="px-3 py-2 text-xs font-mono text-slate-500">{st.pending}</td>
                    <td className="px-3 py-2 text-[11px] font-mono text-slate-600 dark:text-slate-300">{st.orders.join(", ") || "-"}</td>
                  </tr>
                );
              })}
            </Table>
          ))}
      </Card>
    </div>
  );
}

function Kpi({ label, value, tone, onClick }: { label: string; value: string; tone: "sky" | "rose" | "amber" | "emerald" | "indigo"; onClick?: () => void }) {
  const toneCls: Record<string, string> = {
    sky: "border-sky-200 bg-sky-50/60 text-sky-900 dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-200",
    rose: "border-rose-300 bg-rose-50/70 text-rose-900 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200",
    amber: "border-amber-300 bg-amber-50/70 text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200",
    emerald: "border-emerald-200 bg-emerald-50/60 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200",
    indigo: "border-indigo-200 bg-indigo-50/60 text-indigo-900 dark:border-indigo-900 dark:bg-indigo-950/30 dark:text-indigo-200",
  };
  return (
    <button type="button" onClick={onClick} title={`Bấm để lọc: ${label}`} className={`text-left p-3 rounded-xl border ${toneCls[tone]} hover:shadow-sm`}>
      <div className="text-[11px] opacity-80">{label}</div>
      <div className="text-lg font-extrabold">{value}</div>
    </button>
  );
}

function Legend({ cls, label }: { cls: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className={`inline-block w-3 h-3 rounded ${cls}`} /> {label}
    </span>
  );
}

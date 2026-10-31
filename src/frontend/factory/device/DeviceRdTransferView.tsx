"use client";

import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  CheckCircle2,
  Cpu,
  FileCheck2,
  FlaskConical,
  Layers,
  Plus,
  Rocket,
  Sparkles,
  Wrench,
} from "lucide-react";
import { api, fmtDate, fmtQty } from "../api";
import { Button, Card, Empty, ErrorNote, Field, inputClass, StatusBadge, Table } from "../ui";
import { MODEL_CATEGORY_LABELS, STATION_LABELS, useDeviceOptions } from "./shared";

interface GateDeliverable {
  id: string;
  seq: number;
  item_name: string;
  doc_type: string;
  is_required: boolean;
  notes: string | null;
  status: "MISSING" | "SUBMITTED" | "ACCEPTED" | "REJECTED";
  reviewer_comment: string | null;
}

interface ProjectGate {
  id: string;
  gate_no: number;
  gate_name: string;
  stage_after: string;
  status: "LOCKED" | "OPEN" | "PENDING_REVIEW" | "PASSED" | "NEEDS_REVISION";
  decision: string | null;
  decision_note: string | null;
  decided_by_name: string | null;
  deliverables: GateDeliverable[];
}

interface SpecEvalRow {
  id: string;
  parameter: string;
  unit: string | null;
  baseline_value: string | null;
  target_value: string;
  actual_value: string | null;
  method_ref: string | null;
  result: "PENDING" | "PASS" | "FAIL";
}

interface BomLineRow {
  id: string;
  line_no: number;
  station_code: string;
  component_item_id: string;
  item_code: string;
  item_name: string;
  qty_per_unit: number;
  uom: string;
  source_type: string;
  tracking_type: string;
  drawing_code: string | null;
  requires_serial: boolean;
}

interface DeviceRdProject {
  id: string;
  code: string;
  name: string;
  project_type: "NEW_PRODUCT" | "IMPROVEMENT";
  current_stage: string;
  status: "ACTIVE" | "ON_HOLD" | "TRANSFERRED" | "KILLED";
  planned_start: string | null;
  planned_end: string | null;
  actual_transfer_date: string | null;
  description: string | null;
  leader_name: string | null;
  model_id: string | null;
  model_code: string | null;
  model_name: string | null;
  model_category: string | null;
  model_status: string | null;
  warranty_months: number | null;
  required_burn_in_hours: number | null;
  target_revision: {
    id: string;
    revision: string;
    firmware_version: string | null;
    status: string;
  } | null;
  gates: ProjectGate[];
  specs: SpecEvalRow[];
  bom_lines: BomLineRow[];
}

const STAGE_CARDS = [
  {
    gate_no: 1,
    stage: "G1_CONCEPT",
    title: "1. Đề Xuất & Khảo Sát (G1)",
    subtitle: "Ý tưởng, PRD & Khả thi FTO",
  },
  {
    gate_no: 2,
    stage: "G2_DESIGN_BOM",
    title: "2. Thiết Kế 3D & eBOM (G2)",
    subtitle: "SolidWorks CAD, Layout PCB & dFMEA",
  },
  {
    gate_no: 3,
    stage: "G3_PROTOTYPE",
    title: "3. Chế Tạo Mẫu Thử (G3)",
    subtitle: "Lắp ráp Prototype v1/v2 & Đo kiểm DVP",
  },
  {
    gate_no: 4,
    stage: "G4_PILOT",
    title: "4. Sản Xuất Pilot (G4)",
    subtitle: "Test an toàn điện IEC 61010 & Burn-in 48h",
  },
  {
    gate_no: 5,
    stage: "TRANSFERRED",
    title: "5. Chuyển Giao SX (G5)",
    subtitle: "Ban hành DMR/BOM & Mở mã thương mại",
  },
] as const;

function currentGateNumber(p: DeviceRdProject): number {
  if (p.status === "TRANSFERRED" || p.current_stage === "TRANSFERRED") return 5;
  const openGate = p.gates.find((g) => g.status !== "PASSED");
  return openGate ? Number(openGate.gate_no) : 5;
}

export function DeviceRdTransferView({ onOpenCatalog }: { onOpenCatalog?: () => void }) {
  const qc = useQueryClient();
  const opts = useDeviceOptions();

  const wfQuery = useQuery({
    queryKey: ["factory", "device", "workflow", "rd"],
    queryFn: () => api<{ rd_projects: DeviceRdProject[] }>("/api/factory/device/workflow?section=rd"),
  });

  const modelsQuery = useQuery({
    queryKey: ["factory", "device", "models"],
    queryFn: () =>
      api<{ id: string; code: string; name: string; category: string; current_revision: string | null }[]>(
        "/api/factory/device/models"
      ),
  });

  const [stageFilter, setStageFilter] = useState<number | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [createMode, setCreateMode] = useState<"NONE" | "NEW_PRODUCT" | "IMPROVEMENT">("NONE");

  const [form, setForm] = useState({
    base_model_id: "",
    model_code: "",
    model_name: "",
    category: "EXTRACTOR",
    target_revision: "A",
    firmware_version: "v1.0.0",
    warranty_months: "24",
    required_burn_in_hours: "48",
    planned_end: "2026-12-31",
    description: "",
  });

  const [specForm, setSpecForm] = useState({
    parameter: "",
    unit: "",
    baseline_value: "",
    target_value: "",
    actual_value: "",
    method_ref: "Đo kiểm DVP / IEC 61010-1",
    result: "PASS" as "PENDING" | "PASS" | "FAIL",
  });

  const [bomForm, setBomForm] = useState({
    station_code: "STATION_1_MECH",
    component_item_id: "",
    qty_per_unit: "1",
    uom: "pcs",
    source_type: "BUY",
    tracking_type: "LOT" as "SERIAL" | "LOT" | "BULK",
    drawing_code: "",
    requires_serial: false,
  });

  const [transferNote, setTransferNote] = useState(
    "Hội đồng R&D – Kỹ thuật – QA nghiệm thu đạt 100% chỉ tiêu DVP & IEC 61010-1, ban hành hồ sơ DMR/BOM sản xuất hàng loạt."
  );

  const projects = wfQuery.data?.rd_projects ?? [];
  const filteredProjects = stageFilter
    ? projects.filter((p) => currentGateNumber(p) === stageFilter)
    : projects;

  const selectedProject =
    projects.find((p) => p.id === selectedProjectId) ?? filteredProjects[0] ?? projects[0] ?? null;

  const refreshAll = () => {
    qc.invalidateQueries({ queryKey: ["factory", "device", "workflow"] });
    qc.invalidateQueries({ queryKey: ["factory", "device", "models"] });
    qc.invalidateQueries({ queryKey: ["factory", "device", "options"] });
  };

  const createMut = useMutation({
    mutationFn: () =>
      api<{ project_id: string }>("/api/factory/device/workflow", {
        method: "POST",
        json: {
          action: "create_rd_project",
          project_type: createMode === "IMPROVEMENT" ? "IMPROVEMENT" : "NEW_PRODUCT",
          base_model_id: createMode === "IMPROVEMENT" ? form.base_model_id : null,
          model_code: createMode === "NEW_PRODUCT" ? form.model_code : null,
          model_name: form.model_name,
          category: form.category,
          target_revision: form.target_revision,
          firmware_version: form.firmware_version,
          warranty_months: Number(form.warranty_months),
          required_burn_in_hours: Number(form.required_burn_in_hours),
          planned_end: form.planned_end || null,
          description: form.description || null,
        },
      }),
    onSuccess: (res) => {
      setCreateMode("NONE");
      setSelectedProjectId(res.project_id);
      refreshAll();
    },
  });

  const advanceGateMut = useMutation({
    mutationFn: (payload: { project_id: string; gate_no?: number }) =>
      api("/api/factory/device/workflow", {
        method: "POST",
        json: {
          action: "advance_rd_gate",
          project_id: payload.project_id,
          gate_no: payload.gate_no,
        },
      }),
    onSuccess: refreshAll,
  });

  const transferMut = useMutation({
    mutationFn: (projectId: string) =>
      api("/api/factory/device/workflow", {
        method: "POST",
        json: {
          action: "transfer_rd_to_production",
          project_id: projectId,
          transfer_note: transferNote,
        },
      }),
    onSuccess: () => {
      refreshAll();
    },
  });

  const addSpecMut = useMutation({
    mutationFn: () =>
      api("/api/factory/device/workflow", {
        method: "POST",
        json: {
          action: "save_rd_spec",
          project_id: selectedProject?.id,
          category: "DEVICE_SPEC",
          design_stage: "VERIFICATION",
          ...specForm,
        },
      }),
    onSuccess: () => {
      setSpecForm({
        parameter: "",
        unit: "",
        baseline_value: "",
        target_value: "",
        actual_value: "",
        method_ref: "Đo kiểm DVP / IEC 61010-1",
        result: "PASS",
      });
      refreshAll();
    },
  });

  const addBomMut = useMutation({
    mutationFn: () =>
      api("/api/factory/device/workflow", {
        method: "POST",
        json: {
          action: "add_rd_bom_line",
          revision_id: selectedProject?.target_revision?.id,
          station_code: bomForm.station_code,
          component_item_id: bomForm.component_item_id,
          qty_per_unit: Number(bomForm.qty_per_unit),
          uom: bomForm.uom,
          source_type: bomForm.source_type,
          tracking_type: bomForm.tracking_type,
          drawing_code: bomForm.drawing_code || null,
          is_critical: true,
          requires_serial: bomForm.requires_serial,
        },
      }),
    onSuccess: () => {
      setBomForm((s) => ({ ...s, component_item_id: "", drawing_code: "" }));
      refreshAll();
    },
  });

  return (
    <div className="flex flex-col gap-3">
      {/* Top Action & 5-Stage Pipeline Header */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3.5 flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-600 text-white text-xs font-bold shadow-sm">
              <FlaskConical className="w-3.5 h-3.5" />
              Quy Trình R&amp;D Thiết Bị (Từ Đề Xuất ➔ Chuyển Giao Sản Xuất)
              <span className="px-1.5 py-0.5 rounded-md bg-indigo-800 text-[11px]">{projects.length} dự án</span>
            </span>
            {onOpenCatalog && (
              <button
                type="button"
                onClick={onOpenCatalog}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-100 cursor-pointer"
              >
                <Layers className="w-3.5 h-3.5 text-sky-600" />
                Danh Mục Thiết Bị Đã Chuyển Giao &amp; Cây Định Mức BOM ({modelsQuery.data?.length ?? 0} model)
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                const firstM = modelsQuery.data?.[0];
                setForm({
                  base_model_id: firstM?.id ?? "",
                  model_code: firstM?.code ?? "EZ32",
                  model_name: "Nâng cấp cụm gia nhiệt PID & Tối ưu mạch công suất",
                  category: firstM?.category ?? "EXTRACTOR",
                  target_revision: "B",
                  firmware_version: "v2.5.0",
                  warranty_months: "24",
                  required_burn_in_hours: "48",
                  planned_end: "2026-12-31",
                  description: "Đề tài cải tiến nâng cấp thiết bị hiện hành lên Revision mới",
                });
                setCreateMode(createMode === "IMPROVEMENT" ? "NONE" : "IMPROVEMENT");
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-purple-700 hover:bg-purple-800 text-white text-xs font-bold cursor-pointer shadow-sm"
            >
              <Sparkles className="w-3.5 h-3.5" />
              + Đề Xuất Cải Tiến Thiết Bị Cũ
            </button>

            <button
              type="button"
              onClick={() => {
                setForm({
                  base_model_id: "",
                  model_code: "CENTRI-24",
                  model_name: "Máy ly tâm lạnh vi ống tốc độ cao 15,000 RPM ABT",
                  category: "CENTRIFUGE",
                  target_revision: "A",
                  firmware_version: "v1.0.0",
                  warranty_months: "24",
                  required_burn_in_hours: "48",
                  planned_end: "2026-12-31",
                  description: "Nghiên cứu thiết kế & chế tạo dòng máy mới 100% tại nhà máy ABT",
                });
                setCreateMode(createMode === "NEW_PRODUCT" ? "NONE" : "NEW_PRODUCT");
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer shadow-sm"
            >
              <Plus className="w-3.5 h-3.5" />
              + Đề Xuất Dự Án Thiết Bị Mới
            </button>
          </div>
        </div>

        {/* 5 Stage-Gate Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-5 gap-2">
          {STAGE_CARDS.map((sc) => {
            const count = projects.filter((p) => currentGateNumber(p) === sc.gate_no).length;
            const active = stageFilter === sc.gate_no;
            return (
              <button
                key={sc.gate_no}
                type="button"
                onClick={() => setStageFilter(active ? null : sc.gate_no)}
                className={`text-left p-2.5 rounded-xl border transition-all cursor-pointer ${
                  active
                    ? "border-sky-500 bg-sky-50/80 dark:bg-sky-950/40 ring-1 ring-sky-500"
                    : "border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-950/50 hover:border-slate-300"
                }`}
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="text-xs font-bold text-amber-600 dark:text-amber-400">{sc.title}</span>
                  <span className="px-1.5 py-0.5 rounded-md bg-slate-200 dark:bg-slate-800 font-mono text-[11px] font-bold">
                    {count}
                  </span>
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">{sc.subtitle}</div>
              </button>
            );
          })}
        </div>

        {/* Modal / Inline Form to Create New Product or Improvement R&D Project */}
        {createMode !== "NONE" && (
          <form
            className="p-3.5 rounded-xl border border-indigo-200 dark:border-indigo-900/60 bg-indigo-50/40 dark:bg-indigo-950/20 flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              createMut.mutate();
            }}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-indigo-800 dark:text-indigo-300">
                {createMode === "IMPROVEMENT"
                  ? "✨ Khởi tạo Đề tài Cải tiến / Nâng cấp Phiên bản Thiết bị hiện hành (Tự động kế thừa Thông số & BOM cũ)"
                  : "🚀 Khởi tạo Đề tài Nghiên cứu & Chế tạo Thiết bị Mới (5 Cổng Stage-Gate G1 ➔ G5)"}
              </span>
              <Button variant="ghost" type="button" onClick={() => setCreateMode("NONE")}>
                Đóng
              </Button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-2.5">
              {createMode === "IMPROVEMENT" ? (
                <Field label="Chọn Thiết bị nền cần cải tiến *">
                  <select
                    className={inputClass}
                    value={form.base_model_id}
                    onChange={(e) => {
                      const m = modelsQuery.data?.find((x) => x.id === e.target.value);
                      setForm({
                        ...form,
                        base_model_id: e.target.value,
                        model_code: m?.code ?? "",
                        category: m?.category ?? "EXTRACTOR",
                      });
                    }}
                    required
                  >
                    <option value="">-- Chọn Model hiện hành --</option>
                    {(modelsQuery.data ?? []).map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.code} — {m.name} (Hiện hành: Rev {m.current_revision ?? "A"})
                      </option>
                    ))}
                  </select>
                </Field>
              ) : (
                <Field label="Mã Model thiết bị mới dự kiến *">
                  <input
                    className={`${inputClass} font-mono uppercase`}
                    value={form.model_code}
                    onChange={(e) => setForm({ ...form, model_code: e.target.value.toUpperCase() })}
                    placeholder="VD: Q96, CENTRI-24"
                    required
                  />
                </Field>
              )}

              <div className="md:col-span-2">
                <Field label={createMode === "IMPROVEMENT" ? "Tên đề tài / Nội dung nâng cấp trọng tâm *" : "Tên thương mại Thiết bị mới *"}>
                  <input
                    className={inputClass}
                    value={form.model_name}
                    onChange={(e) => setForm({ ...form, model_name: e.target.value })}
                    required
                  />
                </Field>
              </div>

              <Field label="Phiên bản DMR đích (Revision) *">
                <input
                  className={`${inputClass} font-mono uppercase`}
                  value={form.target_revision}
                  onChange={(e) => setForm({ ...form, target_revision: e.target.value.toUpperCase() })}
                  placeholder={createMode === "IMPROVEMENT" ? "B" : "A"}
                  required
                />
              </Field>

              <Field label="Nhóm thiết bị">
                <select
                  className={inputClass}
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                >
                  {Object.entries(MODEL_CATEGORY_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Phiên bản Firmware mục tiêu">
                <input
                  className={`${inputClass} font-mono`}
                  value={form.firmware_version}
                  onChange={(e) => setForm({ ...form, firmware_version: e.target.value })}
                />
              </Field>

              <Field label="Giờ chạy lão hóa (Burn-in)">
                <input
                  type="number"
                  className={inputClass}
                  value={form.required_burn_in_hours}
                  onChange={(e) => setForm({ ...form, required_burn_in_hours: e.target.value })}
                />
              </Field>

              <Field label="Hạn mục tiêu chuyển giao SX">
                <input
                  type="date"
                  className={inputClass}
                  value={form.planned_end}
                  onChange={(e) => setForm({ ...form, planned_end: e.target.value })}
                />
              </Field>
            </div>

            <ErrorNote error={createMut.error} />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" type="button" onClick={() => setCreateMode("NONE")}>
                Hủy
              </Button>
              <Button type="submit" disabled={createMut.isPending}>
                Khởi tạo Dự án R&amp;D Thiết bị &amp; Mở Cổng G1
              </Button>
            </div>
          </form>
        )}
      </div>

      {/* Main Content: Project List (Left 4 cols) + Active Stage-Gate & Transfer Workspace (Right 8 cols) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
        <div className={selectedProject ? "lg:col-span-4 flex flex-col gap-3" : "lg:col-span-12 flex flex-col gap-3"}>
          <Card
            title={`Danh sách Dự án R&D Thiết bị (${filteredProjects.length})`}
            actions={
              stageFilter ? (
                <Button variant="ghost" onClick={() => setStageFilter(null)}>
                  Xem tất cả
                </Button>
              ) : null
            }
          >
            {filteredProjects.length === 0 ? (
              <Empty>Chưa có dự án R&amp;D thiết bị nào ở giai đoạn này.</Empty>
            ) : (
              <div className="flex flex-col gap-2">
                {filteredProjects.map((p) => {
                  const gNo = currentGateNumber(p);
                  const isSelected = selectedProject?.id === p.id;
                  return (
                    <div
                      key={p.id}
                      onClick={() => setSelectedProjectId(p.id)}
                      className={`p-3 rounded-xl border transition-all cursor-pointer ${
                        isSelected
                          ? "border-sky-500 bg-sky-50/70 dark:bg-sky-950/30 shadow-sm"
                          : "border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-xs font-bold text-sky-700 dark:text-sky-400">
                          {p.code} · {p.model_code ?? "MODEL"} (Rev {p.target_revision?.revision ?? "A"})
                        </span>
                        <StatusBadge
                          status={p.status === "TRANSFERRED" ? "RELEASED" : "QUARANTINE"}
                          label={
                            p.status === "TRANSFERRED"
                              ? "Đã chuyển giao SX (G5)"
                              : `Đang ở Cổng G${gNo}/5`
                          }
                        />
                      </div>
                      <div className="text-xs font-bold text-slate-800 dark:text-slate-100 mt-1">{p.name}</div>
                      <div className="flex flex-wrap items-center justify-between gap-2 mt-2 text-[11px] text-slate-500">
                        <span>
                          Loại:{" "}
                          <strong className={p.project_type === "IMPROVEMENT" ? "text-purple-600" : "text-emerald-600"}>
                            {p.project_type === "IMPROVEMENT" ? "Cải tiến máy cũ" : "Phát triển máy mới"}
                          </strong>
                        </span>
                        <span>BOM: <strong>{p.bom_lines.length} linh kiện</strong></span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </div>

        {selectedProject && (
          <div className="lg:col-span-8 flex flex-col gap-3">
            <Card
              title={`${selectedProject.code} — ${selectedProject.name}`}
                actions={
                  <div className="flex flex-wrap items-center gap-2">
                    {selectedProject.status !== "TRANSFERRED" && (
                      <>
                        <Button
                          variant="ghost"
                          disabled={advanceGateMut.isPending}
                          onClick={() => advanceGateMut.mutate({ project_id: selectedProject.id })}
                        >
                          ✅ Nạp hồ sơ DHF &amp; Duyệt qua cổng G{currentGateNumber(selectedProject)}
                        </Button>
                        <Button
                          disabled={transferMut.isPending}
                          onClick={() => transferMut.mutate(selectedProject.id)}
                        >
                          🚀 Nghiệm thu &amp; Chuyển giao Sản xuất (Mở mã Thương mại)
                        </Button>
                      </>
                    )}
                    {selectedProject.status === "TRANSFERRED" && (
                      <StatusBadge status="RELEASED" label="ĐÃ CHUYỂN GIAO SẢN XUẤT & MỞ MÃ THƯƠNG MẠI" />
                    )}
                  </div>
                }
              >
                <ErrorNote error={advanceGateMut.error || transferMut.error} />
                <div className="flex flex-col gap-4 text-xs">
                  {/* Summary Bar */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 rounded-xl bg-slate-50 dark:bg-slate-800/50 p-3">
                    <div>
                      <span className="text-slate-400">Mã Model &amp; Phiên bản:</span>{" "}
                      <b className="font-mono text-sky-700 dark:text-sky-400">
                        {selectedProject.model_code} (Rev {selectedProject.target_revision?.revision ?? "A"})
                      </b>
                    </div>
                    <div>
                      <span className="text-slate-400">Firmware đích:</span>{" "}
                      <b className="font-mono">{selectedProject.target_revision?.firmware_version ?? "v1.0.0"}</b>
                    </div>
                    <div>
                      <span className="text-slate-400">Lão hóa Burn-in chuẩn:</span>{" "}
                      <b>{selectedProject.required_burn_in_hours ?? 48} giờ</b>
                    </div>
                    <div>
                      <span className="text-slate-400">Trạng thái Thương mại:</span>{" "}
                      <b>{selectedProject.model_status === "COMMERCIAL" ? "Đang thương mại hóa" : "Đang R&D (DEVELOPMENT)"}</b>
                    </div>
                  </div>

                  {/* 1. 5-Gate Stage-Gate Checklist (DHF ISO 13485) */}
                  <div className="flex flex-col gap-2">
                    <div className="font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                      <FileCheck2 className="w-4 h-4 text-indigo-600" />
                      1. Lộ trình 5 Cổng Thẩm định Hồ sơ Thiết kế (DHF Stage-Gate G1 ➔ G5)
                    </div>
                    <div className="grid grid-cols-1 gap-2">
                      {selectedProject.gates.map((g) => {
                        const isPassed = g.status === "PASSED";
                        const isOpen = g.status === "OPEN" || g.status === "PENDING_REVIEW";
                        return (
                          <div
                            key={g.id}
                            className={`p-3 rounded-xl border ${
                              isPassed
                                ? "border-emerald-200 dark:border-emerald-900/50 bg-emerald-50/30 dark:bg-emerald-950/15"
                                : isOpen
                                ? "border-sky-300 dark:border-sky-800 bg-sky-50/40 dark:bg-sky-950/20"
                                : "border-slate-200 dark:border-slate-800 opacity-75"
                            }`}
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                                <span
                                  className={`px-2 py-0.5 rounded text-[11px] font-mono ${
                                    isPassed
                                      ? "bg-emerald-600 text-white"
                                      : isOpen
                                      ? "bg-sky-600 text-white"
                                      : "bg-slate-200 dark:bg-slate-800 text-slate-600"
                                  }`}
                                >
                                  G{g.gate_no}
                                </span>
                                {g.gate_name}
                              </div>
                              <div className="flex items-center gap-2">
                                <StatusBadge
                                  status={isPassed ? "RELEASED" : isOpen ? "QUARANTINE" : "PENDING_QC"}
                                  label={isPassed ? "ĐÃ DUYỆT QUA CỔNG (GO)" : isOpen ? "ĐANG MỞ THẨM ĐỊNH" : "CHỜ MỞ CỔNG"}
                                />
                                {!isPassed && selectedProject.status !== "TRANSFERRED" && (
                                  <Button
                                    variant="ghost"
                                    disabled={advanceGateMut.isPending}
                                    onClick={() =>
                                      advanceGateMut.mutate({ project_id: selectedProject.id, gate_no: g.gate_no })
                                    }
                                  >
                                    Duyệt cổng G{g.gate_no} ➔
                                  </Button>
                                )}
                              </div>
                            </div>

                            {g.deliverables.length > 0 && (
                              <ul className="mt-2 space-y-1 pl-2 border-l-2 border-slate-200 dark:border-slate-700">
                                {g.deliverables.map((d) => (
                                  <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                                    <span>
                                      {d.status === "ACCEPTED" ? "✅" : "📄"} <strong>{d.item_name}</strong>
                                      {d.notes && <span className="text-slate-500 ml-1">— {d.notes}</span>}
                                    </span>
                                    <span className="font-mono text-[10px] text-slate-400">{d.status}</span>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* 2. Design Input vs Output / Actual Verification Table */}
                  <div className="flex flex-col gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
                    <div className="font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                      <Cpu className="w-4 h-4 text-purple-600" />
                      2. Bảng Đánh Giá &amp; Đối Chiếu Thông Số Kỹ Thuật ([Thông số cũ] ➔ [Mục tiêu] ➔ [Thực tế đo kiểm DVP])
                    </div>
                    <Table head={["Chỉ tiêu kỹ thuật", "Thông số cũ (Baseline)", "Mục tiêu R&D", "Thực tế đo kiểm", "Phương pháp đo", "Kết luận"]}>
                      {selectedProject.specs.map((s) => (
                        <tr key={s.id}>
                          <td className="py-1.5 pr-2 font-semibold">
                            {s.parameter} {s.unit ? `(${s.unit})` : ""}
                          </td>
                          <td className="py-1.5 pr-2 text-slate-500">{s.baseline_value ?? "—"}</td>
                          <td className="py-1.5 pr-2 font-semibold text-indigo-700 dark:text-indigo-300">{s.target_value}</td>
                          <td className="py-1.5 pr-2 font-bold text-emerald-700 dark:text-emerald-400">
                            {s.actual_value || "Đang đo kiểm"}
                          </td>
                          <td className="py-1.5 pr-2 text-slate-500">{s.method_ref ?? "—"}</td>
                          <td className="py-1.5 pr-2">
                            <StatusBadge
                              status={s.result === "PASS" ? "RELEASED" : s.result === "FAIL" ? "REJECTED" : "PENDING_QC"}
                              label={s.result === "PASS" ? "ĐẠT" : s.result === "FAIL" ? "KHÔNG ĐẠT" : "CHỜ ĐO"}
                            />
                          </td>
                        </tr>
                      ))}
                    </Table>

                    {selectedProject.status !== "TRANSFERRED" && (
                      <form
                        className="grid grid-cols-1 sm:grid-cols-6 gap-2 p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 items-end"
                        onSubmit={(e) => {
                          e.preventDefault();
                          addSpecMut.mutate();
                        }}
                      >
                        <div className="sm:col-span-2">
                          <Field label="Thêm thông số kỹ thuật / DVP *">
                            <input
                              className={inputClass}
                              placeholder="VD: Độ ồn vận hành cực đại"
                              value={specForm.parameter}
                              onChange={(e) => setSpecForm({ ...specForm, parameter: e.target.value })}
                              required
                            />
                          </Field>
                        </div>
                        <Field label="Thông số cũ">
                          <input
                            className={inputClass}
                            placeholder="VD: 62 dBA"
                            value={specForm.baseline_value}
                            onChange={(e) => setSpecForm({ ...specForm, baseline_value: e.target.value })}
                          />
                        </Field>
                        <Field label="Mục tiêu *">
                          <input
                            className={inputClass}
                            placeholder="VD: ≤ 55 dBA"
                            value={specForm.target_value}
                            onChange={(e) => setSpecForm({ ...specForm, target_value: e.target.value })}
                            required
                          />
                        </Field>
                        <Field label="Thực tế đạt">
                          <input
                            className={inputClass}
                            placeholder="VD: 51 dBA"
                            value={specForm.actual_value}
                            onChange={(e) => setSpecForm({ ...specForm, actual_value: e.target.value })}
                          />
                        </Field>
                        <Button type="submit" disabled={addSpecMut.isPending}>
                          + Lưu chỉ tiêu
                        </Button>
                      </form>
                    )}
                  </div>

                  {/* 3. eBOM 4-Station Structure for this R&D Project */}
                  <div className="flex flex-col gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
                    <div className="font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                      <Wrench className="w-4 h-4 text-sky-600" />
                      3. Cấu Trúc Định Mức Linh Kiện eBOM 4 Trạm (Rev {selectedProject.target_revision?.revision ?? "A"} — Phục vụ Chuyển giao SX)
                    </div>
                    {selectedProject.bom_lines.length > 0 ? (
                      <Table head={["#", "Trạm lắp ráp", "Mã linh kiện & Bản vẽ", "Tên linh kiện", "Nguồn cung", "ĐM / 1 máy"]}>
                        {selectedProject.bom_lines.map((b) => (
                          <tr key={b.id}>
                            <td className="py-1.5 pr-2 font-mono">{b.line_no}</td>
                            <td className="py-1.5 pr-2">{STATION_LABELS[b.station_code] ?? b.station_code}</td>
                            <td className="py-1.5 pr-2 font-mono font-bold">
                              {b.item_code}
                              {b.drawing_code && (
                                <span className="ml-1 text-[10px] text-sky-600">[{b.drawing_code}]</span>
                              )}
                            </td>
                            <td className="py-1.5 pr-2">{b.item_name}</td>
                            <td className="py-1.5 pr-2 font-mono">
                              <span
                                className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                  b.source_type === "SUBCONTRACT"
                                    ? "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
                                    : "bg-sky-100 text-sky-800 dark:bg-sky-950/60 dark:text-sky-300"
                                }`}
                              >
                                {b.source_type === "SUBCONTRACT" ? "GIA CÔNG (CNC/PCB)" : "MUA THƯƠNG MẠI (BUY)"}
                              </span>
                            </td>
                            <td className="py-1.5 pr-2 font-mono font-bold">
                              {fmtQty(b.qty_per_unit)} {b.uom}
                            </td>
                          </tr>
                        ))}
                      </Table>
                    ) : (
                      <Empty>Chưa có dòng linh kiện eBOM nào (Khi bấm Chuyển giao SX hệ thống sẽ tự động chuẩn hóa BOM).</Empty>
                    )}

                    {selectedProject.target_revision?.status === "DRAFT" && (
                      <form
                        className="grid grid-cols-1 sm:grid-cols-6 gap-2 p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 items-end"
                        onSubmit={(e) => {
                          e.preventDefault();
                          addBomMut.mutate();
                        }}
                      >
                        <Field label="Trạm lắp ráp">
                          <select
                            className={inputClass}
                            value={bomForm.station_code}
                            onChange={(e) => setBomForm({ ...bomForm, station_code: e.target.value })}
                          >
                            {Object.entries(STATION_LABELS)
                              .filter(([k]) => k !== "FIELD_SERVICE")
                              .map(([k, v]) => (
                                <option key={k} value={k}>
                                  {v}
                                </option>
                              ))}
                          </select>
                        </Field>
                        <div className="sm:col-span-2">
                          <Field label="Linh kiện / Vật tư trong kho *">
                            <select
                              className={inputClass}
                              value={bomForm.component_item_id}
                              onChange={(e) => {
                                const it = opts.data?.items.find((x) => x.id === e.target.value);
                                setBomForm({
                                  ...bomForm,
                                  component_item_id: e.target.value,
                                  uom: it?.base_uom ?? "pcs",
                                });
                              }}
                              required
                            >
                              <option value="">-- Chọn linh kiện --</option>
                              {(opts.data?.items ?? []).map((it) => (
                                <option key={it.id} value={it.id}>
                                  {it.code} — {it.name}
                                </option>
                              ))}
                            </select>
                          </Field>
                        </div>
                        <Field label="Nguồn cung">
                          <select
                            className={inputClass}
                            value={bomForm.source_type}
                            onChange={(e) => setBomForm({ ...bomForm, source_type: e.target.value })}
                          >
                            <option value="BUY">BUY — Mua ngoài</option>
                            <option value="SUBCONTRACT">SUBCONTRACT — Gia công</option>
                          </select>
                        </Field>
                        <Field label="Định mức / máy">
                          <input
                            type="number"
                            step="0.01"
                            className={inputClass}
                            value={bomForm.qty_per_unit}
                            onChange={(e) => setBomForm({ ...bomForm, qty_per_unit: e.target.value })}
                            required
                          />
                        </Field>
                        <Button type="submit" disabled={!bomForm.component_item_id || addBomMut.isPending}>
                          + Thêm vào eBOM
                        </Button>
                      </form>
                    )}
                  </div>

                  {/* 4. Gate 5 Tech Transfer Callout Box */}
                  {selectedProject.status !== "TRANSFERRED" && (
                    <div className="p-3.5 rounded-xl border border-emerald-300 dark:border-emerald-800 bg-emerald-50/60 dark:bg-emerald-950/30 flex flex-col gap-2">
                      <div className="font-bold text-emerald-900 dark:text-emerald-200 flex items-center gap-1.5">
                        <Rocket className="w-4 h-4 text-emerald-600" />
                        Cổng 5 (G5): Nghiệm Thu Chuyển Giao Sản Xuất Hàng Loạt &amp; Mở Mã Thương Mại
                      </div>
                      <p className="text-[11px] text-emerald-800 dark:text-emerald-300">
                        Khi bấm nút <b>Chuyển giao Sản xuất</b>, hệ thống sẽ tự động hoàn tất 5 cổng DHF, phát hành chính thức phiên bản thiết kế{" "}
                        <b>
                          {selectedProject.model_code} Rev {selectedProject.target_revision?.revision ?? "A"} (RELEASED)
                        </b>
                        , cập nhật thông số kỹ thuật thực tế vào Danh mục Thiết bị, ban hành lệnh thay đổi ECO (nếu là dự án cải tiến) và mở mã thương mại để nhận Đơn hàng PO!
                      </p>
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          className={`${inputClass} flex-1`}
                          value={transferNote}
                          onChange={(e) => setTransferNote(e.target.value)}
                        />
                        <Button
                          disabled={transferMut.isPending}
                          onClick={() => transferMut.mutate(selectedProject.id)}
                        >
                          🚀 Ký Nghiệm Thu &amp; Chuyển Giao Sản Xuất Ngay
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </Card>
          </div>
        )}
      </div>
    </div>
  );
}

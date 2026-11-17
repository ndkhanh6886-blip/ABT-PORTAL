"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, FolderOpen, Pencil, Plus, Settings2, Sparkles, Trash2 } from "lucide-react";
import { ActionBar, type AllowedAction } from "../actions";
import { api, fmtDate } from "../api";
import { Button, Card, Empty, ErrorNote, Field, inputClass, StatusBadge, Table } from "../ui";
import { DOMAIN_LABEL, useRdContext } from "./shared";
import { TransferPackageDetailWorkspace } from "./TransferPackageDetailWorkspace";
import { TransferTemplateModal, type TransferTemplateRow } from "./TransferTemplateModal";

const TT_STATUS: Record<string, [string, string]> = {
  DRAFT: ["QUARANTINE", "Nháp"],
  SUBMITTED: ["PENDING_QC", "Đã gửi phòng nhận"],
  ACCEPTED: ["RELEASED", "Phòng SX đã ký nhận (Đã sinh QC Spec nháp)"],
  COMPLETED: ["RELEASED", "Hoàn tất chuyển giao (Lô Pilot đạt)"],
};

const SW_STATUS: Record<string, [string, string]> = {
  DRAFT: ["QUARANTINE", "Nháp"],
  RELEASED: ["RELEASED", "Đã ký phát hành (RELEASED)"],
  WITHDRAWN: ["REJECTED", "Đã thu hồi (WITHDRAWN)"],
};

const TT_ACTIONS = {
  submit: "Gửi gói chuyển giao sang Sản xuất",
  return_draft: "Trả lại R&D chỉnh sửa",
  accept: "Ký tiếp nhận chuyển giao công nghệ",
  complete: "Xác nhận hoàn tất (Lô Pilot đạt)",
};

const SW_ACTIONS = {
  release: "Ký phát hành phiên bản phần mềm",
  withdraw: "Thu hồi phiên bản (Withdraw)",
};

interface BomDraftRow {
  component_item_id: string | null;
  component_code: string;
  component_name: string;
  role: string;
  qty_per_kit: string;
  qty_aliquoted: string;
  uom: string;
  scrap_pct: string;
  box_no: string;
}

interface RoutingDraftRow {
  step_code: string;
  step_name: string;
  params: string;
  qc_check: string;
}

interface QcCriterionDraftRow {
  stage: "IQC" | "IPQC" | "FQC" | "STABILITY";
  parameter: string;
  method: string;
  unit: string;
  target: string;
}

const DEFAULT_BOM_ROWS = (): BomDraftRow[] => [
  {
    component_item_id: null,
    component_code: "MM-2X",
    component_name: "Hỗn hợp phản ứng MasterMix 2X (qPCR)",
    role: "MASTER_MIX",
    qty_per_kit: "1.25",
    qty_aliquoted: "1.0",
    uom: "mL",
    scrap_pct: "5",
    box_no: "1",
  },
  {
    component_item_id: null,
    component_code: "PM-SET",
    component_name: "Hỗn hợp Mồi & Mẫu dò đặc hiệu + Chứng nội (IC)",
    role: "PRIMER_PROBE",
    qty_per_kit: "0.25",
    qty_aliquoted: "0.2",
    uom: "mL",
    scrap_pct: "5",
    box_no: "1",
  },
];

const DEFAULT_ROUTING_ROWS = (): RoutingDraftRow[] => [
  {
    step_code: "STEP-1",
    step_name: "Chuẩn bị nguyên liệu & rã đông kiểm soát tại phòng Pre-PCR",
    params: "Phòng sạch ISO Class 7, tủ lạnh 2–8°C, khử UV trước 30 phút",
    qc_check: "Ngoại quan, HSD NVL & nhật ký nhiệt độ",
  },
  {
    step_code: "STEP-2",
    step_name: "Pha phối MasterMix & chia ống định lượng (Thường / Chia sẵn .D.IC)",
    params: "Tủ an toàn sinh học Class II, block giữ lạnh 2–8°C, tránh bọt khí",
    qc_check: "IPQC: Kiểm tra thể tích chiết rót (±3%) & pH dung dịch",
  },
  {
    step_code: "STEP-3",
    step_name: "Dán nhãn ống/hộp UDI, đóng gói 4 phiên bản IFU & lấy mẫu FQC",
    params: "Kiểm đếm đúng sơ đồ hộp & bảo quản ngay ở -20°C",
    qc_check: "FQC: Chứng dương (PC), Chứng nội (IC), Chứng âm (NTC) đạt TCCS",
  },
];

const DEFAULT_QC_ROWS = (): QcCriterionDraftRow[] => [
  { stage: "FQC", parameter: "Hiệu năng Chứng dương (PC)", method: "Real-time PCR SOP", unit: "Ct", target: "Đạt dải Ct chuẩn (18.0 – 28.0)" },
  { stage: "FQC", parameter: "Tín hiệu Chứng nội (IC)", method: "Kênh tham chiếu HEX/CY5", unit: "Ct", target: "Ct 20.0 – 32.0 ở mọi mẫu hợp lệ" },
  { stage: "FQC", parameter: "Kiểm soát Âm tính (NTC)", method: "Real-time PCR SOP", unit: "Ct", target: "Không khuếch đại (No Ct)" },
  { stage: "IPQC", parameter: "Độ đồng đều thể tích chia liều", method: "Cân vi lượng mẫu ngẫu nhiên", unit: "%", target: "Sai lệch <= ±3% so với định mức" },
];

/** `section="software"` shows only the software releases (KTCN software tab), without the technology transfer packages. */
export function TransferView({ canManage, canAccept, section = "all" }: { canManage: boolean; canAccept: boolean; section?: "all" | "software" }) {
  const qc = useQueryClient();
  const ctx = useRdContext("rd.view");
  const projects = useQuery({ queryKey: ["factory", "rd", "projects", ""], queryFn: () => api<any[]>("/api/factory/rd/projects") });
  const transfers = useQuery({ queryKey: ["factory", "rd", "transfers"], queryFn: () => api<any[]>("/api/factory/rd/transfers") });
  const templatesQuery = useQuery({ queryKey: ["factory", "rd", "transfer-templates"], queryFn: () => api<TransferTemplateRow[]>("/api/factory/rd/transfer-templates") });
  const swReleases = useQuery({ queryKey: ["factory", "rd", "sw-releases"], queryFn: () => api<any[]>("/api/factory/rd/software-releases") });

  const [addingTt, setAddingTt] = useState(false);
  const [editingTtId, setEditingTtId] = useState<string | null>(null);
  const [expandedPkgId, setExpandedPkgId] = useState<string | null>(null);
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [justCreatedMsg, setJustCreatedMsg] = useState<string | null>(null);
  const [addingSw, setAddingSw] = useState(false);

  // Tech transfer structured form state
  const [ttProjId, setTtProjId] = useState("");
  const [ttDomain, setTtDomain] = useState<"KIT" | "OLIGO" | "DEVICE" | "SOFTWARE">("KIT");
  const [ttTargetUnit, setTtTargetUnit] = useState("");
  const [ttTemplateId, setTtTemplateId] = useState("");
  const [ttTitle, setTtTitle] = useState("");
  const [ttProductItem, setTtProductItem] = useState("");
  const [bomRows, setBomRows] = useState<BomDraftRow[]>(DEFAULT_BOM_ROWS);
  const [routingRows, setRoutingRows] = useState<RoutingDraftRow[]>(DEFAULT_ROUTING_ROWS);
  const [qcRows, setQcRows] = useState<QcCriterionDraftRow[]>(DEFAULT_QC_ROWS);
  const [metaPackSize, setMetaPackSize] = useState("50 test/hộp (Thường & Chia sẵn .D.IC)");
  const [metaStorageTemp, setMetaStorageTemp] = useState("-20°C ± 5°C (Tránh rã đông lặp lại)");
  const [metaShelfLifeMonths, setMetaShelfLifeMonths] = useState("12");
  const [metaShipping, setMetaShipping] = useState("Đá khô / Gel lạnh -20°C duy trì 72h");
  const [metaInstruments, setMetaInstruments] = useState("CFX96, ABI 7500, LightCycler 480, Gentier 96");
  const [metaCleanroom, setMetaCleanroom] = useState("ISO Class 7 · Tủ an toàn sinh học Class II");
  const [metaPilotPlan, setMetaPilotPlan] = useState("Chạy 03 lô Pilot liên tiếp (100 kit/lô) kiểm nghiệm IPQC/FQC đạt 100%");
  const [ttStability, setTtStability] = useState("");
  const [ttValidation, setTtValidation] = useState("");
  const [ttPilotLotRef, setTtPilotLotRef] = useState("");
  const [ttNotes, setTtNotes] = useState("");
  const [prefillError, setPrefillError] = useState<string | null>(null);
  const [prefillLoading, setPrefillLoading] = useState(false);

  // Software release form state
  const [swProjId, setSwProjId] = useState("");
  const [swVersion, setSwVersion] = useState("v1.0.0");
  const [swKind, setSwKind] = useState("ASSAY_CALLER");
  const [swSafetyClass, setSwSafetyClass] = useState<"CLASS_A" | "CLASS_B" | "CLASS_C">("CLASS_B");
  const [swChecksum, setSwChecksum] = useState("");
  const [swSoupText, setSwSoupText] = useState("");
  const [swNotes, setSwNotes] = useState("");
  const [swValidation, setSwValidation] = useState("");
  const [swSourceRef, setSwSourceRef] = useState("");

  const templates = templatesQuery.data ?? [];
  const targetUnits = ctx.data?.targetUnits ?? [];

  const findUnitForDomain = (domain: string): string => {
    const modKey = domain === "SOFTWARE" ? "IT" : domain;
    return targetUnits.find((u) => u.module_key === modKey)?.id ?? targetUnits[0]?.id ?? "";
  };

  const findDefaultTemplateForDomain = (domain: string): string => {
    const tplDomain = domain === "SOFTWARE" ? "DEVICE" : domain;
    const match = templates.find((t) => t.domain === tplDomain && t.is_default) ?? templates.find((t) => t.domain === tplDomain) ?? templates[0];
    return match?.id ?? "";
  };

  // Initialize defaults when project/domain/templates load for new package creation
  useEffect(() => {
    if (!addingTt || editingTtId) return;
    const activeProjId = ttProjId || projects.data?.[0]?.id || "";
    if (!ttProjId && activeProjId) {
      setTtProjId(activeProjId);
      const proj = projects.data?.find((p) => p.id === activeProjId);
      const dom = (["KIT", "OLIGO", "DEVICE", "SOFTWARE"].includes(proj?.target_domain) ? proj.target_domain : "KIT") as any;
      setTtDomain(dom);
      setTtTargetUnit(findUnitForDomain(dom));
      setTtTemplateId(findDefaultTemplateForDomain(dom));
    } else {
      if (!ttTargetUnit && targetUnits.length > 0) setTtTargetUnit(findUnitForDomain(ttDomain));
      if (!ttTemplateId && templates.length > 0) setTtTemplateId(findDefaultTemplateForDomain(ttDomain));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addingTt, editingTtId, projects.data, targetUnits, templates]);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["factory", "rd", "transfers"] });
    qc.invalidateQueries({ queryKey: ["factory", "rd", "transfer-templates"] });
    qc.invalidateQueries({ queryKey: ["factory", "rd", "sw-releases"] });
    if (expandedPkgId) {
      qc.invalidateQueries({ queryKey: ["factory", "rd", "transfer-detail", expandedPkgId] });
    }
  };

  const resetForm = () => {
    setEditingTtId(null);
    setTtProjId("");
    setTtDomain("KIT");
    setTtTargetUnit("");
    setTtTemplateId("");
    setTtTitle("");
    setTtProductItem("");
    setBomRows(DEFAULT_BOM_ROWS());
    setRoutingRows(DEFAULT_ROUTING_ROWS());
    setQcRows(DEFAULT_QC_ROWS());
    setMetaPackSize("50 test/hộp (Thường & Chia sẵn .D.IC)");
    setMetaStorageTemp("-20°C ± 5°C (Tránh rã đông lặp lại)");
    setMetaShelfLifeMonths("12");
    setMetaShipping("Đá khô / Gel lạnh -20°C duy trì 72h");
    setMetaInstruments("CFX96, ABI 7500, LightCycler 480, Gentier 96");
    setMetaCleanroom("ISO Class 7 · Tủ an toàn sinh học Class II");
    setMetaPilotPlan("Chạy 03 lô Pilot liên tiếp (100 kit/lô) kiểm nghiệm IPQC/FQC đạt 100%");
    setTtStability("");
    setTtValidation("");
    setTtPilotLotRef("");
    setTtNotes("");
    setPrefillError(null);
  };

  const openEditDraftPackage = async (pkgId: string) => {
    const detail = await api<any>(`/api/factory/rd/transfers/${pkgId}`);
    setEditingTtId(pkgId);
    setAddingTt(true);
    setJustCreatedMsg(null);
    setTtProjId(detail.project_id);
    setTtDomain(detail.target_domain);
    setTtTargetUnit(detail.target_org_unit_id);
    setTtTemplateId(detail.template_id || "");
    setTtTitle(detail.title || "");
    setTtProductItem(detail.product_item_id || "");
    const boms = Array.isArray(detail.bom_specification) ? detail.bom_specification : [];
    setBomRows(
      boms.length > 0
        ? boms.map((b: any) => ({
            component_item_id: b.component_item_id || null,
            component_code: String(b.component_code || ""),
            component_name: String(b.component_name || ""),
            role: String(b.role || "REAGENT"),
            qty_per_kit: String(b.qty_per_kit ?? 1),
            qty_aliquoted: b.qty_aliquoted != null ? String(b.qty_aliquoted) : "",
            uom: String(b.uom || "mL"),
            scrap_pct: String(b.scrap_pct ?? 0),
            box_no: String(b.box_no ?? 1),
          }))
        : DEFAULT_BOM_ROWS()
    );
    const rts = Array.isArray(detail.routing_steps) ? detail.routing_steps : [];
    setRoutingRows(
      rts.length > 0
        ? rts.map((s: any, idx: number) => ({
            step_code: String(s.step_code || `STEP-${idx + 1}`),
            step_name: String(s.step_name || ""),
            params: String(s.params || ""),
            qc_check: String(s.qc_check || ""),
          }))
        : DEFAULT_ROUTING_ROWS()
    );
    const qcs = Array.isArray(detail.qc_release_criteria) ? detail.qc_release_criteria : [];
    setQcRows(
      qcs.length > 0
        ? qcs.map((c: any) => ({
            stage: c.stage || "FQC",
            parameter: String(c.parameter || ""),
            method: String(c.method || ""),
            unit: String(c.unit || ""),
            target: String(c.target || ""),
          }))
        : DEFAULT_QC_ROWS()
    );
    const m = detail.transfer_metadata ?? {};
    setMetaPackSize(m.pack_size || "");
    setMetaStorageTemp(m.storage_temp || "");
    setMetaShelfLifeMonths(m.shelf_life_months ? String(m.shelf_life_months) : "");
    setMetaShipping(m.shipping_condition || "");
    setMetaInstruments(m.compatible_instruments || "");
    setMetaCleanroom(m.cleanroom_class || "");
    setMetaPilotPlan(m.pilot_batch_plan || "");
    setTtStability(detail.stability_summary || "");
    setTtValidation(detail.validation_summary || "");
    setTtPilotLotRef(detail.pilot_lot_ref || "");
    setTtNotes(detail.notes || "");
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handlePrefillFromProject = async (projIdToFetch: string) => {
    if (!projIdToFetch) return;
    setPrefillError(null);
    setPrefillLoading(true);
    try {
      const pre = await api<any>(`/api/factory/rd/transfers?prefill_project_id=${encodeURIComponent(projIdToFetch)}`);
      if (pre?.project?.target_product_item_id) setTtProductItem(pre.project.target_product_item_id);
      if (Array.isArray(pre?.bom_specification) && pre.bom_specification.length > 0) {
        setBomRows(
          pre.bom_specification.map((b: any) => ({
            component_item_id: b.component_item_id || null,
            component_code: String(b.component_code || ""),
            component_name: String(b.component_name || ""),
            role: String(b.role || "REAGENT"),
            qty_per_kit: String(b.qty_per_kit ?? 1),
            qty_aliquoted: b.qty_aliquoted != null ? String(b.qty_aliquoted) : "",
            uom: String(b.uom || "µL"),
            scrap_pct: String(b.scrap_pct ?? 0),
            box_no: String(b.box_no ?? 1),
          }))
        );
      }
      if (Array.isArray(pre?.qc_release_criteria) && pre.qc_release_criteria.length > 0) {
        setQcRows(
          pre.qc_release_criteria.map((c: any) => ({
            stage: c.stage || "FQC",
            parameter: String(c.parameter || ""),
            method: String(c.method || ""),
            unit: String(c.unit || ""),
            target: String(c.target || ""),
          }))
        );
      }
      if (pre?.validation_summary) setTtValidation(pre.validation_summary);
    } catch (e: any) {
      setPrefillError(e?.message || "Không kéo được dữ liệu BOM / TPP từ dự án");
    } finally {
      setPrefillLoading(false);
    }
  };

  const buildPayload = (submitNow: boolean) => ({
    project_id: ttProjId || projects.data?.[0]?.id,
    template_id: ttTemplateId || null,
    target_domain: ttDomain,
    target_org_unit_id: ttTargetUnit || findUnitForDomain(ttDomain),
    title: ttTitle,
    product_item_id: ttProductItem || null,
    bom_specification: bomRows
      .filter((b) => b.component_code.trim() && b.component_name.trim())
      .map((b, idx) => ({
        line_no: idx + 1,
        component_item_id: b.component_item_id || null,
        component_code: b.component_code.trim(),
        component_name: b.component_name.trim(),
        box_no: Math.max(1, Number(b.box_no) || 1),
        qty_per_kit: Number(b.qty_per_kit) || 1,
        qty_aliquoted: b.qty_aliquoted ? Number(b.qty_aliquoted) : null,
        scrap_pct: Number(b.scrap_pct) || 0,
        uom: b.uom.trim() || "mL",
        role: b.role || null,
      })),
    routing_steps: routingRows
      .filter((s) => s.step_name.trim())
      .map((s, idx) => ({
        seq: idx + 1,
        step_code: s.step_code.trim() || `STEP-${idx + 1}`,
        step_name: s.step_name.trim(),
        params: s.params.trim() || null,
        qc_check: s.qc_check.trim() || null,
      })),
    qc_release_criteria: qcRows
      .filter((c) => c.parameter.trim() && c.target.trim())
      .map((c, idx) => ({
        seq: idx + 1,
        stage: c.stage,
        parameter: c.parameter.trim(),
        method: c.method.trim() || null,
        unit: c.unit.trim() || null,
        target: c.target.trim(),
      })),
    transfer_metadata: {
      pack_size: metaPackSize.trim() || null,
      storage_temp: metaStorageTemp.trim() || null,
      shelf_life_months: metaShelfLifeMonths ? Number(metaShelfLifeMonths) : null,
      shipping_condition: metaShipping.trim() || null,
      compatible_instruments: metaInstruments.trim() || null,
      cleanroom_class: metaCleanroom.trim() || null,
      pilot_batch_plan: metaPilotPlan.trim() || null,
    },
    stability_summary: ttStability,
    validation_summary: ttValidation,
    pilot_lot_ref: ttPilotLotRef.trim() || null,
    notes: ttNotes.trim() || null,
    submit_now: submitNow,
  });

  const createTtMut = useMutation({
    mutationFn: (submitNow: boolean) =>
      api<any>("/api/factory/rd/transfers", {
        method: "POST",
        idempotent: true,
        json: buildPayload(submitNow),
      }),
    onSuccess: (created) => {
      setAddingTt(false);
      resetForm();
      if (created?.id) {
        setExpandedPkgId(created.id);
        setJustCreatedMsg(
          created.status === "DRAFT"
            ? `Đã khởi tạo gói ${created.code}. Vui lòng kiểm tra Danh mục Hồ sơ chuẩn, đính kèm tệp tài liệu bên dưới trước khi bấm Gửi sang Sản xuất.`
            : `Đã tạo và gửi gói ${created.code} sang phòng Sản xuất tiếp nhận.`
        );
      }
      refresh();
    },
  });

  const updateTtMut = useMutation({
    mutationFn: () => {
      if (!editingTtId) throw new Error("Thiếu mã gói chuyển giao đang sửa");
      const p = buildPayload(false);
      return api(`/api/factory/rd/transfers/${editingTtId}`, {
        method: "PUT",
        json: {
          target_domain: p.target_domain,
          target_org_unit_id: p.target_org_unit_id,
          title: p.title,
          product_item_id: p.product_item_id,
          bom_specification: p.bom_specification,
          routing_steps: p.routing_steps,
          qc_release_criteria: p.qc_release_criteria,
          transfer_metadata: p.transfer_metadata,
          stability_summary: p.stability_summary,
          validation_summary: p.validation_summary,
          pilot_lot_ref: p.pilot_lot_ref,
          notes: p.notes,
        },
      });
    },
    onSuccess: (_, __) => {
      const savedId = editingTtId;
      setAddingTt(false);
      resetForm();
      if (savedId) setExpandedPkgId(savedId);
      setJustCreatedMsg("Đã lưu cập nhật thông tin kỹ thuật, BOM, Quy trình SOP & Chỉ tiêu QC.");
      refresh();
    },
  });

  const deleteTtMut = useMutation({
    mutationFn: (id: string) => api(`/api/factory/rd/transfers/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      setExpandedPkgId(null);
      refresh();
    },
  });

  const createSwMut = useMutation({
    mutationFn: () => {
      const soupList = swSoupText
        .split(/[\n,;]+/)
        .map((s) => s.trim())
        .filter(Boolean)
        .map((entry) => {
          const [name, version] = entry.split("@").map((x) => x.trim());
          return { name: name || entry, version: version || "unspecified" };
        });
      return api("/api/factory/rd/software-releases", {
        method: "POST",
        idempotent: true,
        json: {
          project_id: swProjId || projects.data?.[0]?.id,
          version_tag: swVersion,
          target_kind: swKind,
          safety_class: swSafetyClass,
          soup_list: soupList,
          checksum_sha256: swChecksum.trim() || null,
          release_notes: swNotes,
          validation_summary: swValidation,
          source_ref: swSourceRef.trim() || null,
        },
      });
    },
    onSuccess: () => {
      setAddingSw(false);
      setSwChecksum("");
      setSwSoupText("");
      setSwNotes("");
      setSwValidation("");
      setSwSourceRef("");
      refresh();
    },
  });

  const selectedTemplateObj = useMemo(
    () => templates.find((t) => t.id === ttTemplateId),
    [templates, ttTemplateId]
  );

  return (
    <div className="flex flex-col gap-3">
      {showTemplateModal && (
        <TransferTemplateModal
          templates={templates}
          onSaved={refresh}
          onClose={() => setShowTemplateModal(false)}
        />
      )}

      {/* 1. Technology Transfer Packages */}
      {section === "all" && (
        <Card
          title="Gói Chuyển giao Công nghệ sang Sản xuất (ISO 13485 — Bộ Hồ sơ 8 Phần, BOM, SOP & QC)"
          actions={
            canManage ? (
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="ghost" onClick={() => setShowTemplateModal(true)}>
                  <Settings2 className="w-3.5 h-3.5 mr-1" />
                  Cài đặt Mẫu Hồ sơ Chuyển giao
                </Button>
                <Button
                  onClick={() => {
                    if (addingTt) {
                      setAddingTt(false);
                      resetForm();
                    } else {
                      resetForm();
                      setAddingTt(true);
                      setJustCreatedMsg(null);
                    }
                  }}
                >
                  {addingTt ? "Đóng biểu mẫu" : "+ Lập gói chuyển giao công nghệ"}
                </Button>
              </div>
            ) : undefined
          }
        >
          <ErrorNote error={transfers.error ?? createTtMut.error ?? updateTtMut.error ?? deleteTtMut.error} />

          {justCreatedMsg && (
            <div className="mb-3 px-3.5 py-2.5 rounded-xl border border-emerald-300 dark:border-emerald-800 bg-emerald-50/70 dark:bg-emerald-950/30 text-xs text-emerald-900 dark:text-emerald-200 flex items-center justify-between gap-2">
              <span>✅ {justCreatedMsg}</span>
              <button type="button" onClick={() => setJustCreatedMsg(null)} className="font-bold cursor-pointer">×</button>
            </div>
          )}

          {addingTt && (
            <form
              className="space-y-4 p-4 mb-4 rounded-2xl border border-sky-200 dark:border-sky-900 bg-sky-50/35 dark:bg-sky-950/20 text-xs"
              onSubmit={(e) => {
                e.preventDefault();
                if (editingTtId) {
                  updateTtMut.mutate();
                } else {
                  const hasReqTpl = Boolean(selectedTemplateObj?.items?.some((i) => i.is_required));
                  createTtMut.mutate(!hasReqTpl && !ttTemplateId);
                }
              }}
            >
              <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-sky-200/70 dark:border-sky-800/60">
                <div className="font-bold text-sm text-sky-900 dark:text-sky-200">
                  {editingTtId ? "✏️ Chỉnh sửa Nội dung Gói Chuyển giao (Bản Nháp)" : "📋 Khởi tạo Gói Hồ sơ Chuyển giao Công nghệ sang Sản xuất"}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={prefillLoading || !(ttProjId || projects.data?.[0]?.id)}
                  onClick={() => handlePrefillFromProject(ttProjId || projects.data?.[0]?.id || "")}
                >
                  <Sparkles className="w-3.5 h-3.5 mr-1 text-amber-500" />
                  {prefillLoading ? "Đang kéo dữ liệu..." : "⚡ Kéo tự động BOM & Chỉ tiêu TPP từ Dự án"}
                </Button>
              </div>
              {prefillError && <ErrorNote error={new Error(prefillError)} />}

              {/* Section 1: Header & Template Selection */}
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Dự án R&D nguồn *">
                  <select
                    className={inputClass}
                    value={ttProjId || projects.data?.[0]?.id || ""}
                    disabled={Boolean(editingTtId)}
                    onChange={(e) => {
                      const nextPid = e.target.value;
                      setTtProjId(nextPid);
                      const proj = projects.data?.find((p) => p.id === nextPid);
                      if (proj && !editingTtId) {
                        const dom = (["KIT", "OLIGO", "DEVICE", "SOFTWARE"].includes(proj.target_domain) ? proj.target_domain : "KIT") as any;
                        setTtDomain(dom);
                        setTtTargetUnit(findUnitForDomain(dom));
                        setTtTemplateId(findDefaultTemplateForDomain(dom));
                      }
                    }}
                    required
                  >
                    {projects.data?.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.code} — {p.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Miền sản xuất đích *">
                  <select
                    className={inputClass}
                    value={ttDomain}
                    onChange={(e) => {
                      const nextDom = e.target.value as any;
                      setTtDomain(nextDom);
                      setTtTargetUnit(findUnitForDomain(nextDom));
                      if (!editingTtId) setTtTemplateId(findDefaultTemplateForDomain(nextDom));
                    }}
                  >
                    <option value="KIT">Sản xuất Kit (SX Kit)</option>
                    <option value="OLIGO">Tổng hợp Oligo</option>
                    <option value="DEVICE">Kỹ thuật - Công nghệ (Thiết bị)</option>
                    <option value="SOFTWARE">Phần mềm</option>
                  </select>
                </Field>
                <Field label="Phòng tiếp nhận *">
                  <select className={inputClass} value={ttTargetUnit} onChange={(e) => setTtTargetUnit(e.target.value)} required>
                    {targetUnits.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name} ({u.module_key})
                      </option>
                    ))}
                  </select>
                </Field>

                <div className="sm:col-span-2">
                  <Field label="Tiêu đề gói chuyển giao *">
                    <input
                      className={inputClass}
                      value={ttTitle}
                      onChange={(e) => setTtTitle(e.target.value)}
                      placeholder="VD: Hồ sơ chuyển giao Kit Real-time PCR Định lượng Đa mồi (50 test/hộp)"
                      required
                    />
                  </Field>
                </div>
                <Field label="Mã thành phẩm đích (tự sinh QC Spec & BOM)">
                  <select className={inputClass} value={ttProductItem} onChange={(e) => setTtProductItem(e.target.value)}>
                    <option value="">— Tự khởi tạo mã mới nếu chưa có —</option>
                    {ctx.data?.items.map((it) => (
                      <option key={it.id} value={it.id}>
                        {it.code} — {it.name}
                      </option>
                    ))}
                  </select>
                </Field>

                {!editingTtId && (
                  <div className="sm:col-span-3">
                    <Field label="Bộ Mẫu Danh mục Hồ sơ Chuyển giao áp dụng">
                      <div className="flex flex-wrap items-center gap-2">
                        <select className={`${inputClass} flex-1`} value={ttTemplateId} onChange={(e) => setTtTemplateId(e.target.value)}>
                          <option value="">— Không dùng bộ checklist mẫu (Chỉ gửi BOM & Tóm tắt) —</option>
                          {templates.map((tpl) => (
                            <option key={tpl.id} value={tpl.id}>
                              {tpl.code} — {tpl.name} ({tpl.items?.length ?? 0} hạng mục)
                            </option>
                          ))}
                        </select>
                        <Button type="button" variant="ghost" onClick={() => setShowTemplateModal(true)}>
                          Tùy chỉnh Mẫu
                        </Button>
                      </div>
                    </Field>
                  </div>
                )}
              </div>

              {/* Section 2: Metadata (Cold-chain / Cleanroom / Packaging) */}
              <div className="p-3 rounded-xl bg-white/80 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 space-y-2">
                <div className="font-bold text-slate-800 dark:text-slate-100">
                  1. Điều kiện Sản xuất, Bảo quản, Chuỗi lạnh &amp; Quy cách Đóng gói
                </div>
                <div className="grid gap-2.5 sm:grid-cols-3">
                  <Field label="Quy cách hộp / đóng gói">
                    <input className={inputClass} value={metaPackSize} onChange={(e) => setMetaPackSize(e.target.value)} />
                  </Field>
                  <Field label="Nhiệt độ bảo quản & Hạn dùng (tháng)">
                    <div className="flex gap-1.5">
                      <input className={inputClass} value={metaStorageTemp} onChange={(e) => setMetaStorageTemp(e.target.value)} placeholder="-20°C" />
                      <input type="number" className={`${inputClass} w-20`} value={metaShelfLifeMonths} onChange={(e) => setMetaShelfLifeMonths(e.target.value)} placeholder="12" />
                    </div>
                  </Field>
                  <Field label="Chuỗi lạnh vận chuyển">
                    <input className={inputClass} value={metaShipping} onChange={(e) => setMetaShipping(e.target.value)} />
                  </Field>
                  <Field label="Cấp phòng sạch / An toàn sinh học">
                    <input className={inputClass} value={metaCleanroom} onChange={(e) => setMetaCleanroom(e.target.value)} />
                  </Field>
                  <Field label="Hệ máy thiết bị / PCR tương thích">
                    <input className={inputClass} value={metaInstruments} onChange={(e) => setMetaInstruments(e.target.value)} />
                  </Field>
                  <Field label="Kế hoạch 03 lô Pilot (Process Validation)">
                    <input className={inputClass} value={metaPilotPlan} onChange={(e) => setMetaPilotPlan(e.target.value)} />
                  </Field>
                </div>
              </div>

              {/* Section 3: Multi-line BOM */}
              <div className="p-3 rounded-xl bg-white/80 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold text-slate-800 dark:text-slate-100">
                    2. Công thức &amp; Định mức BOM Đa cấp ({bomRows.length} thành phần)
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    className="!min-h-7 !py-0.5 !px-2 !text-[11px]"
                    onClick={() =>
                      setBomRows([
                        ...bomRows,
                        {
                          component_item_id: null,
                          component_code: "",
                          component_name: "",
                          role: "REAGENT",
                          qty_per_kit: "1",
                          qty_aliquoted: "",
                          uom: "mL",
                          scrap_pct: "5",
                          box_no: "1",
                        },
                      ])
                    }
                  >
                    <Plus className="w-3 h-3 mr-1" /> Thêm dòng BOM
                  </Button>
                </div>
                <div className="space-y-1.5">
                  {bomRows.map((row, idx) => (
                    <div key={idx} className="grid gap-1.5 sm:grid-cols-12 items-center">
                      <div className="sm:col-span-2">
                        <input
                          className={`${inputClass} !py-1 !text-[11px] font-mono`}
                          value={row.component_code}
                          onChange={(e) => {
                            const copy = [...bomRows];
                            copy[idx] = { ...row, component_code: e.target.value };
                            setBomRows(copy);
                          }}
                          placeholder="Mã TP*"
                          required
                        />
                      </div>
                      <div className="sm:col-span-3">
                        <input
                          className={`${inputClass} !py-1 !text-[11px]`}
                          value={row.component_name}
                          onChange={(e) => {
                            const copy = [...bomRows];
                            copy[idx] = { ...row, component_name: e.target.value };
                            setBomRows(copy);
                          }}
                          placeholder="Tên thành phần / Hóa chất / Vật tư*"
                          required
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <select
                          className={`${inputClass} !py-1 !text-[11px]`}
                          value={row.role}
                          onChange={(e) => {
                            const copy = [...bomRows];
                            copy[idx] = { ...row, role: e.target.value };
                            setBomRows(copy);
                          }}
                        >
                          <option value="MASTER_MIX">MasterMix</option>
                          <option value="PRIMER_PROBE">Primer/Probe</option>
                          <option value="ENZYME">Enzyme/RT</option>
                          <option value="POSITIVE_CONTROL">Chứng dương (PC)</option>
                          <option value="NEGATIVE_CONTROL">Chứng âm (NTC)</option>
                          <option value="EXTRACTION_BUFFER">Đệm tách chiết</option>
                          <option value="PACKAGING">Bao bì / Strip</option>
                          <option value="REAGENT">Thuốc thử khác</option>
                        </select>
                      </div>
                      <div className="sm:col-span-1">
                        <input
                          type="number"
                          step="any"
                          className={`${inputClass} !py-1 !text-[11px] font-mono`}
                          value={row.qty_per_kit}
                          onChange={(e) => {
                            const copy = [...bomRows];
                            copy[idx] = { ...row, qty_per_kit: e.target.value };
                            setBomRows(copy);
                          }}
                          title="Định mức Thường / Kit"
                          required
                        />
                      </div>
                      <div className="sm:col-span-1">
                        <input
                          type="number"
                          step="any"
                          className={`${inputClass} !py-1 !text-[11px] font-mono`}
                          value={row.qty_aliquoted}
                          onChange={(e) => {
                            const copy = [...bomRows];
                            copy[idx] = { ...row, qty_aliquoted: e.target.value };
                            setBomRows(copy);
                          }}
                          placeholder=".D.IC"
                          title="Định mức Chia sẵn (.D.IC)"
                        />
                      </div>
                      <div className="sm:col-span-1">
                        <input
                          className={`${inputClass} !py-1 !text-[11px] font-mono`}
                          value={row.uom}
                          onChange={(e) => {
                            const copy = [...bomRows];
                            copy[idx] = { ...row, uom: e.target.value };
                            setBomRows(copy);
                          }}
                          placeholder="ĐVT"
                          required
                        />
                      </div>
                      <div className="sm:col-span-1">
                        <input
                          type="number"
                          className={`${inputClass} !py-1 !text-[11px] font-mono`}
                          value={row.scrap_pct}
                          onChange={(e) => {
                            const copy = [...bomRows];
                            copy[idx] = { ...row, scrap_pct: e.target.value };
                            setBomRows(copy);
                          }}
                          title="% Hao hụt"
                        />
                      </div>
                      <div className="sm:col-span-1 flex justify-end">
                        <button
                          type="button"
                          disabled={bomRows.length <= 1}
                          onClick={() => setBomRows(bomRows.filter((_, i) => i !== idx))}
                          className="p-1 rounded text-rose-600 hover:bg-rose-50 disabled:opacity-30 cursor-pointer"
                          title="Xóa dòng BOM"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Section 4: Multi-step Routing / SOP */}
              <div className="p-3 rounded-xl bg-white/80 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold text-slate-800 dark:text-slate-100">
                    3. Quy trình Công đoạn Sản xuất / SOP Pha chế – Đóng gói ({routingRows.length} bước)
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    className="!min-h-7 !py-0.5 !px-2 !text-[11px]"
                    onClick={() =>
                      setRoutingRows([
                        ...routingRows,
                        { step_code: `STEP-${routingRows.length + 1}`, step_name: "", params: "", qc_check: "" },
                      ])
                    }
                  >
                    <Plus className="w-3 h-3 mr-1" /> Thêm công đoạn
                  </Button>
                </div>
                <div className="space-y-1.5">
                  {routingRows.map((st, idx) => (
                    <div key={idx} className="grid gap-1.5 sm:grid-cols-12 items-center">
                      <div className="sm:col-span-4">
                        <input
                          className={`${inputClass} !py-1 !text-[11px]`}
                          value={st.step_name}
                          onChange={(e) => {
                            const copy = [...routingRows];
                            copy[idx] = { ...st, step_name: e.target.value };
                            setRoutingRows(copy);
                          }}
                          placeholder={`Tên công đoạn ${idx + 1}*`}
                          required
                        />
                      </div>
                      <div className="sm:col-span-4">
                        <input
                          className={`${inputClass} !py-1 !text-[11px]`}
                          value={st.params}
                          onChange={(e) => {
                            const copy = [...routingRows];
                            copy[idx] = { ...st, params: e.target.value };
                            setRoutingRows(copy);
                          }}
                          placeholder="Điều kiện phòng sạch, nhiệt độ, tốc độ..."
                        />
                      </div>
                      <div className="sm:col-span-3">
                        <input
                          className={`${inputClass} !py-1 !text-[11px]`}
                          value={st.qc_check}
                          onChange={(e) => {
                            const copy = [...routingRows];
                            copy[idx] = { ...st, qc_check: e.target.value };
                            setRoutingRows(copy);
                          }}
                          placeholder="Điểm kiểm tra IPQC/FQC"
                        />
                      </div>
                      <div className="sm:col-span-1 flex justify-end">
                        <button
                          type="button"
                          onClick={() => setRoutingRows(routingRows.filter((_, i) => i !== idx))}
                          className="p-1 rounded text-rose-600 hover:bg-rose-50 cursor-pointer"
                          title="Xóa bước"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Section 5: QC Release Criteria */}
              <div className="p-3 rounded-xl bg-white/80 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold text-slate-800 dark:text-slate-100">
                    4. Bảng Chỉ tiêu Kiểm nghiệm Xuất xưởng IQC / IPQC / FQC ({qcRows.length} chỉ tiêu)
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    className="!min-h-7 !py-0.5 !px-2 !text-[11px]"
                    onClick={() => setQcRows([...qcRows, { stage: "FQC", parameter: "", method: "", unit: "", target: "" }])}
                  >
                    <Plus className="w-3 h-3 mr-1" /> Thêm chỉ tiêu QC
                  </Button>
                </div>
                <div className="space-y-1.5">
                  {qcRows.map((c, idx) => (
                    <div key={idx} className="grid gap-1.5 sm:grid-cols-12 items-center">
                      <div className="sm:col-span-2">
                        <select
                          className={`${inputClass} !py-1 !text-[11px] font-mono`}
                          value={c.stage}
                          onChange={(e) => {
                            const copy = [...qcRows];
                            copy[idx] = { ...c, stage: e.target.value as any };
                            setQcRows(copy);
                          }}
                        >
                          <option value="IQC">IQC</option>
                          <option value="IPQC">IPQC</option>
                          <option value="FQC">FQC</option>
                          <option value="STABILITY">STABILITY</option>
                        </select>
                      </div>
                      <div className="sm:col-span-3">
                        <input
                          className={`${inputClass} !py-1 !text-[11px]`}
                          value={c.parameter}
                          onChange={(e) => {
                            const copy = [...qcRows];
                            copy[idx] = { ...c, parameter: e.target.value };
                            setQcRows(copy);
                          }}
                          placeholder="Tên chỉ tiêu*"
                        />
                      </div>
                      <div className="sm:col-span-3">
                        <input
                          className={`${inputClass} !py-1 !text-[11px]`}
                          value={c.method}
                          onChange={(e) => {
                            const copy = [...qcRows];
                            copy[idx] = { ...c, method: e.target.value };
                            setQcRows(copy);
                          }}
                          placeholder="Phương pháp thử"
                        />
                      </div>
                      <div className="sm:col-span-1">
                        <input
                          className={`${inputClass} !py-1 !text-[11px] font-mono`}
                          value={c.unit}
                          onChange={(e) => {
                            const copy = [...qcRows];
                            copy[idx] = { ...c, unit: e.target.value };
                            setQcRows(copy);
                          }}
                          placeholder="ĐVT"
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <input
                          className={`${inputClass} !py-1 !text-[11px] font-semibold`}
                          value={c.target}
                          onChange={(e) => {
                            const copy = [...qcRows];
                            copy[idx] = { ...c, target: e.target.value };
                            setQcRows(copy);
                          }}
                          placeholder="Ngưỡng đạt*"
                        />
                      </div>
                      <div className="sm:col-span-1 flex justify-end">
                        <button
                          type="button"
                          onClick={() => setQcRows(qcRows.filter((_, i) => i !== idx))}
                          className="p-1 rounded text-rose-600 hover:bg-rose-50 cursor-pointer"
                          title="Xóa chỉ tiêu"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Section 6: Stability & Validation Summaries */}
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Tóm tắt dữ liệu độ ổn định (Real-time / Tăng tốc / Sau mở nắp) *">
                  <textarea
                    rows={2}
                    className={inputClass}
                    value={ttStability}
                    onChange={(e) => setTtStability(e.target.value)}
                    placeholder="Ổn định 12 tháng ở -20°C, 5 chu kỳ rã đông không suy giảm Ct quá 0.5 chu kỳ..."
                    required
                  />
                </Field>
                <Field label="Tóm tắt kết quả thẩm định hiệu năng (LoD, Độ lặp lại, Lâm sàng) *">
                  <textarea
                    rows={2}
                    className={inputClass}
                    value={ttValidation}
                    onChange={(e) => setTtValidation(e.target.value)}
                    placeholder="LoD95% đạt chuẩn CLSI EP17, CV nội lô < 2.1%, độ tương đồng lâm sàng > 98%..."
                    required
                  />
                </Field>
                <Field label="Tham chiếu lô Pilot dự kiến">
                  <input className={inputClass} value={ttPilotLotRef} onChange={(e) => setTtPilotLotRef(e.target.value)} placeholder="VD: PILOT-01, PILOT-02, PILOT-03" />
                </Field>
                <Field label="Ghi chú bàn giao thêm">
                  <input className={inputClass} value={ttNotes} onChange={(e) => setTtNotes(e.target.value)} placeholder="Lưu ý đặc biệt về thiết bị, bảo quản hoặc đào tạo..." />
                </Field>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-sky-200/70 dark:border-sky-800/60">
                <span className="text-[11px] text-slate-600 dark:text-slate-300">
                  {ttTemplateId
                    ? "💡 Khi lưu Bản nháp, hệ thống tự động sinh đầy đủ Danh mục Hồ sơ theo Mẫu để bạn đính kèm từng tài liệu PDF/DOCX/XLSX/Raw Data."
                    : "Không áp dụng checklist mẫu."}
                </span>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      setAddingTt(false);
                      resetForm();
                    }}
                  >
                    Hủy
                  </Button>
                  <Button type="submit" disabled={createTtMut.isPending || updateTtMut.isPending}>
                    {editingTtId
                      ? updateTtMut.isPending
                        ? "Đang lưu..."
                        : "💾 Lưu cập nhật Gói Nháp"
                      : createTtMut.isPending
                      ? "Đang khởi tạo..."
                      : ttTemplateId
                      ? "💾 Lưu Bản Nháp & Mở Đính kèm Hồ sơ"
                      : "🚀 Tạo & Gửi gói chuyển giao"}
                  </Button>
                </div>
              </div>
            </form>
          )}

          {transfers.data?.length === 0 && <Empty>Chưa có gói chuyển giao công nghệ nào.</Empty>}
          {transfers.data && transfers.data.length > 0 && (
            <div className="flex flex-col gap-3">
              {transfers.data.map((t) => {
                const isExpanded = expandedPkgId === t.id;
                const bomList = Array.isArray(t.bom_specification) ? t.bom_specification : [];
                const dossierTotal = Number(t.dossier_total ?? 0);
                const dossierDone = Number(t.dossier_done ?? 0);
                const requiredTotal = Number(t.required_total ?? 0);
                const requiredDone = Number(t.required_done ?? 0);
                const fileCount = Number(t.file_count ?? 0);
                const pct = requiredTotal > 0 ? Math.round((requiredDone / requiredTotal) * 100) : 100;

                return (
                  <div key={t.id} className="p-3.5 rounded-2xl border border-slate-200 dark:border-slate-800 text-xs flex flex-col gap-2.5 bg-white dark:bg-slate-950/30">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <span className="font-mono font-bold text-sky-700 dark:text-sky-400">{t.code}</span> — <b>{t.title}</b>
                        <span className="ml-2 text-slate-500">
                          (Dự án <code className="font-mono">{t.project_code}</code> → Phòng nhận: <b>{t.target_org_unit_name}</b> · {DOMAIN_LABEL[t.target_domain] ?? t.target_domain})
                        </span>
                      </div>
                      <StatusBadge status={TT_STATUS[t.status]?.[0] ?? "QUARANTINE"} label={TT_STATUS[t.status]?.[1] ?? t.status} />
                    </div>

                    {/* Progress & Summary Grid */}
                    <div className="grid gap-2 sm:grid-cols-2 text-[11px] bg-slate-50/70 dark:bg-slate-900/50 p-2.5 rounded-xl border border-slate-100 dark:border-slate-800">
                      <div><b>Độ ổn định:</b> {t.stability_summary}</div>
                      <div><b>Thẩm định hiệu năng:</b> {t.validation_summary}</div>
                      <div>
                        <b>Cấu trúc BOM chuyển giao ({bomList.length} TP):</b>{" "}
                        {bomList.length > 0
                          ? bomList
                              .slice(0, 5)
                              .map((b: any) => `${b.component_code || b.item_code || "TP"} (${b.qty_per_kit ?? b.qty_per_base ?? 1} ${b.uom || "đv"})`)
                              .join(", ") + (bomList.length > 5 ? ` …(+${bomList.length - 5})` : "")
                          : "—"}
                      </div>
                      <div>
                        <b>Tiêu chuẩn QC tự sinh bên QA/QC:</b>{" "}
                        {t.created_qc_spec_code ? (
                          <span className="font-mono font-bold text-emerald-700 dark:text-emerald-400">{t.created_qc_spec_code} (DRAFT)</span>
                        ) : (
                          "Sinh tự động khi phòng nhận ký duyệt"
                        )}
                      </div>
                    </div>

                    {dossierTotal > 0 && (
                      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] px-1">
                        <div className="flex items-center gap-2 flex-1 min-w-[240px]">
                          <span className="font-semibold text-slate-700 dark:text-slate-200">
                            📂 Hồ sơ bắt buộc: <b>{requiredDone}/{requiredTotal}</b> ({pct}%) · Tổng: {dossierDone}/{dossierTotal} mục · 📎 <b>{fileCount}</b> tệp
                          </span>
                          <div className="w-28 h-1.5 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
                            <div
                              className={`h-full transition-all ${pct === 100 ? "bg-emerald-600" : "bg-sky-600"}`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                        {t.template_code && (
                          <span className="font-mono text-[10px] text-slate-400">Mẫu: {t.template_code}</span>
                        )}
                      </div>
                    )}

                    {t.accepted_by_name && (
                      <div className="text-[11px] text-slate-500">
                        Đã ký tiếp nhận bởi <b>{t.accepted_by_name}</b> ({fmtDate(t.accepted_at)})
                        {t.pilot_lot_ref && ` · Lô Pilot đạt: ${t.pilot_lot_ref}`}
                      </div>
                    )}

                    <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Button
                          type="button"
                          variant={isExpanded ? "primary" : "ghost"}
                          className="!min-h-8 !py-1 !px-2.5 !text-[11px]"
                          onClick={() => setExpandedPkgId(isExpanded ? null : t.id)}
                        >
                          {isExpanded ? <ChevronDown className="w-3.5 h-3.5 mr-1" /> : <ChevronRight className="w-3.5 h-3.5 mr-1" />}
                          <FolderOpen className="w-3.5 h-3.5 mr-1" />
                          Hồ sơ Chi tiết &amp; Đính kèm File ({fileCount})
                        </Button>

                        {t.status === "DRAFT" && canManage && (
                          <>
                            <Button
                              type="button"
                              variant="ghost"
                              className="!min-h-8 !py-1 !px-2.5 !text-[11px]"
                              onClick={() => openEditDraftPackage(t.id)}
                            >
                              <Pencil className="w-3.5 h-3.5 mr-1" />
                              Sửa thông tin / BOM / SOP
                            </Button>
                            <Button
                              type="button"
                              variant="danger"
                              className="!min-h-8 !py-1 !px-2.5 !text-[11px]"
                              disabled={deleteTtMut.isPending}
                              onClick={() => {
                                if (confirm(`Xóa gói chuyển giao nháp "${t.code} — ${t.title}"?`)) {
                                  deleteTtMut.mutate(t.id);
                                }
                              }}
                            >
                              <Trash2 className="w-3.5 h-3.5 mr-1" />
                              Xóa nháp
                            </Button>
                          </>
                        )}
                      </div>

                      {(canManage || canAccept) && (
                        <ActionBar
                          endpoint={`/api/factory/rd/transfers/${t.id}/actions`}
                          version={t.version}
                          actions={(t.actions ?? []) as AllowedAction[]}
                          labels={TT_ACTIONS}
                          onDone={refresh}
                        />
                      )}
                    </div>

                    {isExpanded && (
                      <TransferPackageDetailWorkspace
                        packageId={t.id}
                        templates={templates}
                        canManage={canManage}
                        canAccept={canAccept}
                        onPackageMutated={refresh}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      )}

      {/* 2. Software Releases (D6) */}
      <Card
        title="Phát hành Phần mềm & Thuật toán Y sinh (IEC 62304 Software Release — D6)"
        actions={canManage ? <Button variant="ghost" onClick={() => setAddingSw(!addingSw)}>+ Tạo bản phát hành phần mềm</Button> : undefined}
      >
        <ErrorNote error={swReleases.error ?? createSwMut.error} />

        {addingSw && (
          <form
            className="grid gap-3 sm:grid-cols-3 p-3 mb-3 rounded-xl border border-slate-200 dark:border-slate-800"
            onSubmit={(e) => {
              e.preventDefault();
              createSwMut.mutate();
            }}
          >
            <Field label="Dự án R&D *">
              <select className={inputClass} value={swProjId || projects.data?.[0]?.id || ""} onChange={(e) => setSwProjId(e.target.value)} required>
                {projects.data?.map((p) => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
              </select>
            </Field>
            <Field label="Phiên bản (Version Tag) *">
              <input className={inputClass} value={swVersion} onChange={(e) => setSwVersion(e.target.value)} placeholder="v1.2.0" required />
            </Field>
            <Field label="Loại phần mềm *">
              <select className={inputClass} value={swKind} onChange={(e) => setSwKind(e.target.value)}>
                <option value="ASSAY_CALLER">Thuật toán phân tích Ct / Assay Caller</option>
                <option value="FIRMWARE">Firmware Thiết bị Lab</option>
                <option value="LIMS_PLUGIN">Module LIMS / MES</option>
                <option value="STANDALONE">Phần mềm độc lập (SaMD)</option>
              </select>
            </Field>
            <Field label="Phân loại an toàn IEC 62304 *">
              <select className={inputClass} value={swSafetyClass} onChange={(e) => setSwSafetyClass(e.target.value as any)}>
                <option value="CLASS_A">Class A (Không gây tổn hại)</option>
                <option value="CLASS_B">Class B (Tổn hại không nghiêm trọng)</option>
                <option value="CLASS_C">Class C (Nguy cơ tử vong / nghiêm trọng)</option>
              </select>
            </Field>
            <div className="sm:col-span-3 grid gap-2 sm:grid-cols-2">
              <Field label="Nội dung phát hành (Release Notes) *">
                <input className={inputClass} value={swNotes} onChange={(e) => setSwNotes(e.target.value)} required />
              </Field>
              <Field label="Kết quả kiểm thử / Thẩm định (Validation Summary) *">
                <input className={inputClass} value={swValidation} onChange={(e) => setSwValidation(e.target.value)} required />
              </Field>
              <Field label="Commit / tag mã nguồn của bản dựng">
                <input className={`${inputClass} font-mono`} placeholder="git: fw-release@v1.2.0" value={swSourceRef} onChange={(e) => setSwSourceRef(e.target.value)} />
              </Field>
              <Field label="SHA-256 Checksum bản dựng (64 hex — bắt buộc nếu Class C)">
                <input className={`${inputClass} font-mono`} placeholder="64 ký tự hex SHA-256" value={swChecksum} onChange={(e) => setSwChecksum(e.target.value)} />
              </Field>
              <Field label="Danh sách SOUP (thư viện bên thứ 3, VD: openssl@3.0, numpy@1.26)">
                <input className={inputClass} placeholder="package@version, ..." value={swSoupText} onChange={(e) => setSwSoupText(e.target.value)} />
              </Field>
            </div>
            <div className="sm:col-span-3 flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setAddingSw(false)}>Hủy</Button>
              <Button type="submit" disabled={createSwMut.isPending}>Lưu bản nháp phát hành</Button>
            </div>
          </form>
        )}

        {swReleases.data?.length === 0 && <Empty>Chưa có bản phát hành phần mềm nào.</Empty>}
        {swReleases.data && swReleases.data.length > 0 && (
          <Table head={["Mã", "Dự án", "Phiên bản", "Loại / Class", "Release Notes & Thẩm định", "Người ký phát hành", "Trạng thái", "Thao tác"]}>
            {swReleases.data.map((sr) => (
              <tr key={sr.id}>
                <td className="py-2 pr-3 font-mono font-semibold text-sky-700 dark:text-sky-400">{sr.code}</td>
                <td className="py-2 pr-3 font-mono">{sr.project_code}</td>
                <td className="py-2 pr-3 font-mono font-bold">{sr.version_tag}</td>
                <td className="py-2 pr-3 font-mono">
                  <div>{sr.target_kind}</div>
                  {sr.safety_class && (
                    <span className="inline-block mt-0.5 rounded bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 text-[10px] font-semibold">
                      {sr.safety_class}
                    </span>
                  )}
                </td>
                <td className="py-2 pr-3">
                  <div>{sr.release_notes}</div>
                  <div className="text-[11px] text-slate-500">Thẩm định: {sr.validation_summary}</div>
                </td>
                <td className="py-2 pr-3">{sr.released_by_name || "—"}</td>
                <td className="py-2 pr-3">
                  <StatusBadge status={SW_STATUS[sr.status]?.[0] ?? "QUARANTINE"} label={SW_STATUS[sr.status]?.[1] ?? sr.status} />
                </td>
                <td className="py-2 pr-3">
                  <ActionBar
                    endpoint={`/api/factory/rd/software-releases/${sr.id}/actions`}
                    version={sr.version}
                    actions={(sr.actions ?? []) as AllowedAction[]}
                    labels={SW_ACTIONS}
                    onDone={refresh}
                  />
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}

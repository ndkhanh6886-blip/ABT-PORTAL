"use client";

import React, { Fragment, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ActionBar, type AllowedAction } from "../actions";
import { api, fmtDate, fmtQty, useFactoryMe } from "../api";
import { printKitCoaCertificate, printTestCoa } from "../coa";
import {
  DEFAULT_COA_TEMPLATES,
  DEFAULT_QC_FORMS_CONFIG,
  normalizeQcFormsConfig,
  resolveCoaTemplate,
  stripVnAccents,
  suggestCoaTemplateKey,
  type CoaCustomFields,
  type CoaTemplateCategory,
  type CoaTemplateVariant,
  type QcFormsConfig,
  type QcStaffSignatureEntry,
} from "../qcSignatures";
import { Button, Card, Empty, ErrorNote, Field, inputClass, StatusBadge, Table } from "../ui";
import { QcDocumentPreview } from "./QcDocumentPreview";

interface QcRow {
  id: string;
  code: string;
  test_kind: string;
  status: string;
  overall_result: string | null;
  spec_code: string;
  spec_name: string;
  lot_code: string | null;
  item_code: string | null;
  item_name: string | null;
  sequence_code: string | null;
  sequence_name: string | null;
  order_code?: string | null;
  coa_code?: string | null;
  created_at: string;
}
interface Parameter {
  id: string;
  seq: number;
  name: string;
  method: string | null;
  unit: string | null;
  value_type: "NUMERIC" | "TEXT" | "PASS_FAIL";
  lower_limit: string | null;
  upper_limit: string | null;
  target: string | null;
  is_critical: boolean;
  derived_metric: "MW_DELTA_DA" | "OD_TOTAL" | "YIELD_NMOL" | "YIELD_UG" | null;
}
interface QcDetail extends QcRow {
  version: number;
  entity_type: string;
  entity_id: string;
  analyst_id: number | null;
  analyst_name: string | null;
  reviewer_name: string | null;
  spec_version: number;
  retest_reason: string | null;
  parameters: Parameter[];
  results: { parameter_id: string; value_numeric: string | null; observed_numeric: string | null; value_text: string | null; passed: boolean | null }[];
  subject: { label: string; reference: Record<string, any> | null } | null;
  actions: AllowedAction[];
}

export const QC_STATUS_LABEL: Record<string, string> = {
  PLANNED: "Chờ kiểm nghiệm",
  IN_PROGRESS: "Đang kiểm nghiệm",
  RESULTS_ENTERED: "Chờ duyệt",
  REVIEWED: "Đã duyệt",
  CANCELLED: "Đã hủy",
};
const ACTION_LABEL: Record<string, string> = {
  start: "Bắt đầu kiểm nghiệm",
  submit_results: "Gửi kết quả",
  review: "Duyệt kết quả",
  return: "Trả lại",
  cancel: "Hủy phiếu",
};

const DERIVED_HINT: Record<string, string> = { OD_TOTAL: "tổng OD", YIELD_NMOL: "nmol", YIELD_UG: "µg" };
const fromSubject = (p: Parameter) => p.derived_metric != null && p.derived_metric !== "MW_DELTA_DA";

function OligoReference({ r }: { r: Record<string, any> }) {
  const items: [string, React.ReactNode][] = [
    ["Trình tự", <span key="s" className="font-mono break-all">{r.normalized_sequence}</span>],
    ["Số base", r.base_count],
    ["MW lý thuyết", `${r.mw} Da`],
    ["ε260", r.ext_coeff_260],
    ["Thang / tinh sạch", `${r.scale_code} · ${r.purification}`],
    ["Đo được", r.od_total != null ? `${r.od_total} OD · ${r.nmol} nmol · ${r.ug} µg` : "—"],
    ["Cam kết thang", r.scale_od_min != null ? `≥ ${r.scale_od_min} OD` : `${r.scale_nmol} nmol tổng hợp`],
  ];
  return (
    <div className="grid gap-x-4 gap-y-1 sm:grid-cols-2 text-xs p-3 rounded-xl bg-slate-50 dark:bg-slate-950/50 border border-slate-200 dark:border-slate-800">
      {items.map(([k, v]) => <div key={k}><span className="text-slate-500">{k}: </span>{v}</div>)}
    </div>
  );
}

const limits = (p: Parameter) =>
  p.value_type === "NUMERIC"
    ? [p.lower_limit != null ? `≥ ${Number(p.lower_limit)}` : null, p.upper_limit != null ? `≤ ${Number(p.upper_limit)}` : null].filter(Boolean).join(", ") || "—"
    : p.value_type === "PASS_FAIL"
      ? "Đạt"
      : p.target ?? "—";

function QcDetailPanel({
  id,
  standards,
  standardUsages,
  formsConfig,
  issuedCoas,
  onClose,
}: {
  id: string;
  standards: any[];
  standardUsages: any[];
  formsConfig: QcFormsConfig;
  issuedCoas: any[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const me = useFactoryMe();
  const test = useQuery({ queryKey: ["factory", "qc-test", id], queryFn: () => api<QcDetail>(`/api/factory/qms/tests/${id}`) });
  const [previewMode, setPreviewMode] = useState<null | "QC_REPORT" | "COA">(null);
  const reportQuery = useQuery({
    queryKey: ["factory", "qc-test-coa", id],
    queryFn: () => api<any>(`/api/factory/qms/tests/${id}/coa`),
    enabled: test.data?.status === "REVIEWED" && (previewMode !== null || Boolean(test.data?.coa_code)),
  });
  const [values, setValues] = useState<Record<string, string>>({});

  // Reference Standard usage form state
  const [stdId, setStdId] = useState("");
  const [stdMeasuredVal, setStdMeasuredVal] = useState("");
  const [stdNotes, setStdNotes] = useState("");
  const [retainQty, setRetainQty] = useState("2");
  const [releaseNotice, setReleaseNotice] = useState<string | null>(null);
  const [sigMethod, setSigMethod] = useState<"PIN" | "PASSWORD">("PIN");
  const [sigSecret, setSigSecret] = useState("");
  const [selectedTplKey, setSelectedTplKey] = useState<string>("");
  const [customFields, setCustomFields] = useState<CoaCustomFields>({});

  useEffect(() => {
    if (!test.data) return;
    const autoKey = suggestCoaTemplateKey(formsConfig, {
      item_code: test.data.item_code,
      item_name: test.data.item_name,
      test_kind: test.data.test_kind,
    });
    const tpl = resolveCoaTemplate(formsConfig, autoKey);
    setSelectedTplKey(tpl.key);
    setCustomFields((prev) => ({
      ...prev,
      contract_no: prev.contract_no ?? tpl.default_contract_no ?? "",
      oem_partner: prev.oem_partner ?? tpl.oem_partner_name ?? "",
    }));
    setValues(
      Object.fromEntries(
        test.data.results.map((r) => [
          r.parameter_id,
          r.observed_numeric != null
            ? String(Number(r.observed_numeric))
            : r.value_numeric != null
              ? String(Number(r.value_numeric))
              : r.value_text ?? "",
        ])
      )
    );
  }, [test.data]);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["factory", "qc-test", id] });
    qc.invalidateQueries({ queryKey: ["factory", "qc-tests"] });
    qc.invalidateQueries({ queryKey: ["factory", "qa-ops"] });
    qc.invalidateQueries({ queryKey: ["factory", "lot"] });
    qc.invalidateQueries({ queryKey: ["factory", "stock"] });
  };

  const save = useMutation({
    mutationFn: () =>
      api(`/api/factory/qms/tests/${id}/results`, {
        method: "PUT",
        json: {
          results: test.data!.parameters
            .filter((p) => fromSubject(p) || (values[p.id] ?? "") !== "")
            .map((p) =>
              fromSubject(p)
                ? { parameter_id: p.id }
                : p.value_type === "NUMERIC"
                  ? { parameter_id: p.id, value_numeric: Number(values[p.id].replace(",", ".")) }
                  : { parameter_id: p.id, value_text: values[p.id] }
            ),
        },
      }),
    onSuccess: refresh,
  });

  const recordStdMut = useMutation({
    mutationFn: () =>
      api("/api/factory/qms/ops", {
        method: "POST",
        json: {
          op: "record_standard_usage",
          standard_id: stdId,
          test_id: id,
          measured_value: stdMeasuredVal !== "" ? Number(stdMeasuredVal) : null,
          aliquots_used: 1,
          freeze_thaw_increment: 1,
          notes: stdNotes || null,
        },
      }),
    onSuccess: () => {
      setStdMeasuredVal("");
      setStdNotes("");
      refresh();
    },
  });

  const issueCoaMut = useMutation({
    mutationFn: () =>
      api<{ coa: { code: string; lot_code: string }; already_issued: boolean }>("/api/factory/qms/ops", {
        method: "POST",
        json: {
          op: "issue_coa_from_test",
          test_id: id,
          template_key: selectedTplKey || undefined,
          custom_fields: customFields,
          credential: { method: sigMethod, secret: sigSecret },
        },
      }),
    onSuccess: (res) => {
      setSigSecret("");
      setReleaseNotice(
        res.already_issued
          ? `📜 COA ${res.coa.code} đã được cấp và đồng bộ ánh xạ sang Phòng Sản xuất Kit & Kinh doanh cho lô ${res.coa.lot_code}.`
          : `✅ Đã cấp phát chính thức Giấy Chứng Nhận Phân Tích COA ${res.coa.code} tại Phòng QA/QC và tự động ánh xạ sang Phòng Sản xuất Kit & Kinh doanh!`
      );
      refresh();
    },
  });

  const releaseLotMut = useMutation({
    mutationFn: () =>
      api<{ lot_code: string; putaway_executed: boolean; retention_code: string | null; coa_code?: string | null }>("/api/factory/qms/ops", {
        method: "POST",
        json: {
          op: "release_lot_from_test",
          test_id: id,
          auto_putaway: true,
          retain_sample_qty: Number(retainQty || 0),
          template_key: selectedTplKey || undefined,
          custom_fields: customFields,
          credential: { method: sigMethod, secret: sigSecret },
        },
      }),
    onSuccess: (res) => {
      setSigSecret("");
      setReleaseNotice(
        `✅ Đã giải phóng lô ${res.lot_code} (RELEASED)${
          res.coa_code ? `, cấp phát & ánh xạ COA ${res.coa_code} sang Phòng Sản xuất Kit` : ""
        }${res.putaway_executed ? ", tự động chuyển hàng từ khu Biệt trữ sang kệ Chính thức" : ""}${
          res.retention_code ? ` và ghi nhận mẫu lưu ${res.retention_code}` : ""
        }!`
      );
      refresh();
    },
  });

  const retest = useMutation({
    mutationFn: (reason: string) => api(`/api/factory/qms/tests/${id}/retest`, { method: "POST", idempotent: true, json: { reason } }),
    onSuccess: refresh,
  });

  const t = test.data;
  const editable = t?.status === "IN_PROGRESS" && t.analyst_id === me.data?.profile.user_id;
  const result = (pid: string) => t?.results.find((r) => r.parameter_id === pid);
  const linkedUsages = standardUsages.filter((u) => u.test_id === id);
  const activeStandards = standards.filter((s) => s.status === "ACTIVE");
  const linkedCoa = t
    ? issuedCoas.find((c) => c.qc_test_id === t.id || (t.coa_code && c.code === t.coa_code)) ??
      reportQuery.data?.linked_coa ??
      null
    : null;

  return (
    <Card title={t ? `Phiếu ${t.code} — ${t.spec_code} rev ${t.spec_version} (${t.test_kind})` : "Phiếu QC"} actions={<Button variant="ghost" onClick={onClose}>Đóng</Button>}>
      <ErrorNote error={test.error ?? save.error ?? recordStdMut.error ?? issueCoaMut.error ?? releaseLotMut.error ?? retest.error} />
      {t && (
        <div className="flex flex-col gap-3">
          <p className="text-xs text-slate-600 dark:text-slate-300">
            {t.lot_code ? `Lô ${t.lot_code} — ${t.item_code} ${t.item_name}` : t.subject?.label ?? t.spec_name} · {QC_STATUS_LABEL[t.status]} · Kiểm nghiệm: {t.analyst_name ?? "—"} · Duyệt: {t.reviewer_name ?? "—"}
            {t.retest_reason && <> · Ghi chú / Kiểm lại: <b>{t.retest_reason}</b></>}
          </p>
          {t.subject?.reference && <OligoReference r={t.subject.reference} />}

          {/* Reference Standard & Control Panel Suitability Check Section */}
          <div className="p-3 rounded-xl border border-indigo-200 dark:border-indigo-900/60 bg-indigo-50/40 dark:bg-indigo-950/20 flex flex-col gap-2 text-xs">
            <div className="font-bold text-indigo-900 dark:text-indigo-200">
              🧬 1. Đối chiếu Bộ Mẫu Chuẩn / Chủng Chuẩn Kiểm Nghiệm (System Suitability & Reference Standards)
            </div>
            {linkedUsages.length > 0 && (
              <Table head={["Mã mẫu chuẩn", "Tên mẫu chuẩn", "Chỉ số chuẩn", "Khoảng hợp lệ", "Giá trị đo trong mẻ", "Đánh giá mẻ chạy", "Người chạy"]}>
                {linkedUsages.map((u) => (
                  <tr key={u.id}>
                    <td className="py-1.5 pr-2 font-mono font-semibold text-indigo-700 dark:text-indigo-300">{u.standard_code}</td>
                    <td className="py-1.5 pr-2 font-semibold">{u.standard_name}</td>
                    <td className="py-1.5 pr-2">{u.target_metric}</td>
                    <td className="py-1.5 pr-2 font-mono">
                      [{u.lower_limit ?? "—"} ÷ {u.upper_limit ?? "—"}] {u.unit || ""}
                    </td>
                    <td className="py-1.5 pr-2 font-mono font-bold">
                      {u.measured_value != null ? `${Number(u.measured_value)} ${u.unit || ""}` : u.measured_text || "Đạt"}
                    </td>
                    <td className="py-1.5 pr-2">
                      <StatusBadge
                        status={u.passed ? "RELEASED" : "REJECTED"}
                        label={u.passed ? "Mẫu chuẩn HỢP LỆ" : "LỆCH CHUẨN (INVALID RUN)"}
                      />
                    </td>
                    <td className="py-1.5 pr-2">{u.user_name || "—"}</td>
                  </tr>
                ))}
              </Table>
            )}

            {t.status !== "REVIEWED" && t.status !== "CANCELLED" && (
              <form
                className="grid gap-2 sm:grid-cols-5 items-end"
                onSubmit={(e) => {
                  e.preventDefault();
                  recordStdMut.mutate();
                }}
              >
                <div className="sm:col-span-2">
                  <Field label="Chọn Lô Bộ Mẫu Chuẩn / Panel đối chiếu trong lần chạy này *">
                    <select className={inputClass} value={stdId} onChange={(e) => setStdId(e.target.value)} required>
                      <option value="">-- Chọn Bộ mẫu chuẩn đang hiệu lực --</option>
                      {activeStandards.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.code} ({s.lot_no}) — {s.name} [{s.lower_limit ?? ""}..{s.upper_limit ?? ""} {s.unit || ""}] · Còn {s.aliquots_remaining} ống
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
                <Field label="Giá trị mẫu chuẩn đo được">
                  <input
                    type="number"
                    step="any"
                    className={inputClass}
                    value={stdMeasuredVal}
                    onChange={(e) => setStdMeasuredVal(e.target.value)}
                    placeholder="VD: Ct = 25.8"
                  />
                </Field>
                <Field label="Ghi chú mẻ chạy chuẩn">
                  <input className={inputClass} value={stdNotes} onChange={(e) => setStdNotes(e.target.value)} placeholder="VD: Đường chuẩn R² = 0.998" />
                </Field>
                <Button type="submit" disabled={recordStdMut.isPending}>+ Ghi nhận Mẫu chuẩn</Button>
              </form>
            )}
          </div>

          <div className="font-bold text-xs text-slate-700 dark:text-slate-200">
            📋 2. Kết quả Kiểm nghiệm các Chỉ tiêu theo Tiêu chuẩn ({t.spec_code})
          </div>
          <Table head={["#", "Chỉ tiêu", "Phương pháp", "Yêu cầu", "Kết quả", "Đánh giá"]}>
            {t.parameters.map((p) => {
              const r = result(p.id);
              return (
                <tr key={p.id}>
                  <td className="py-2 pr-3">{p.seq}</td>
                  <td className="py-2 pr-3">{p.name}{p.is_critical && <span className="text-rose-600"> *</span>}</td>
                  <td className="py-2 pr-3">{p.method ?? "—"}</td>
                  <td className="py-2 pr-3 whitespace-nowrap">{limits(p)} {p.unit ?? ""}</td>
                  <td className="py-2 pr-3 min-w-36">
                    {editable && fromSubject(p) ? (
                      <span className="text-[11px] text-slate-500">Tự lấy {DERIVED_HINT[p.derived_metric!]} từ hậu tổng hợp khi lưu</span>
                    ) : editable ? (
                      p.value_type === "PASS_FAIL" ? (
                        <select className={inputClass} value={values[p.id] ?? ""} onChange={(e) => setValues({ ...values, [p.id]: e.target.value })}>
                          <option value="">—</option>
                          <option value="PASS">Đạt</option>
                          <option value="FAIL">Không đạt</option>
                        </select>
                      ) : (
                        <input
                          className={inputClass}
                          inputMode={p.value_type === "NUMERIC" ? "decimal" : "text"}
                          placeholder={p.derived_metric === "MW_DELTA_DA" ? "MW đo được (Da)" : undefined}
                          value={values[p.id] ?? ""}
                          onChange={(e) => setValues({ ...values, [p.id]: e.target.value })}
                        />
                      )
                    ) : r ? (
                      r.value_numeric != null
                        ? `${Number(r.value_numeric)} ${p.unit ?? ""}${r.observed_numeric != null ? ` (đo ${Number(r.observed_numeric)})` : ""}`
                        : r.value_text === "PASS"
                          ? "Đạt"
                          : r.value_text === "FAIL"
                            ? "Không đạt"
                            : r.value_text
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="py-2 pr-3">{r?.passed == null ? "—" : <StatusBadge status={r.passed ? "RELEASED" : "REJECTED"} label={r.passed ? "Đạt" : "Không đạt"} />}</td>
                </tr>
              );
            })}
          </Table>

          {editable && (
            <div className="flex gap-2 items-center">
              <Button onClick={() => save.mutate()} disabled={save.isPending}>{save.isPending ? "Đang lưu…" : "Lưu kết quả"}</Button>
              <span className="text-[11px] text-slate-400">Máy chủ tự đánh giá Đạt/Không đạt theo tiêu chuẩn.</span>
            </div>
          )}

          {t.overall_result && (
            <p className="text-sm font-bold">
              Kết luận: <StatusBadge status={t.overall_result === "PASS" ? "RELEASED" : "REJECTED"} label={t.overall_result === "PASS" ? "ĐẠT" : "KHÔNG ĐẠT"} />
            </p>
          )}

          <ActionBar endpoint={`/api/factory/qms/tests/${t.id}/actions`} version={t.version} actions={t.actions} labels={ACTION_LABEL} onDone={refresh} />

          {releaseNotice && (
            <div className="p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 text-xs font-semibold">
              {releaseNotice}
            </div>
          )}

          {t.status === "REVIEWED" && (
            <div className="space-y-3 pt-2 border-t border-slate-200 dark:border-slate-800">
              <div className="flex flex-wrap items-end gap-2">
                <Button
                  variant={previewMode === "QC_REPORT" ? "primary" : "ghost"}
                  onClick={() => setPreviewMode((m) => (m === "QC_REPORT" ? null : "QC_REPORT"))}
                >
                  👁️ {previewMode === "QC_REPORT" ? "Ẩn" : "Xem"} Phiếu Trả KQ QC (BM-QC-TR-01)
                </Button>
                <Button variant="ghost" onClick={() => printTestCoa(t.id, formsConfig).catch((e) => window.alert(e.message))}>
                  🖨️ In Phiếu Trả KQ QC (A4)
                </Button>
                {linkedCoa && (
                  <>
                    <Button
                      variant={previewMode === "COA" ? "primary" : "ghost"}
                      onClick={() => setPreviewMode((m) => (m === "COA" ? null : "COA"))}
                    >
                      👁️ {previewMode === "COA" ? "Ẩn" : "Xem"} COA (BM-QC-COA-01)
                    </Button>
                    <Button variant="ghost" onClick={() => printKitCoaCertificate(linkedCoa, formsConfig, "BI")}>
                      📄 Xuất COA (Mẫu chuẩn)
                    </Button>
                    <Button variant="ghost" onClick={() => printKitCoaCertificate(linkedCoa, formsConfig, "VI")}>
                      🇻🇳 COA (Tiếng Việt)
                    </Button>
                    <Button variant="ghost" onClick={() => printKitCoaCertificate(linkedCoa, formsConfig, "EN")}>
                      🇬🇧 COA (English)
                    </Button>
                  </>
                )}
                {["LOT", "PRODUCTION_ORDER"].includes(t.entity_type) && t.overall_result === "PASS" && (
                  <>
                    {(() => {
                      const activeTpl = resolveCoaTemplate(formsConfig, selectedTplKey || linkedCoa?.template_key || "STANDARD");
                      return (
                        <div className="w-full p-3 rounded-xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50/50 dark:bg-indigo-950/30 space-y-2.5 text-xs">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="font-extrabold text-indigo-900 dark:text-indigo-200 uppercase">
                              📑 Chọn Mẫu COA áp dụng cho Lô / Sản phẩm này (tự gợi ý theo nhóm SP — QC có thể đổi &amp; bấm Cấp/Áp dụng lại)
                            </span>
                            <span className="text-[11px] text-slate-500">{activeTpl.note}</span>
                          </div>
                          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
                            <div className="sm:col-span-2">
                              <Field label="Mẫu COA áp dụng *">
                                <select
                                  className={inputClass}
                                  value={activeTpl.key}
                                  onChange={(e) => {
                                    const nextTpl = resolveCoaTemplate(formsConfig, e.target.value);
                                    setSelectedTplKey(nextTpl.key);
                                    setCustomFields((prev) => ({
                                      ...prev,
                                      contract_no: nextTpl.default_contract_no || prev.contract_no || "",
                                      oem_partner: nextTpl.oem_partner_name || prev.oem_partner || "",
                                    }));
                                  }}
                                >
                                  {(formsConfig.coa_templates?.length ? formsConfig.coa_templates : DEFAULT_COA_TEMPLATES)
                                    .filter((x) => x.active !== false)
                                    .map((x) => (
                                      <option key={x.key} value={x.key}>
                                        {x.name} ({x.form_code})
                                      </option>
                                    ))}
                                </select>
                              </Field>
                            </div>
                            {activeTpl.category === "OEM" && (
                              <>
                                <Field label="Số hợp đồng gia công (OEM) *">
                                  <input
                                    className={inputClass}
                                    placeholder="VD: 01/2026/HĐGC-ABT"
                                    value={customFields.contract_no ?? activeTpl.default_contract_no ?? ""}
                                    onChange={(e) => setCustomFields({ ...customFields, contract_no: e.target.value })}
                                  />
                                </Field>
                                <Field label="Đơn vị đặt gia công">
                                  <input
                                    className={inputClass}
                                    value={customFields.oem_partner ?? activeTpl.oem_partner_name ?? ""}
                                    onChange={(e) => setCustomFields({ ...customFields, oem_partner: e.target.value })}
                                  />
                                </Field>
                              </>
                            )}
                            {activeTpl.show_volume_conc_seq && (
                              <>
                                <Field label="Thể tích (Volume)">
                                  <input
                                    className={inputClass}
                                    placeholder="VD: 1.0 mL / ống"
                                    value={customFields.volume ?? ""}
                                    onChange={(e) => setCustomFields({ ...customFields, volume: e.target.value })}
                                  />
                                </Field>
                                <Field label="Nồng độ (Concentration)">
                                  <input
                                    className={inputClass}
                                    placeholder="VD: 10 µM hoặc 1x"
                                    value={customFields.concentration ?? ""}
                                    onChange={(e) => setCustomFields({ ...customFields, concentration: e.target.value })}
                                  />
                                </Field>
                              </>
                            )}
                            {activeTpl.show_ct_standard && (
                              <>
                                <Field label="Tiêu chuẩn Ct (Chứng dương)">
                                  <input
                                    className={inputClass}
                                    placeholder="VD: Ct 25.0 ± 2.0"
                                    value={customFields.ct_standard ?? ""}
                                    onChange={(e) => setCustomFields({ ...customFields, ct_standard: e.target.value })}
                                  />
                                </Field>
                                <Field label="Số TCCS của bộ Kit">
                                  <input
                                    className={inputClass}
                                    placeholder="Tự lấy theo Kit hoặc gõ tại đây"
                                    value={customFields.kit_tccs_code ?? ""}
                                    onChange={(e) => setCustomFields({ ...customFields, kit_tccs_code: e.target.value })}
                                  />
                                </Field>
                              </>
                            )}
                            {activeTpl.show_volume_conc_seq && !activeTpl.show_ct_standard && (
                              <div className="sm:col-span-2">
                                <Field label="Trình tự 5'→3' (nếu yêu cầu)">
                                  <input
                                    className={`${inputClass} font-mono`}
                                    placeholder="Để trống nếu không yêu cầu in trình tự"
                                    value={customFields.sequence ?? ""}
                                    onChange={(e) => setCustomFields({ ...customFields, sequence: e.target.value })}
                                  />
                                </Field>
                              </div>
                            )}
                            {activeTpl.show_raw_material_lot && (
                              <Field label="Số lô nguyên liệu / NSX (1 lô NL - 1 COA)">
                                <input
                                  className={inputClass}
                                  placeholder={t.lot_code || "Tự lấy theo số lô"}
                                  value={customFields.supplier_lot_no ?? ""}
                                  onChange={(e) => setCustomFields({ ...customFields, supplier_lot_no: e.target.value })}
                                />
                              </Field>
                            )}
                          </div>
                        </div>
                      );
                    })()}
                    <div className="flex flex-wrap items-end gap-2 p-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-900/40">
                      <Field label="Ký số (21 CFR Part 11)">
                        <select
                          className={`${inputClass} w-28`}
                          value={sigMethod}
                          onChange={(e) => setSigMethod(e.target.value as "PIN" | "PASSWORD")}
                        >
                          <option value="PIN">Mã PIN</option>
                          <option value="PASSWORD">Mật khẩu</option>
                        </select>
                      </Field>
                      <Field label="PIN / Mật khẩu *">
                        <input
                          type="password"
                          className={`${inputClass} w-36`}
                          placeholder="Nhập để ký COA/Lô"
                          value={sigSecret}
                          onChange={(e) => setSigSecret(e.target.value)}
                        />
                      </Field>
                    </div>
                    {t.coa_code ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="px-3 py-2 rounded-xl border border-sky-200 dark:border-sky-800 bg-sky-50/70 dark:bg-sky-950/30 text-xs font-semibold text-sky-900 dark:text-sky-200 flex items-center gap-2">
                          <span>
                            📜 Đã cấp COA: <b className="font-mono">{t.coa_code}</b>
                            {linkedCoa?.template_key ? ` · Mẫu: ${linkedCoa.template_key}` : ""}
                          </span>
                        </div>
                        <Button variant="secondary" onClick={() => issueCoaMut.mutate()} disabled={issueCoaMut.isPending}>
                          🔄 Áp dụng Mẫu COA / Thông tin đặc thù đã chọn
                        </Button>
                      </div>
                    ) : (
                      <Button onClick={() => issueCoaMut.mutate()} disabled={issueCoaMut.isPending}>
                        📜 Cấp COA Chính Thức &amp; Ánh Xạ Sang Sản Xuất / Kinh Doanh
                      </Button>
                    )}
                    <div className="flex flex-wrap items-end gap-2 p-2 rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50/40 dark:bg-emerald-950/20">
                      <Field label="Số lượng trích Mẫu lưu QC">
                        <input
                          type="number"
                          min="0"
                          step="any"
                          className={`${inputClass} w-28`}
                          value={retainQty}
                          onChange={(e) => setRetainQty(e.target.value)}
                        />
                      </Field>
                      <Button onClick={() => releaseLotMut.mutate()} disabled={releaseLotMut.isPending}>
                        ✅ Giải phóng Lô &amp; Cấp COA ngay tại QC
                      </Button>
                    </div>
                  </>
                )}
                {me.data?.permissions.includes("qms.qc.lead") && (
                  <Button variant="ghost" onClick={() => { const r = window.prompt("Lý do kiểm lại:"); if (r) retest.mutate(r); }}>
                    🔄 Tạo phiếu kiểm lại (Retest)
                  </Button>
                )}
              </div>

              {previewMode === "QC_REPORT" && reportQuery.data && (
                <div className="pt-2">
                  <QcDocumentPreview
                    kind="QC_REPORT"
                    data={reportQuery.data}
                    formsConfig={formsConfig}
                    onPrintReport={(sigOverrides) =>
                      printTestCoa(t.id, formsConfig, sigOverrides).catch((e) => window.alert(e.message))
                    }
                  />
                </div>
              )}

              {previewMode === "COA" && linkedCoa && (
                <div className="pt-2">
                  <QcDocumentPreview kind="COA" data={linkedCoa} formsConfig={formsConfig} />
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

const QC_CATEGORY_LABEL: Record<string, { label: string; badge: string }> = {
  IQC: { label: "IQC — Nguyên vật liệu & Linh kiện đầu vào", badge: "QUARANTINE" },
  IPQC: { label: "IPQC — Bán thành phẩm Pha chế / Cụm lắp ráp", badge: "PENDING_QC" },
  FQC: { label: "FQC — Thành phẩm Kit / Oligo / Thiết bị", badge: "RELEASED" },
};

export function QcTestsView() {
  const qc = useQueryClient();
  const me = useFactoryMe();
  const [status, setStatus] = useState("");
  const [queueFilter, setQueueFilter] = useState<"ALL" | "IQC" | "IPQC" | "FQC">("ALL");
  const [openingReleaseNotice, setOpeningReleaseNotice] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedSource, setSelectedSource] = useState<"queue" | "list" | "coa">("list");
  const [selectedAnchorId, setSelectedAnchorId] = useState<string | null>(null);
  const [selectedCoa, setSelectedCoa] = useState<any | null>(null);

  const openTestInline = (testId: string, source: "queue" | "list" | "coa", anchorId?: string) => {
    const targetAnchor = anchorId ?? testId;
    if (selected === testId && selectedSource === source && selectedAnchorId === targetAnchor) {
      setSelected(null);
      setSelectedAnchorId(null);
      return;
    }
    setSelected(testId);
    setSelectedSource(source);
    setSelectedAnchorId(targetAnchor);
  };
  const [showProactiveForm, setShowProactiveForm] = useState(false);
  const [proactiveLotId, setProactiveLotId] = useState("");
  const [proactiveKind, setProactiveKind] = useState<"IQC" | "IPQC" | "FQC" | "RELEASE" | "STABILITY">("IQC");
  const [proactiveSpecId, setProactiveSpecId] = useState("");

  // Dual Template Config (BM-QC-TR-01 & BM-QC-COA-01) + Staff Signatures + COA Editor States
  const [showCoaTemplateConfig, setShowCoaTemplateConfig] = useState(false);
  const [formsConfig, setFormsConfig] = useState<QcFormsConfig>(() => structuredClone(DEFAULT_QC_FORMS_CONFIG));
  const [sigUploadNotice, setSigUploadNotice] = useState<string | null>(null);
  const [editingCoa, setEditingCoa] = useState<any | null>(null);
  const [activeTplKey, setActiveTplKey] = useState<string>("STANDARD");
  const [coaNotice, setCoaNotice] = useState<string | null>(null);
  const [coaSigMethod, setCoaSigMethod] = useState<"PIN" | "PASSWORD">("PIN");
  const [coaSigSecret, setCoaSigSecret] = useState("");

  const list = useQuery({
    queryKey: ["factory", "qc-tests", status],
    queryFn: () => api<QcRow[]>(`/api/factory/qms/tests${status ? `?status=${status}` : ""}`),
  });
  const qaOps = useQuery({
    queryKey: ["factory", "qa-ops"],
    queryFn: () => api<any>("/api/factory/qms/ops"),
  });
  const specsList = useQuery({
    queryKey: ["factory", "specs"],
    queryFn: () => api<any[]>("/api/factory/qms/specs"),
  });

  useEffect(() => {
    if (qaOps.data?.coa_template || qaOps.data?.qc_forms_config || qaOps.data?.qa_personnel) {
      setFormsConfig(
        normalizeQcFormsConfig(
          qaOps.data?.coa_template,
          qaOps.data?.qc_forms_config,
          qaOps.data?.qa_personnel
        )
      );
    }
  }, [qaOps.data?.coa_template, qaOps.data?.qc_forms_config, qaOps.data?.qa_personnel]);

  const saveTplMut = useMutation({
    mutationFn: (cfg: QcFormsConfig) =>
      api<any>("/api/factory/qms/ops", {
        method: "POST",
        json: {
          op: "save_coa_template",
          company_name: `${cfg.company_name_vi} — ${cfg.company_name_en}`,
          document_title: `${cfg.coa.title_bi_main} / ${cfg.coa.title_bi_sub}`,
          iso_subtitle: cfg.iso_badge_vi,
          address_line: cfg.address_vi,
          footer_statement: cfg.footer_note,
          approver_title: `${cfg.manager_label_vi} / ${cfg.manager_label_en}`,
          results_display_mode: cfg.coa.results_mode,
          default_coa_parameters: cfg.coa.custom_summary_rows,
          apply_to_existing_coas: true,
          qc_forms_config: cfg,
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["factory", "qa-ops"] });
      qc.invalidateQueries({ queryKey: ["factory", "qc-test-coa"] });
      setShowCoaTemplateConfig(false);
      setCoaNotice(
        "✅ Đã lưu cài đặt Mẫu Phiếu trả kết quả QC (BM-QC-TR-01), Mẫu COA (BM-QC-COA-01) và Chữ ký Nhân viên QC (giữ nguyên toàn vẹn dữ liệu COA đã phát hành)!"
      );
    },
  });

  const updateCoaMut = useMutation({
    mutationFn: (payload: any) =>
      api<any>("/api/factory/qms/ops", {
        method: "POST",
        json: {
          op: "update_coa_certificate",
          ...payload,
          credential: { method: coaSigMethod, secret: coaSigSecret },
        },
      }),
    onSuccess: (updated) => {
      qc.invalidateQueries({ queryKey: ["factory", "qa-ops"] });
      setCoaSigSecret("");
      setSelectedCoa(updated);
      setEditingCoa(null);
      setCoaNotice(`✅ Đã ban hành phụ lục COA ${updated.code} (Phiên bản v${updated.revision_no ?? 1}) theo quy tắc chỉ ghi nối (append-only)!`);
    },
  });

  const startEditingCoa = (c: any) => {
    const rawResults = Array.isArray(c.qc_results_snapshot) ? c.qc_results_snapshot : [];
    setEditingCoa({
      id: c.id,
      code: c.code ?? "",
      product_code: c.product_code ?? "",
      product_name: c.product_name ?? "",
      lot_code: c.lot_code ?? "",
      mfg_date: (c.mfg_date ?? "").slice(0, 10),
      expiry_date: (c.expiry_date ?? "").slice(0, 10),
      tests_per_kit: Number(c.tests_per_kit ?? 0),
      good_qty: Number(c.good_qty ?? 1),
      uom: c.uom ?? "mL",
      spec_code: c.spec_code ?? "",
      qc_summary: c.qc_summary ?? "",
      analyst_name: c.analyst_name ?? "",
      issued_by_name: c.issued_by_name ?? "",
      custom_notes: c.custom_notes ?? "",
      template_key: c.template_key ?? "STANDARD",
      custom_fields: c.custom_fields && typeof c.custom_fields === "object" ? { ...c.custom_fields } : {},
      reason: "",
      qc_results_snapshot: rawResults.map((st: any, idx: number) => ({
        seq: st.seq ?? idx + 1,
        parameter_name: st.parameter_name ?? `${st.step_code ?? ""} ${st.step_name ?? ""}`.trim(),
        method: st.method ?? "SOP-QC",
        spec_limit: st.spec_limit ?? "Đạt chuẩn / Conforms",
        observed_value:
          st.observed_value ??
          (st.param_values && Object.keys(st.param_values).length > 0
            ? Object.entries(st.param_values)
                .map(([k, v]) => `${k}: ${v}`)
                .join(" · ")
            : "—"),
        passed: st.passed === true,
      })),
    });
    setSelectedCoa(c);
  };

  const receiveLotMut = useMutation({
    mutationFn: (payload: { lot_id: string; test_kind?: string; spec_id?: string | null; _source?: "queue" | "list" }) =>
      api<{ test_id: string; test_code: string }>("/api/factory/qms/ops", {
        method: "POST",
        json: {
          op: "receive_lot_qc",
          lot_id: payload.lot_id,
          test_kind: payload.test_kind,
          spec_id: payload.spec_id,
        },
      }),
    onSuccess: (res, vars) => {
      qc.invalidateQueries({ queryKey: ["factory", "qc-tests"] });
      qc.invalidateQueries({ queryKey: ["factory", "qa-ops"] });
      setShowProactiveForm(false);
      if (res?.test_id) {
        setSelected(res.test_id);
        setSelectedSource(vars._source ?? "queue");
        setSelectedAnchorId(vars.lot_id);
      }
    },
  });

  const releaseOpeningMut = useMutation({
    mutationFn: (reason: string) =>
      api<{
        released_lots: number;
        cancelled_tests: number;
        moved_balances: number;
        transfer_docs: number;
      }>("/api/factory/qms/ops", {
        method: "POST",
        json: { op: "release_opening_lots", reason },
      }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["factory", "qa-ops"] });
      qc.invalidateQueries({ queryKey: ["factory", "qc-tests"] });
      qc.invalidateQueries({ queryKey: ["factory", "lot"] });
      qc.invalidateQueries({ queryKey: ["factory", "stock"] });
      setOpeningReleaseNotice(
        `✅ Đã giải phóng ${res.released_lots} lô tồn đầu kỳ sang Đã duyệt (RELEASED)` +
          (res.cancelled_tests > 0 ? `, hủy ${res.cancelled_tests} phiếu QC chưa duyệt` : "") +
          ` và chuyển ${res.moved_balances} dòng tồn kho từ khu Biệt trữ (BT) sang Kệ chính (${res.transfer_docs} phiếu PUTAWAY)!`
      );
    },
  });

  const queue: any[] = qaOps.data?.reception_queue ?? [];
  const allLots: any[] = qaOps.data?.all_lots ?? queue;
  const filteredQueue = queueFilter === "ALL" ? queue : queue.filter((q) => q.qc_category === queueFilter);
  const openingQueueCount = queue.filter((q) => q.origin === "OPENING").length;
  const canReleaseOpening = Boolean(me.data?.is_root || me.data?.permissions?.includes("inv.lot.release"));

  const renderInlineDetailPanel = (testId: string) => (
    <QcDetailPanel
      key={testId}
      id={testId}
      standards={qaOps.data?.standards ?? []}
      standardUsages={qaOps.data?.standard_usages ?? []}
      formsConfig={formsConfig}
      issuedCoas={qaOps.data?.issued_coas ?? []}
      onClose={() => {
        setSelected(null);
        setSelectedAnchorId(null);
      }}
    />
  );

  const isQueueRowSelected = (q: any) =>
    Boolean(
      selected &&
        selectedSource === "queue" &&
        (selectedAnchorId === q.lot_id || q.latest_test_id === selected)
    );

  const isRenderedInlineInQueue = Boolean(selected && selectedSource === "queue" && filteredQueue.some(isQueueRowSelected));
  const isRenderedInlineInList = Boolean(
    selected && selectedSource === "list" && (list.data ?? []).some((r) => r.id === selected)
  );
  const isRenderedInlineInCoa = Boolean(
    selected &&
      selectedSource === "coa" &&
      (qaOps.data?.issued_coas ?? []).some(
        (c: any) => c.qc_test_id === selected && (!selectedAnchorId || c.id === selectedAnchorId)
      )
  );

  return (
    <div className="flex flex-col gap-3">
      {/* Unified 1-Stop QC Reception Queue */}
      <Card
        title="📥 Trung tâm Tiếp nhận Yêu cầu QC Một Cửa (Nguyên liệu IQC · Bán thành phẩm IPQC · Thành phẩm FQC)"
        actions={
          <div className="flex flex-wrap gap-1.5">
            {(["ALL", "IQC", "IPQC", "FQC"] as const).map((cat) => {
              const cnt = cat === "ALL" ? queue.length : queue.filter((q) => q.qc_category === cat).length;
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setQueueFilter(cat)}
                  className={`px-2.5 py-1 rounded-xl text-xs font-bold border cursor-pointer transition-colors ${
                    queueFilter === cat
                      ? "bg-sky-700 text-white border-sky-700"
                      : "bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700"
                  }`}
                >
                  {cat === "ALL" ? "Tất cả chờ QC" : cat} ({cnt})
                </button>
              );
            })}
            {canReleaseOpening && openingQueueCount > 0 && (
              <Button
                variant="secondary"
                className="!border-amber-300 dark:!border-amber-800 !bg-amber-50 dark:!bg-amber-950/50 !text-amber-800 dark:!text-amber-200 hover:!bg-amber-100 dark:hover:!bg-amber-900/60"
                disabled={releaseOpeningMut.isPending}
                onClick={() => {
                  const reason = window.prompt(
                    "Xác nhận giải phóng toàn bộ lô tồn kho đầu kỳ (OPENING) không qua IQC và tự động chuyển từ khu Biệt trữ (BT) sang Kệ chính.\nNhập lý do lưu vết Audit:",
                    "Nguyên liệu nhập lần đầu lên hệ thống đã được đánh giá chất lượng trước đó"
                  );
                  if (reason === null) return;
                  setOpeningReleaseNotice(null);
                  releaseOpeningMut.mutate(
                    reason.trim() || "Nguyên liệu nhập lần đầu lên hệ thống đã được đánh giá chất lượng trước đó"
                  );
                }}
              >
                {releaseOpeningMut.isPending
                  ? "Đang giải phóng tồn đầu kỳ..."
                  : `⚡ Giải phóng tồn đầu kỳ (${openingQueueCount} lô — Bỏ qua IQC)`}
              </Button>
            )}
            <Button onClick={() => setShowProactiveForm(!showProactiveForm)}>+ Tạo Phiếu QC Chủ động</Button>
          </div>
        }
      >
        <ErrorNote error={qaOps.error ?? receiveLotMut.error ?? releaseOpeningMut.error} />
        {openingReleaseNotice && (
          <div className="mb-3 px-3 py-2 rounded-xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/30 text-xs font-semibold text-emerald-800 dark:text-emerald-200">
            {openingReleaseNotice}
          </div>
        )}

        {showProactiveForm && (
          <form
            className="grid gap-2 sm:grid-cols-5 items-end p-3 mb-3 rounded-xl border border-sky-200 dark:border-sky-900 bg-sky-50/40 dark:bg-sky-950/20"
            onSubmit={(e) => {
              e.preventDefault();
              receiveLotMut.mutate({
                lot_id: proactiveLotId,
                test_kind: proactiveKind,
                spec_id: proactiveSpecId || null,
                _source: "queue",
              });
            }}
          >
            <div className="sm:col-span-2">
              <Field label="Chọn Lô Nguyên vật liệu / Bán thành phẩm / Thành phẩm cần kiểm nghiệm *">
                <select className={inputClass} value={proactiveLotId} onChange={(e) => setProactiveLotId(e.target.value)} required>
                  <option value="">-- Chọn lô hàng trong nhà máy --</option>
                  {allLots.map((q) => (
                    <option key={q.lot_id} value={q.lot_id}>
                      Lô {q.lot_code} [{q.lot_status}] — {q.item_code} {q.item_name} ({q.item_type})
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <Field label="Loại hình Kiểm nghiệm QC *">
              <select className={inputClass} value={proactiveKind} onChange={(e) => setProactiveKind(e.target.value as any)}>
                <option value="IQC">IQC — Kiểm tra Nguyên liệu đầu vào</option>
                <option value="IPQC">IPQC — Kiểm tra Bán thành phẩm</option>
                <option value="FQC">FQC — Kiểm tra Thành phẩm</option>
                <option value="RELEASE">RELEASE — Duyệt xuất xưởng</option>
                <option value="STABILITY">STABILITY — Kiểm tra Độ ổn định</option>
              </select>
            </Field>
            <Field label="Tiêu chuẩn QC áp dụng (Spec)">
              <select className={inputClass} value={proactiveSpecId} onChange={(e) => setProactiveSpecId(e.target.value)}>
                <option value="">-- Tự động lấy theo sản phẩm đã gán --</option>
                {(specsList.data ?? []).map((sp: any) => (
                  <option key={sp.id} value={sp.id}>
                    {sp.code} v{sp.spec_version} — {sp.name}
                  </option>
                ))}
              </select>
            </Field>
            <Button type="submit" disabled={receiveLotMut.isPending}>🧪 Tiếp nhận & Mở Phiếu QC</Button>
          </form>
        )}

        {selected && selectedSource === "queue" && !isRenderedInlineInQueue && (
          <div className="mb-3">{renderInlineDetailPanel(selected)}</div>
        )}

        {filteredQueue.length === 0 ? (
          <Empty>Hiện không có lô hàng nào đang chờ lấy mẫu hoặc chờ QC trong hàng đợi này.</Empty>
        ) : (
          <Table head={["Phân loại QC", "Số Lô (Lot)", "Mã & Tên Vật tư / BTP / Thành phẩm", "Số lượng · Kho", "Hạn dùng", "Trạng thái Lô", "Phiếu QC hiện tại", "Thao tác tại QC"]}>
            {filteredQueue.map((q) => {
              const rowExpanded = isQueueRowSelected(q);
              return (
                <Fragment key={q.lot_id}>
                  <tr className={rowExpanded ? "bg-sky-50/70 dark:bg-sky-950/30" : ""}>
                    <td className="py-2 pr-3">
                      <StatusBadge status={QC_CATEGORY_LABEL[q.qc_category]?.badge ?? "QUARANTINE"} label={q.qc_category} />
                    </td>
                    <td className="py-2 pr-3 font-mono font-semibold text-sky-700 dark:text-sky-400">
                      {q.lot_code}
                      {q.mfr_lot_no && <div className="text-[11px] text-slate-400">NSX: {q.mfr_lot_no}</div>}
                    </td>
                    <td className="py-2 pr-3">
                      <div className="font-semibold">{q.item_code} — {q.item_name}</div>
                      <div className="text-[11px] text-slate-500">Nguồn: {q.origin} · Loại: {q.item_type}</div>
                    </td>
                    <td className="py-2 pr-3 font-mono">
                      {fmtQty(q.qty_on_hand)} {q.base_uom}
                      <div className="text-[11px] text-slate-400">{q.warehouse_locations || "—"}</div>
                    </td>
                    <td className="py-2 pr-3 font-mono whitespace-nowrap">{fmtDate(q.expiry_date)}</td>
                    <td className="py-2 pr-3">
                      <StatusBadge status={q.lot_status} label={q.lot_status === "QUARANTINE" ? "Biệt trữ chờ lấy mẫu" : "Đang kiểm QC"} />
                    </td>
                    <td className="py-2 pr-3">
                      {q.latest_test_code ? (
                        <button
                          type="button"
                          className="font-mono font-semibold text-sky-700 dark:text-sky-400 underline cursor-pointer"
                          onClick={() => openTestInline(q.latest_test_id, "queue", q.lot_id)}
                        >
                          {q.latest_test_code} ({QC_STATUS_LABEL[q.latest_test_status] ?? q.latest_test_status})
                        </button>
                      ) : (
                        <span className="text-slate-400 text-xs">Chưa lập phiếu</span>
                      )}
                    </td>
                    <td className="py-2 pr-3">
                      {q.latest_test_id ? (
                        <Button
                          variant={rowExpanded ? "secondary" : "ghost"}
                          onClick={() => openTestInline(q.latest_test_id, "queue", q.lot_id)}
                        >
                          {rowExpanded ? "Đóng phiếu QC ▲" : "📝 Cập nhật KQ QC ▼"}
                        </Button>
                      ) : (
                        <Button
                          onClick={() =>
                            receiveLotMut.mutate({ lot_id: q.lot_id, test_kind: q.qc_category, _source: "queue" })
                          }
                          disabled={receiveLotMut.isPending}
                        >
                          🧪 Tiếp nhận & Lập phiếu {q.qc_category}
                        </Button>
                      )}
                    </td>
                  </tr>
                  {rowExpanded && selected && (
                    <tr className="bg-sky-50/40 dark:bg-sky-950/20">
                      <td colSpan={8} className="p-3 border-b-2 border-sky-400 dark:border-sky-700">
                        {renderInlineDetailPanel(selected)}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </Table>
        )}
      </Card>

      <Card
        title="Danh sách Phiếu Kiểm nghiệm Chất lượng (IQC / IPQC / FQC / Stability)"
        actions={
          <select className={`${inputClass} w-52`} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Lọc trạng thái">
            <option value="">Đang mở (cần xử lý)</option>
            <option value="REVIEWED">Đã duyệt (PASS / FAIL)</option>
            <option value="CANCELLED">Đã hủy</option>
          </select>
        }
      >
        <ErrorNote error={list.error} />
        {selected && selectedSource === "list" && !isRenderedInlineInList && (
          <div className="mb-3">{renderInlineDetailPanel(selected)}</div>
        )}
        {list.data?.length === 0 && <Empty>Không có phiếu QC nào.</Empty>}
        {list.data && list.data.length > 0 && (
          <Table head={["Mã phiếu", "Đối tượng (Lô NVL / BTP / Thành phẩm)", "Loại QC", "Tiêu chuẩn áp dụng", "Trạng thái", "Kết luận", "COA (Do QC cấp)", "Thao tác"]}>
            {list.data.map((r) => {
              const rowExpanded = selected === r.id && selectedSource === "list";
              return (
                <Fragment key={r.id}>
                  <tr
                    className={`cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50 ${
                      rowExpanded ? "bg-sky-50/70 dark:bg-sky-950/30" : ""
                    }`}
                    onClick={() => openTestInline(r.id, "list", r.id)}
                  >
                    <td className="py-2 pr-3 font-mono font-semibold text-sky-700 dark:text-sky-400">{r.code}</td>
                    <td className="py-2 pr-3">
                      {r.lot_code
                        ? `Lô ${r.lot_code} · ${r.item_code} ${r.item_name}${r.order_code ? ` (${r.order_code})` : ""}`
                        : r.sequence_code
                          ? `Oligo ${r.sequence_code} · ${r.sequence_name}`
                          : "—"}
                    </td>
                    <td className="py-2 pr-3 font-mono font-semibold">{r.test_kind}</td>
                    <td className="py-2 pr-3 font-mono">{r.spec_code}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">{QC_STATUS_LABEL[r.status]}</td>
                    <td className="py-2 pr-3">
                      {r.overall_result ? (
                        <StatusBadge
                          status={r.overall_result === "PASS" ? "RELEASED" : "REJECTED"}
                          label={r.overall_result === "PASS" ? "Đạt" : "Không đạt"}
                        />
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="py-2 pr-3 font-mono text-xs">
                      {r.coa_code ? (
                        <span className="px-2 py-0.5 rounded-lg bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 font-bold">
                          📜 {r.coa_code}
                        </span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="py-2 pr-3 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                      <Button
                        variant={rowExpanded ? "secondary" : "ghost"}
                        onClick={() => openTestInline(r.id, "list", r.id)}
                      >
                        {rowExpanded ? "Đóng phiếu ▲" : "📝 Cập nhật KQ QC ▼"}
                      </Button>
                    </td>
                  </tr>
                  {rowExpanded && (
                    <tr className="bg-sky-50/40 dark:bg-sky-950/20">
                      <td colSpan={8} className="p-3 border-b-2 border-sky-400 dark:border-sky-700">
                        {renderInlineDetailPanel(r.id)}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </Table>
        )}
      </Card>

      {/* Official COA Issuance Registry at QA/QC */}
      <Card
        title={`📜 Sổ Cấp Phát Giấy Chứng Nhận Phân Tích (COA) — Do Phòng QA/QC Cấp & Ánh Xạ Sang Sản Xuất / Kinh Doanh (${(qaOps.data?.issued_coas ?? []).length})`}
        actions={
          <Button variant="ghost" onClick={() => setShowCoaTemplateConfig((v) => !v)}>
            ⚙️ {showCoaTemplateConfig ? "Đóng Cài đặt Biểu mẫu QC & COA" : "Cài đặt Mẫu Phiếu trả KQ QC, Mẫu COA & Chữ ký Nhân viên"}
          </Button>
        }
      >
        <ErrorNote error={saveTplMut.error ?? updateCoaMut.error} />
        {coaNotice && (
          <div className="mb-3 p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-xs font-semibold text-emerald-800 dark:text-emerald-200 flex items-center justify-between">
            <span>{coaNotice}</span>
            <button type="button" className="text-emerald-600 underline ml-2 cursor-pointer" onClick={() => setCoaNotice(null)}>
              Đóng
            </button>
          </div>
        )}

        {showCoaTemplateConfig && (
          <form
            className="mb-4 p-4 rounded-xl border border-sky-300 dark:border-sky-800 bg-sky-50/40 dark:bg-sky-950/20 space-y-5"
            onSubmit={(e) => {
              e.preventDefault();
              saveTplMut.mutate(formsConfig);
            }}
          >
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-sky-200 dark:border-sky-800 pb-3">
              <div>
                <div className="text-xs font-extrabold uppercase text-sky-800 dark:text-sky-300">
                  ⚙️ Cài đặt 2 Biểu mẫu Chuẩn Phòng QC (Phiếu trả KQ QC `BM-QC-TR-01` &amp; Phiếu COA `BM-QC-COA-01`) + Chữ ký Nhân viên
                </div>
                <div className="text-[11px] text-slate-500">
                  Thiết lập chuẩn 2 mẫu đang áp dụng tại Chi nhánh Long Hậu, hỗ trợ xuất COA Tiếng Việt / Tiếng Anh / Song ngữ kèm chữ ký tay từng nhân viên QC.
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    const synced = normalizeQcFormsConfig(null, null, qaOps.data?.qa_personnel);
                    setFormsConfig(synced);
                    setSigUploadNotice(
                      `Đã nạp lại chuẩn 2 Mẫu ABT Long Hậu & ${synced.staff_signatures.length} nhân sự QC/QA theo mã nhân sự (NV-ABT-xxx). Bấm 'Lưu Cấu hình' để áp dụng.`
                    );
                  }}
                >
                  ⚡ Khôi phục chuẩn 2 Mẫu ABT Long Hậu
                </Button>
                <Button type="submit" disabled={saveTplMut.isPending}>
                  💾 Lưu Cấu hình Mẫu &amp; Chữ ký
                </Button>
                <Button type="button" variant="ghost" onClick={() => setShowCoaTemplateConfig(false)}>
                  Hủy
                </Button>
              </div>
            </div>

            {/* PHẦN I: THÔNG TIN PHÁP NHÂN & HEADER DÙNG CHUNG */}
            <div className="space-y-2">
              <div className="text-xs font-extrabold uppercase text-blue-900 dark:text-sky-300">
                I. Thông tin Pháp nhân, Địa chỉ &amp; Tiêu chuẩn ISO (Dùng chung cho cả 2 biểu mẫu)
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Tên Công ty (Tiếng Việt) *">
                  <input
                    className={inputClass}
                    value={formsConfig.company_name_vi}
                    onChange={(e) => setFormsConfig({ ...formsConfig, company_name_vi: e.target.value })}
                    required
                  />
                </Field>
                <Field label="Tên Công ty (Tiếng Anh) *">
                  <input
                    className={inputClass}
                    value={formsConfig.company_name_en}
                    onChange={(e) => setFormsConfig({ ...formsConfig, company_name_en: e.target.value })}
                    required
                  />
                </Field>
                <Field label="Địa chỉ (Tiếng Việt)">
                  <input
                    className={inputClass}
                    value={formsConfig.address_vi}
                    onChange={(e) => setFormsConfig({ ...formsConfig, address_vi: e.target.value })}
                  />
                </Field>
                <Field label="Địa chỉ (Tiếng Anh)">
                  <input
                    className={inputClass}
                    value={formsConfig.address_en}
                    onChange={(e) => setFormsConfig({ ...formsConfig, address_en: e.target.value })}
                  />
                </Field>
                <Field label="Số điện thoại">
                  <input
                    className={inputClass}
                    value={formsConfig.phone}
                    onChange={(e) => setFormsConfig({ ...formsConfig, phone: e.target.value })}
                  />
                </Field>
                <Field label="Email liên hệ">
                  <input
                    className={inputClass}
                    value={formsConfig.email}
                    onChange={(e) => setFormsConfig({ ...formsConfig, email: e.target.value })}
                  />
                </Field>
                <Field label="Dòng chứng nhận ISO (Tiếng Việt / Song ngữ)">
                  <input
                    className={inputClass}
                    value={formsConfig.iso_badge_vi}
                    onChange={(e) => setFormsConfig({ ...formsConfig, iso_badge_vi: e.target.value })}
                  />
                </Field>
                <Field label="Dòng chứng nhận ISO (Tiếng Anh)">
                  <input
                    className={inputClass}
                    value={formsConfig.iso_badge_en}
                    onChange={(e) => setFormsConfig({ ...formsConfig, iso_badge_en: e.target.value })}
                  />
                </Field>
              </div>
              <Field label="Ghi chú chân trang (Footer Note)">
                <input
                  className={inputClass}
                  value={formsConfig.footer_note}
                  onChange={(e) => setFormsConfig({ ...formsConfig, footer_note: e.target.value })}
                />
              </Field>
            </div>

            {/* PHẦN II: MẪU 1 — PHIẾU TRẢ KẾT QUẢ KIỂM NGHIỆM QC (BM-QC-TR-01) */}
            <div className="pt-3 border-t border-sky-200 dark:border-sky-800 space-y-3">
              <div>
                <div className="text-xs font-extrabold uppercase text-blue-900 dark:text-sky-300">
                  II. Cài đặt Mẫu 1 — Phiếu Trả Kết Quả Kiểm Nghiệm Chất Lượng ({formsConfig.qc_report.form_code})
                </div>
                <div className="text-[11px] text-slate-500">
                  Hiển thị chi tiết từng chỉ tiêu thử nghiệm, phương pháp kiểm tra, thiết bị đo chuyên dụng, yêu cầu kỹ thuật và giá trị đo thực tế.
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Field label="Mã biểu mẫu Phiếu KQ QC">
                  <input
                    className={inputClass}
                    value={formsConfig.qc_report.form_code}
                    onChange={(e) =>
                      setFormsConfig({
                        ...formsConfig,
                        qc_report: { ...formsConfig.qc_report, form_code: e.target.value },
                      })
                    }
                  />
                </Field>
                <Field label="Tiền tố mã phiếu KQ (VD: TR-)">
                  <input
                    className={inputClass}
                    value={formsConfig.qc_report.doc_prefix}
                    onChange={(e) =>
                      setFormsConfig({
                        ...formsConfig,
                        qc_report: { ...formsConfig.qc_report, doc_prefix: e.target.value },
                      })
                    }
                  />
                </Field>
                <Field label="Tiêu đề chính (EN)">
                  <input
                    className={inputClass}
                    value={formsConfig.qc_report.title_en}
                    onChange={(e) =>
                      setFormsConfig({
                        ...formsConfig,
                        qc_report: { ...formsConfig.qc_report, title_en: e.target.value },
                      })
                    }
                  />
                </Field>
                <Field label="Tiêu đề phụ (VI)">
                  <input
                    className={inputClass}
                    value={formsConfig.qc_report.title_vi}
                    onChange={(e) =>
                      setFormsConfig({
                        ...formsConfig,
                        qc_report: { ...formsConfig.qc_report, title_vi: e.target.value },
                      })
                    }
                  />
                </Field>
              </div>
              <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={formsConfig.qc_report.show_equipment_in_method}
                  onChange={(e) =>
                    setFormsConfig({
                      ...formsConfig,
                      qc_report: { ...formsConfig.qc_report, show_equipment_in_method: e.target.checked },
                    })
                  }
                />
                Hiển thị dòng &quot;Thiết bị:&quot; màu xanh ngay dưới dòng &quot;Phương pháp:&quot; trong bảng Kết quả Phiếu QC
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Nội dung Kết luận khi ĐẠT (Phiếu KQ QC)">
                  <textarea
                    rows={2}
                    className={inputClass}
                    value={formsConfig.qc_report.conclusion_pass_bi}
                    onChange={(e) =>
                      setFormsConfig({
                        ...formsConfig,
                        qc_report: { ...formsConfig.qc_report, conclusion_pass_bi: e.target.value },
                      })
                    }
                  />
                </Field>
                <Field label="Nội dung Kết luận khi KHÔNG ĐẠT (Phiếu KQ QC)">
                  <textarea
                    rows={2}
                    className={inputClass}
                    value={formsConfig.qc_report.conclusion_fail_bi}
                    onChange={(e) =>
                      setFormsConfig({
                        ...formsConfig,
                        qc_report: { ...formsConfig.qc_report, conclusion_fail_bi: e.target.value },
                      })
                    }
                  />
                </Field>
              </div>
            </div>

            {/* PHẦN III: DANH MỤC MẪU COA THEO NHÓM SẢN PHẨM (9 MẪU CHUẨN + TÙY THÊM MẪU MỚI) */}
            <div className="pt-3 border-t border-sky-200 dark:border-sky-800 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-xs font-extrabold uppercase text-blue-900 dark:text-sky-300">
                    III. Quản lý Các Mẫu COA Theo Nhóm Sản Phẩm ({formsConfig.coa_templates.length} mẫu) &amp; Ngôn ngữ xuất
                  </div>
                  <div className="text-[11px] text-slate-500">
                    Mỗi nhóm sản phẩm (Kit phổ biến, OEM HN / TBR / Celltek / Medi / Metalab, Hóa chất tự pha, Chứng dương, Vật tư nguyên liệu) có mẫu COA riêng với câu chữ, tiêu đề, số HĐ gia công và trường thông tin riêng.
                  </div>
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    const rawKey = window.prompt("Nhập mã định danh mẫu COA mới (VD: OEM_ABC, KIT_EXPORT):");
                    if (!rawKey) return;
                    const key = rawKey.trim().toUpperCase().replace(/[^A-Z0-9_]/g, "_");
                    if (!key) return;
                    if (formsConfig.coa_templates.some((t) => t.key === key)) {
                      window.alert("Mã mẫu COA này đã tồn tại!");
                      setActiveTplKey(key);
                      return;
                    }
                    const name = window.prompt("Nhập tên hiển thị của mẫu COA:", `COA ${key}`) || `COA ${key}`;
                    const baseTpl = resolveCoaTemplate(formsConfig, "STANDARD");
                    const newTpl: CoaTemplateVariant = {
                      ...structuredClone(baseTpl),
                      key,
                      name: name.trim(),
                      category: key.startsWith("OEM") ? "OEM" : "STANDARD",
                      form_code: `BM-QC-COA-${key}`,
                      note: "Mẫu COA tùy chỉnh do Phòng QC tạo thêm.",
                      match_item_types: [],
                      match_product_prefixes: [],
                      match_product_codes: [],
                    };
                    setFormsConfig({
                      ...formsConfig,
                      coa_templates: [...formsConfig.coa_templates, newTpl],
                    });
                    setActiveTplKey(key);
                  }}
                >
                  + Tạo thêm Mẫu COA mới
                </Button>
              </div>

              {/* Template selector pills */}
              <div className="flex flex-wrap gap-1.5">
                {formsConfig.coa_templates.map((tpl) => (
                  <button
                    key={tpl.key}
                    type="button"
                    onClick={() => setActiveTplKey(tpl.key)}
                    className={`px-2.5 py-1.5 rounded-xl text-xs font-bold border cursor-pointer transition-colors ${
                      activeTplKey === tpl.key
                        ? "bg-blue-800 text-white border-blue-800 shadow-xs"
                        : "bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 border-slate-300 dark:border-slate-700 hover:bg-slate-100"
                    }`}
                  >
                    {tpl.name} <span className="opacity-75 font-mono text-[10px]">({tpl.form_code})</span>
                  </button>
                ))}
              </div>

              {(() => {
                const tplIdx = Math.max(
                  0,
                  formsConfig.coa_templates.findIndex((t) => t.key === activeTplKey)
                );
                const tpl = formsConfig.coa_templates[tplIdx] ?? formsConfig.coa_templates[0];
                if (!tpl) return null;

                const updateActiveTpl = (patch: Partial<CoaTemplateVariant>) => {
                  const nextList = [...formsConfig.coa_templates];
                  const updated = { ...tpl, ...patch };
                  nextList[tplIdx] = updated;
                  // Đồng bộ mẫu STANDARD với formsConfig.coa để giữ tương thích ngược
                  const nextCoa =
                    updated.key === "STANDARD"
                      ? {
                          ...formsConfig.coa,
                          form_code: updated.form_code,
                          doc_prefix: updated.doc_prefix,
                          default_lang: updated.default_lang,
                          title_bi_main: updated.title_bi_main,
                          title_bi_sub: updated.title_bi_sub,
                          title_vi_main: updated.title_vi_main,
                          title_en_main: updated.title_en_main,
                          title_en_sub: updated.title_en_sub,
                          results_mode: updated.results_mode,
                          tccs_param_vi: updated.tccs_param_vi,
                          tccs_param_en: updated.tccs_param_en,
                          tccs_method_vi: updated.tccs_method_vi,
                          tccs_method_en: updated.tccs_method_en,
                          tccs_spec_template_vi: updated.tccs_spec_template_vi,
                          tccs_spec_template_en: updated.tccs_spec_template_en,
                          tccs_spec_fallback_vi: updated.tccs_spec_fallback_vi,
                          tccs_spec_fallback_en: updated.tccs_spec_fallback_en,
                          conclusion_pass_vi: updated.conclusion_pass_vi,
                          conclusion_pass_en: updated.conclusion_pass_en,
                          conclusion_fail_vi: updated.conclusion_fail_vi,
                          conclusion_fail_en: updated.conclusion_fail_en,
                          custom_summary_rows: updated.custom_summary_rows,
                        }
                      : formsConfig.coa;
                  setFormsConfig({ ...formsConfig, coa: nextCoa, coa_templates: nextList });
                };

                return (
                  <div className="p-3.5 rounded-xl border border-blue-200 dark:border-blue-800 bg-white dark:bg-slate-900 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-800 pb-2">
                      <div>
                        <span className="text-xs font-extrabold text-blue-900 dark:text-sky-300">
                          Đang chỉnh mẫu: {tpl.name} (Mã: {tpl.key})
                        </span>
                        <div className="text-[11px] text-slate-500">{tpl.note}</div>
                      </div>
                      {!DEFAULT_COA_TEMPLATES.some((d) => d.key === tpl.key) && (
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => {
                            const nextList = formsConfig.coa_templates.filter((t) => t.key !== tpl.key);
                            setFormsConfig({ ...formsConfig, coa_templates: nextList });
                            setActiveTplKey("STANDARD");
                          }}
                        >
                          🗑️ Xóa mẫu này
                        </Button>
                      )}
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      <Field label="Tên mẫu COA *">
                        <input
                          className={inputClass}
                          value={tpl.name}
                          onChange={(e) => updateActiveTpl({ name: e.target.value })}
                        />
                      </Field>
                      <Field label="Phân nhóm mẫu COA">
                        <select
                          className={inputClass}
                          value={tpl.category}
                          onChange={(e) => updateActiveTpl({ category: e.target.value as CoaTemplateCategory })}
                        >
                          <option value="STANDARD">1. COA phổ biến (Chuẩn ABT)</option>
                          <option value="OEM">2. COA OEM (Gia công theo HĐ)</option>
                          <option value="SELF_PREP">3. COA tự pha (BTP / Dung dịch)</option>
                          <option value="POSITIVE_CONTROL">4. COA chứng dương (Positive Control)</option>
                          <option value="RAW_MATERIAL">5. COA vật tư / nguyên liệu (1 lô - 1 COA)</option>
                        </select>
                      </Field>
                      <Field label="Mã biểu mẫu COA">
                        <input
                          className={inputClass}
                          value={tpl.form_code}
                          onChange={(e) => updateActiveTpl({ form_code: e.target.value })}
                        />
                      </Field>
                      <Field label="Tiền tố mã COA (VD: COA-)">
                        <input
                          className={inputClass}
                          value={tpl.doc_prefix}
                          onChange={(e) => updateActiveTpl({ doc_prefix: e.target.value })}
                        />
                      </Field>
                      <Field label="Ngôn ngữ xuất mặc định">
                        <select
                          className={inputClass}
                          value={tpl.default_lang}
                          onChange={(e) => updateActiveTpl({ default_lang: e.target.value as any })}
                        >
                          <option value="BI">Song ngữ Mẫu chuẩn (BI)</option>
                          <option value="VI">🇻🇳 Tiếng Việt hoàn toàn (VI)</option>
                          <option value="EN">🇬🇧 Tiếng Anh hoàn toàn (EN)</option>
                        </select>
                      </Field>
                      <Field label="Chế độ Bảng kết quả trên COA">
                        <select
                          className={inputClass}
                          value={tpl.results_mode}
                          onChange={(e) => updateActiveTpl({ results_mode: e.target.value as any })}
                        >
                          <option value="TCCS_CONFORMANCE">1. Chỉ ghi Đạt / Không đạt theo TCCS</option>
                          <option value="SUMMARY_TEMPLATE">2. Bộ chỉ tiêu tổng quát tự cấu hình</option>
                          <option value="CONFORMS_ONLY">3. Tên chỉ tiêu từ QC nhưng chỉ ghi Đạt chuẩn</option>
                          <option value="DETAILED_QC">4. Hiển thị chi tiết giá trị đo thực tế từ QC</option>
                        </select>
                      </Field>
                      <Field label="Tiêu đề phụ COA (Song ngữ / VI)">
                        <input
                          className={inputClass}
                          value={tpl.title_bi_sub}
                          onChange={(e) => updateActiveTpl({ title_bi_sub: e.target.value, title_vi_main: `${e.target.value} (COA)` })}
                        />
                      </Field>
                      <Field label="Tiêu đề phụ COA (English)">
                        <input
                          className={inputClass}
                          value={tpl.title_en_sub}
                          onChange={(e) => updateActiveTpl({ title_en_sub: e.target.value })}
                        />
                      </Field>
                    </div>

                    {/* Quy tắc hiển thị đặc thù theo mẫu */}
                    <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 space-y-2.5">
                      <div className="text-[11px] font-bold text-slate-700 dark:text-slate-200">
                        Tùy chọn trường thông tin đặc thù &amp; Gợi ý tự động theo nhóm sản phẩm:
                      </div>
                      <div className="flex flex-wrap gap-4 text-xs">
                        <label className="flex items-center gap-1.5 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={tpl.hide_tccs}
                            onChange={(e) => updateActiveTpl({ hide_tccs: e.target.checked })}
                          />
                          Ẩn số TCCS (dùng cho COA tự pha / COA vật tư)
                        </label>
                        <label className="flex items-center gap-1.5 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={tpl.show_volume_conc_seq}
                            onChange={(e) => updateActiveTpl({ show_volume_conc_seq: e.target.checked })}
                          />
                          Thể hiện Thể tích, Nồng độ, Trình tự (nếu yêu cầu)
                        </label>
                        <label className="flex items-center gap-1.5 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={tpl.show_ct_standard}
                            onChange={(e) => updateActiveTpl({ show_ct_standard: e.target.checked })}
                          />
                          Thể hiện Tiêu chuẩn Ct &amp; Số TCCS bộ Kit (COA chứng dương)
                        </label>
                        <label className="flex items-center gap-1.5 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={tpl.show_raw_material_lot}
                            onChange={(e) => updateActiveTpl({ show_raw_material_lot: e.target.checked })}
                          />
                          Xuất theo lô nguyên liệu (1 lô nguyên liệu - 1 COA)
                        </label>
                      </div>

                      <div className="grid gap-3 sm:grid-cols-3">
                        {tpl.category === "OEM" && (
                          <>
                            <Field label="Tên đơn vị OEM (VD: HN, TBR, Celltek...)">
                              <input
                                className={inputClass}
                                value={tpl.oem_partner_name}
                                onChange={(e) => updateActiveTpl({ oem_partner_name: e.target.value })}
                              />
                            </Field>
                            <Field label="Số Hợp đồng gia công mặc định">
                              <input
                                className={inputClass}
                                placeholder="VD: 01/2026/HĐGC-HN"
                                value={tpl.default_contract_no}
                                onChange={(e) => updateActiveTpl({ default_contract_no: e.target.value })}
                              />
                            </Field>
                          </>
                        )}
                        <Field label="Tiền tố mã SP tự gợi ý (cách bởi dấu phẩy, VD: SOL-, PREP-)">
                          <input
                            className={inputClass}
                            placeholder="VD: SOL-, PREP-, PC-"
                            value={tpl.match_product_prefixes.join(", ")}
                            onChange={(e) =>
                              updateActiveTpl({
                                match_product_prefixes: e.target.value
                                  .split(",")
                                  .map((s) => s.trim().toUpperCase())
                                  .filter(Boolean),
                              })
                            }
                          />
                        </Field>
                        <Field label="Mã sản phẩm gán cố định vào mẫu này (cách bởi dấu phẩy)">
                          <input
                            className={inputClass}
                            placeholder="VD:SQH-001, HI-002"
                            value={tpl.match_product_codes.join(", ")}
                            onChange={(e) =>
                              updateActiveTpl({
                                match_product_codes: e.target.value
                                  .split(",")
                                  .map((s) => s.trim().toUpperCase())
                                  .filter(Boolean),
                              })
                            }
                          />
                        </Field>
                      </div>
                    </div>

                    {tpl.results_mode === "TCCS_CONFORMANCE" && (
                      <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900 space-y-2.5">
                        <div className="text-[11px] font-bold text-slate-700 dark:text-slate-200">
                          Nội dung dòng Chỉ tiêu đánh giá của mẫu {tpl.name} (dùng <code>{"{TCCS}"}</code> để tự chèn mã TCCS):
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <Field label="Chỉ tiêu (VI / Song ngữ)">
                            <input
                              className={inputClass}
                              value={tpl.tccs_param_vi}
                              onChange={(e) => updateActiveTpl({ tccs_param_vi: e.target.value })}
                            />
                          </Field>
                          <Field label="Chỉ tiêu (English)">
                            <input
                              className={inputClass}
                              value={tpl.tccs_param_en}
                              onChange={(e) => updateActiveTpl({ tccs_param_en: e.target.value })}
                            />
                          </Field>
                          <Field label="Phương pháp kiểm tra (VI / Song ngữ)">
                            <input
                              className={inputClass}
                              value={tpl.tccs_method_vi}
                              onChange={(e) => updateActiveTpl({ tccs_method_vi: e.target.value })}
                            />
                          </Field>
                          <Field label="Phương pháp kiểm tra (English)">
                            <input
                              className={inputClass}
                              value={tpl.tccs_method_en}
                              onChange={(e) => updateActiveTpl({ tccs_method_en: e.target.value })}
                            />
                          </Field>
                          <Field label="Mẫu Yêu cầu kỹ thuật (VI · dùng {TCCS})">
                            <input
                              className={inputClass}
                              value={tpl.tccs_spec_template_vi}
                              onChange={(e) => updateActiveTpl({ tccs_spec_template_vi: e.target.value })}
                            />
                          </Field>
                          <Field label="Mẫu Yêu cầu kỹ thuật (EN · dùng {TCCS})">
                            <input
                              className={inputClass}
                              value={tpl.tccs_spec_template_en}
                              onChange={(e) => updateActiveTpl({ tccs_spec_template_en: e.target.value })}
                            />
                          </Field>
                        </div>
                      </div>
                    )}

                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field label="Câu chữ Kết luận ĐẠT trên COA (Tiếng Việt / Song ngữ)">
                        <textarea
                          rows={2}
                          className={inputClass}
                          value={tpl.conclusion_pass_vi}
                          onChange={(e) => updateActiveTpl({ conclusion_pass_vi: e.target.value })}
                        />
                      </Field>
                      <Field label="Câu chữ Kết luận ĐẠT trên COA (English)">
                        <textarea
                          rows={2}
                          className={inputClass}
                          value={tpl.conclusion_pass_en}
                          onChange={(e) => updateActiveTpl({ conclusion_pass_en: e.target.value })}
                        />
                      </Field>
                    </div>

                    {tpl.results_mode === "SUMMARY_TEMPLATE" && (
                      <div className="space-y-2 bg-slate-50/60 dark:bg-slate-900 p-3 rounded-xl border border-slate-200 dark:border-slate-800">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-slate-700 dark:text-slate-200">
                            Danh sách Chỉ tiêu Tổng quát của mẫu {tpl.name} ({tpl.custom_summary_rows.length} dòng):
                          </span>
                          <Button
                            type="button"
                            variant="ghost"
                            onClick={() =>
                              updateActiveTpl({
                                custom_summary_rows: [
                                  ...tpl.custom_summary_rows,
                                  {
                                    seq: tpl.custom_summary_rows.length + 1,
                                    parameter_name: "Cảm quan và kỹ thuật",
                                    parameter_name_en: "Sensory & Technical",
                                    method: "Kiểm tra theo SOP",
                                    method_en: "Tested according to SOP",
                                    spec_limit: "Đạt yêu cầu",
                                    spec_limit_en: "Conforms",
                                    observed_value: "ĐẠT (PASS)",
                                    observed_value_en: "PASS",
                                    passed: true,
                                  },
                                ],
                              })
                            }
                          >
                            + Thêm dòng chỉ tiêu COA
                          </Button>
                        </div>

                        <Table head={["#", "Chỉ tiêu (VI)", "Chỉ tiêu (EN)", "Phương pháp (VI)", "Yêu cầu (VI)", "Kết luận", ""]}>
                          {tpl.custom_summary_rows.map((row, idx) => (
                            <tr key={idx}>
                              <td className="py-1.5 pr-2 font-mono text-xs w-8">{idx + 1}</td>
                              <td className="py-1.5 pr-2">
                                <input
                                  className={inputClass}
                                  value={row.parameter_name}
                                  onChange={(e) => {
                                    const next = [...tpl.custom_summary_rows];
                                    next[idx] = { ...next[idx], parameter_name: e.target.value };
                                    updateActiveTpl({ custom_summary_rows: next });
                                  }}
                                />
                              </td>
                              <td className="py-1.5 pr-2">
                                <input
                                  className={inputClass}
                                  value={row.parameter_name_en ?? ""}
                                  onChange={(e) => {
                                    const next = [...tpl.custom_summary_rows];
                                    next[idx] = { ...next[idx], parameter_name_en: e.target.value };
                                    updateActiveTpl({ custom_summary_rows: next });
                                  }}
                                />
                              </td>
                              <td className="py-1.5 pr-2">
                                <input
                                  className={inputClass}
                                  value={row.method}
                                  onChange={(e) => {
                                    const next = [...tpl.custom_summary_rows];
                                    next[idx] = { ...next[idx], method: e.target.value };
                                    updateActiveTpl({ custom_summary_rows: next });
                                  }}
                                />
                              </td>
                              <td className="py-1.5 pr-2">
                                <input
                                  className={inputClass}
                                  value={row.spec_limit}
                                  onChange={(e) => {
                                    const next = [...tpl.custom_summary_rows];
                                    next[idx] = { ...next[idx], spec_limit: e.target.value };
                                    updateActiveTpl({ custom_summary_rows: next });
                                  }}
                                />
                              </td>
                              <td className="py-1.5 pr-2 w-28">
                                <select
                                  className={inputClass}
                                  value={row.passed ? "PASS" : "FAIL"}
                                  onChange={(e) => {
                                    const next = [...tpl.custom_summary_rows];
                                    next[idx] = { ...next[idx], passed: e.target.value === "PASS" };
                                    updateActiveTpl({ custom_summary_rows: next });
                                  }}
                                >
                                  <option value="PASS">ĐẠT / PASS</option>
                                  <option value="FAIL">KHÔNG ĐẠT</option>
                                </select>
                              </td>
                              <td className="py-1.5 text-right w-8">
                                <button
                                  type="button"
                                  className="text-rose-600 hover:text-rose-800 font-bold px-2 py-1 cursor-pointer"
                                  title="Xóa dòng"
                                  onClick={() => {
                                    const next = tpl.custom_summary_rows.filter((_, i) => i !== idx);
                                    updateActiveTpl({ custom_summary_rows: next });
                                  }}
                                >
                                  ✕
                                </button>
                              </td>
                            </tr>
                          ))}
                        </Table>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>

            {/* PHẦN IV: QUẢN LÝ CHỮ KÝ NHÂN VIÊN PHÒNG QC/QA */}
            <div className="pt-3 border-t border-sky-200 dark:border-sky-800 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-xs font-extrabold uppercase text-blue-900 dark:text-sky-300">
                    IV. Quản lý Chữ ký Tay Nhân viên Phòng QC/QA ({formsConfig.staff_signatures.length} nhân sự)
                  </div>
                  <div className="text-[11px] text-slate-500">
                    Mã nhân viên (NV-ABT-xxx) tự động đồng bộ theo Trang Nhân sự. Hệ thống ghép ảnh chữ ký tương ứng theo Người kiểm nghiệm &amp; Trưởng phòng QC/QA khi in Phiếu trả KQ QC và COA.
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      const hrList = Array.isArray(qaOps.data?.qa_personnel) && qaOps.data.qa_personnel.length > 0
                        ? qaOps.data.qa_personnel
                        : DEFAULT_QC_FORMS_CONFIG.staff_signatures.map((s) => ({
                            employee_code: s.emp_code,
                            full_name: s.full_name,
                            position: s.title_vi,
                          }));
                      const synced = normalizeQcFormsConfig(null, formsConfig, hrList);
                      setFormsConfig(synced);
                      setSigUploadNotice(
                        `✅ Đã đồng bộ ${synced.staff_signatures.length} nhân sự QC/QA theo đúng mã nhân viên từ Trang Nhân sự (NV-ABT-xxx). Bấm 'Lưu Cấu hình' để lưu.`
                      );
                    }}
                  >
                    🔄 Đồng bộ Mã NV từ Nhân sự
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      const hrList: Array<{ employee_code: string; full_name: string; position?: string }> =
                        Array.isArray(qaOps.data?.qa_personnel) ? qaOps.data.qa_personnel : [];
                      const missingHr = hrList.find(
                        (h) =>
                          !formsConfig.staff_signatures.some(
                            (s) =>
                              stripVnAccents(s.emp_code) === stripVnAccents(h.employee_code) ||
                              stripVnAccents(s.full_name) === stripVnAccents(h.full_name)
                          )
                      );
                      const newEntry: QcStaffSignatureEntry = missingHr
                        ? {
                            id: missingHr.employee_code.trim().toLowerCase(),
                            emp_code: missingHr.employee_code.trim(),
                            full_name: missingHr.full_name.trim(),
                            title_vi: missingHr.position?.trim() || "Nhân viên QC",
                            title_en: "QC Analyst",
                            role: /trưởng phòng|phó trưởng phòng|manager|head/i.test(missingHr.position || "")
                              ? "MANAGER"
                              : "ANALYST",
                            signature_url: "",
                            aliases: [missingHr.employee_code.trim().toLowerCase(), stripVnAccents(missingHr.full_name)],
                            active: true,
                          }
                        : {
                            id: `nv-custom-${Date.now()}`,
                            emp_code: "NV-ABT-",
                            full_name: "Nhân viên QC mới",
                            title_vi: "Nhân viên QC",
                            title_en: "QC Analyst",
                            role: "ANALYST",
                            signature_url: "",
                            aliases: [],
                            active: true,
                          };
                      setFormsConfig({
                        ...formsConfig,
                        staff_signatures: [...formsConfig.staff_signatures, newEntry],
                      });
                    }}
                  >
                    + Thêm nhân viên ký tên
                  </Button>
                </div>
              </div>

              <datalist id="qc-hr-emp-codes">
                {(qaOps.data?.qa_personnel ?? DEFAULT_QC_FORMS_CONFIG.staff_signatures.map((s) => ({
                  employee_code: s.emp_code,
                  full_name: s.full_name,
                  position: s.title_vi,
                }))).map((p: any) => (
                  <option key={p.employee_code} value={p.employee_code}>
                    {p.full_name} — {p.position || "Nhân viên QC"}
                  </option>
                ))}
              </datalist>
              <datalist id="qc-hr-emp-names">
                {formsConfig.staff_signatures.map((s) => (
                  <option key={s.id} value={s.full_name}>
                    {s.emp_code ? `${s.emp_code} · ` : ""}{s.title_vi}
                  </option>
                ))}
              </datalist>

              {sigUploadNotice && (
                <div className="p-2 rounded-lg bg-sky-100/70 dark:bg-sky-900/40 text-xs text-sky-900 dark:text-sky-200">
                  {sigUploadNotice}
                </div>
              )}

              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Người kiểm nghiệm mặc định (Nếu phiếu chưa ghi tên)">
                  <select
                    className={inputClass}
                    value={formsConfig.default_analyst_name}
                    onChange={(e) => setFormsConfig({ ...formsConfig, default_analyst_name: e.target.value })}
                  >
                    <option value="">-- Tự động theo Người kiểm nghiệm trên phiếu QC --</option>
                    {formsConfig.staff_signatures.map((s) => (
                      <option key={s.id} value={s.full_name}>
                        {s.emp_code ? `${s.emp_code} — ` : ""}{s.full_name} ({s.title_vi})
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Trưởng phòng QC/QA ký duyệt mặc định">
                  <select
                    className={inputClass}
                    value={formsConfig.default_manager_name}
                    onChange={(e) => setFormsConfig({ ...formsConfig, default_manager_name: e.target.value })}
                  >
                    {formsConfig.staff_signatures.map((s) => (
                      <option key={s.id} value={s.full_name}>
                        {s.emp_code ? `${s.emp_code} — ` : ""}{s.full_name} ({s.title_vi})
                      </option>
                    ))}
                  </select>
                </Field>
              </div>

              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {formsConfig.staff_signatures.map((sig, idx) => (
                  <div
                    key={sig.id}
                    className="p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 space-y-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-[11px] font-bold px-2 py-0.5 rounded bg-indigo-50 text-indigo-800">
                        {sig.emp_code || "Chưa gán mã"}
                      </span>
                      <select
                        className="text-[11px] rounded border border-slate-300 dark:border-slate-700 bg-transparent px-1.5 py-0.5"
                        value={sig.role}
                        onChange={(e) => {
                          const next = [...formsConfig.staff_signatures];
                          next[idx] = { ...next[idx], role: e.target.value as "ANALYST" | "MANAGER" };
                          setFormsConfig({ ...formsConfig, staff_signatures: next });
                        }}
                      >
                        <option value="ANALYST">Kiểm nghiệm viên (Analyst)</option>
                        <option value="MANAGER">Trưởng phòng QC/QA (Manager)</option>
                      </select>
                      {formsConfig.staff_signatures.length > 1 && (
                        <button
                          type="button"
                          className="text-rose-600 hover:text-rose-800 text-xs font-bold cursor-pointer"
                          title="Xóa chữ ký này"
                          onClick={() => {
                            const next = formsConfig.staff_signatures.filter((_, i) => i !== idx);
                            setFormsConfig({ ...formsConfig, staff_signatures: next });
                          }}
                        >
                          ✕
                        </button>
                      )}
                    </div>

                    <div className="grid gap-1.5">
                      <input
                        list="qc-hr-emp-codes"
                        className={`${inputClass} !text-xs font-mono`}
                        placeholder="Mã NV (VD: NV-ABT-060)"
                        value={sig.emp_code}
                        onChange={(e) => {
                          const val = e.target.value;
                          const hrList: any[] = qaOps.data?.qa_personnel ?? [];
                          const matchedHr = hrList.find(
                            (h) => stripVnAccents(h.employee_code) === stripVnAccents(val)
                          );
                          const next = [...formsConfig.staff_signatures];
                          next[idx] = {
                            ...next[idx],
                            emp_code: val,
                            ...(matchedHr
                              ? {
                                  full_name: matchedHr.full_name,
                                  title_vi: matchedHr.position || next[idx].title_vi,
                                }
                              : {}),
                          };
                          setFormsConfig({ ...formsConfig, staff_signatures: next });
                        }}
                      />
                      <input
                        list="qc-hr-emp-names"
                        className={`${inputClass} !text-xs font-semibold`}
                        placeholder="Họ và tên nhân viên"
                        value={sig.full_name}
                        onChange={(e) => {
                          const val = e.target.value;
                          const hrList: any[] = qaOps.data?.qa_personnel ?? [];
                          const matchedHr = hrList.find(
                            (h) => stripVnAccents(h.full_name) === stripVnAccents(val)
                          );
                          const next = [...formsConfig.staff_signatures];
                          next[idx] = {
                            ...next[idx],
                            full_name: val,
                            ...(matchedHr && (!next[idx].emp_code || next[idx].emp_code === "NV-ABT-")
                              ? {
                                  emp_code: matchedHr.employee_code,
                                  title_vi: matchedHr.position || next[idx].title_vi,
                                }
                              : {}),
                          };
                          setFormsConfig({ ...formsConfig, staff_signatures: next });
                        }}
                      />
                      {sig.title_vi && (
                        <div className="text-[11px] text-slate-500 px-0.5 truncate" title={sig.title_vi}>
                          Chức vụ: <span className="font-medium text-slate-700 dark:text-slate-300">{sig.title_vi}</span>
                        </div>
                      )}
                    </div>

                    <div className="h-16 rounded-lg border border-dashed border-slate-300 bg-slate-50 flex items-center justify-center p-1">
                      {sig.signature_url ? (
                        <img
                          src={sig.signature_url}
                          alt={`Chữ ký ${sig.full_name}`}
                          className="max-h-14 max-w-full object-contain"
                        />
                      ) : (
                        <span className="text-[11px] text-slate-400">Chưa có chữ ký</span>
                      )}
                    </div>

                    <label className="block text-[11px] font-semibold text-sky-700 hover:text-sky-800 cursor-pointer">
                      <span>📤 Đổi / Tải ảnh chữ ký PNG mới</span>
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          if (file.size > 1_500_000) {
                            setSigUploadNotice("⚠️ Ảnh chữ ký quá lớn (>1.5MB). Vui lòng nén ảnh PNG nhỏ hơn 1.5MB.");
                            return;
                          }
                          const reader = new FileReader();
                          reader.onload = () => {
                            if (typeof reader.result === "string") {
                              const next = [...formsConfig.staff_signatures];
                              next[idx] = { ...next[idx], signature_url: reader.result };
                              setFormsConfig({ ...formsConfig, staff_signatures: next });
                              setSigUploadNotice(`✅ Đã tải ảnh chữ ký mới cho ${sig.full_name}. Bấm 'Lưu Cấu hình' để lưu.`);
                            }
                          };
                          reader.readAsDataURL(file);
                          e.target.value = "";
                        }}
                      />
                    </label>
                  </div>
                ))}
              </div>
            </div>
          </form>
        )}

        {selected && selectedSource === "coa" && !isRenderedInlineInCoa && (
          <div className="mb-3">{renderInlineDetailPanel(selected)}</div>
        )}
        {(qaOps.data?.issued_coas ?? []).length === 0 ? (
          <Empty>Chưa có COA nào được cấp phát. Duyệt đạt Phiếu QC để cấp COA và tự động ánh xạ sang Phòng Sản xuất Kit &amp; Kinh doanh.</Empty>
        ) : (
          <Table head={["Số COA (Do QC cấp)", "Phiếu QC gốc", "Mã Lô & Sản phẩm", "NSX → HSD", "Quy cách / SL Đạt", "Người kiểm nghiệm & Người ký duyệt COA", "Trạng thái Ánh xạ", "Thao tác"]}>
            {(qaOps.data?.issued_coas ?? []).map((c: any) => {
              const rowExpanded =
                selected &&
                selectedSource === "coa" &&
                c.qc_test_id === selected &&
                (!selectedAnchorId || c.id === selectedAnchorId);
              return (
                <Fragment key={c.id}>
                  <tr className={rowExpanded ? "bg-sky-50/70 dark:bg-sky-950/30" : ""}>
                    <td className="py-2 pr-3 font-mono text-xs font-bold text-emerald-700 dark:text-emerald-400">
                      <div>{c.code}</div>
                      <div className="flex flex-wrap gap-1 mt-0.5 font-sans">
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                          v{c.revision_no ?? 1}
                        </span>
                        {c.is_superseded && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                            Đã thay thế (Superseded)
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-2 pr-3 font-mono text-xs">
                      {c.qc_test_code ? (
                        <button
                          type="button"
                          className="text-sky-700 dark:text-sky-400 underline font-semibold cursor-pointer"
                          onClick={() => c.qc_test_id && openTestInline(c.qc_test_id, "coa", c.id)}
                        >
                          {c.qc_test_code}
                        </button>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                      {c.spec_code && <div className="text-[11px] text-slate-400">{c.spec_code} v{c.spec_version ?? 1}</div>}
                    </td>
                    <td className="py-2 pr-3 text-xs">
                      <div className="font-mono font-bold text-sky-700 dark:text-sky-300">Lô: {c.lot_code}</div>
                      <div className="font-medium">{c.product_code} — {c.product_name}</div>
                    </td>
                    <td className="py-2 pr-3 text-xs font-mono whitespace-nowrap">
                      {fmtDate(c.mfg_date)} → {fmtDate(c.expiry_date)}
                    </td>
                    <td className="py-2 pr-3 text-xs">
                      <div className="font-semibold">{fmtQty(c.good_qty)} {c.uom}</div>
                      <div className="text-[11px] text-slate-400">
                        {Number(c.tests_per_kit) > 0 ? `${c.tests_per_kit} test/Kit` : "Bán thành phẩm / Lô đơn"}
                        {c.actual_ph ? ` · pH ${c.actual_ph}` : ""}
                      </div>
                    </td>
                    <td className="py-2 pr-3 text-xs">
                      {c.analyst_name && <div className="text-slate-500">KN: <b>{c.analyst_name}</b></div>}
                      <div>Ký duyệt: <b className="text-emerald-700 dark:text-emerald-400">{c.issued_by_name}</b></div>
                    </td>
                    <td className="py-2 pr-3 text-xs">
                      <StatusBadge
                        status={c.is_superseded ? "CANCELLED" : "RELEASED"}
                        label={
                          c.is_superseded
                            ? "Bản cũ (Đã cấp phụ lục mới)"
                            : c.order_code
                              ? `Đã ánh xạ → ${c.order_code}`
                              : "Đã ánh xạ sang SX & KD"
                        }
                      />
                    </td>
                    <td className="py-2 pr-3 text-xs whitespace-nowrap">
                      <div className="inline-flex flex-wrap items-center gap-1">
                        <button
                          type="button"
                          title="Xem & Tùy chọn Ngôn ngữ COA"
                          className="px-2 py-1 rounded-lg text-[11px] font-medium border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                          onClick={() => {
                            setEditingCoa(null);
                            setSelectedCoa(c);
                          }}
                        >
                          📄 Xem COA
                        </button>
                        <button
                          type="button"
                          title="Xuất COA Tiếng Việt"
                          className="px-2 py-1 rounded-lg text-[11px] font-medium border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                          onClick={() => printKitCoaCertificate(c, formsConfig, "VI")}
                        >
                          🇻🇳 Việt
                        </button>
                        <button
                          type="button"
                          title="Export COA in English"
                          className="px-2 py-1 rounded-lg text-[11px] font-medium border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                          onClick={() => printKitCoaCertificate(c, formsConfig, "EN")}
                        >
                          🇬🇧 EN
                        </button>
                        <button
                          type="button"
                          title="Sửa thông tin & chỉ tiêu trên COA"
                          className="px-2 py-1 rounded-lg text-[11px] font-medium border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                          onClick={() => startEditingCoa(c)}
                        >
                          ✏️ Sửa
                        </button>
                        {c.qc_test_id && (
                          <button
                            type="button"
                            title="In Phiếu Trả Kết quả QC gốc (BM-QC-TR-01)"
                            className="px-2 py-1 rounded-lg text-[11px] font-medium border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                            onClick={() => printTestCoa(c.qc_test_id, formsConfig).catch((e) => window.alert(e.message))}
                          >
                            🖨️ Phiếu KQ QC
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                  {rowExpanded && c.qc_test_id && (
                    <tr className="bg-sky-50/40 dark:bg-sky-950/20">
                      <td colSpan={8} className="p-3 border-b-2 border-sky-400 dark:border-sky-700">
                        {renderInlineDetailPanel(c.qc_test_id)}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </Table>
        )}
      </Card>

      {selectedCoa && (
        <Card
          title={`Phiếu Chứng nhận Phân tích COA (${selectedCoa.code} · BM-QC-COA-01 · Cấp bởi Phòng QA/QC)`}
          actions={
            <div className="flex flex-wrap gap-2">
              <Button variant="ghost" onClick={() => (editingCoa ? setEditingCoa(null) : startEditingCoa(selectedCoa))}>
                {editingCoa ? "👁️ Xem trước Bản in COA" : "✏️ Chỉnh sửa thông tin & chỉ tiêu COA"}
              </Button>
              <Button onClick={() => printKitCoaCertificate(selectedCoa, formsConfig, "BI")}>📄 In COA (Mẫu chuẩn)</Button>
              <Button variant="secondary" onClick={() => printKitCoaCertificate(selectedCoa, formsConfig, "VI")}>🇻🇳 Xuất Tiếng Việt</Button>
              <Button variant="secondary" onClick={() => printKitCoaCertificate(selectedCoa, formsConfig, "EN")}>🇬🇧 Export English</Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setEditingCoa(null);
                  setSelectedCoa(null);
                }}
              >
                Đóng
              </Button>
            </div>
          }
        >
          {editingCoa && (
            <form
              className="mb-5 p-4 rounded-xl border-2 border-amber-400 dark:border-amber-700 bg-amber-50/40 dark:bg-amber-950/20 space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                updateCoaMut.mutate(editingCoa);
              }}
            >
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-200 dark:border-amber-800 pb-2">
                <div>
                  <div className="text-xs font-extrabold uppercase text-amber-900 dark:text-amber-300">
                    ✏️ Ban hành Phụ lục Sửa đổi COA (-R{Number(selectedCoa?.revision_no ?? 1) + 1} · Chỉ ghi nối Append-only)
                  </div>
                  <div className="text-[11px] text-slate-500">
                    Bản COA cũ ({selectedCoa?.code}) được giữ nguyên lịch sử và đánh dấu Đã thay thế (Superseded) theo 21 CFR Part 11.
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    className={`${inputClass} w-28`}
                    value={coaSigMethod}
                    onChange={(e) => setCoaSigMethod(e.target.value as "PIN" | "PASSWORD")}
                  >
                    <option value="PIN">Mã PIN</option>
                    <option value="PASSWORD">Mật khẩu</option>
                  </select>
                  <input
                    type="password"
                    className={`${inputClass} w-40`}
                    placeholder="PIN / Mật khẩu ký số *"
                    value={coaSigSecret}
                    onChange={(e) => setCoaSigSecret(e.target.value)}
                    required
                  />
                  <Button type="submit" disabled={updateCoaMut.isPending}>
                    💾 Ban hành Phụ lục COA
                  </Button>
                  <Button variant="ghost" onClick={() => setEditingCoa(null)}>
                    Hủy sửa
                  </Button>
                </div>
              </div>
              <ErrorNote error={updateCoaMut.error} />

              <div className="grid gap-3 sm:grid-cols-4">
                <Field label="Số chứng nhận COA *">
                  <input
                    className={inputClass}
                    value={editingCoa.code}
                    onChange={(e) => setEditingCoa({ ...editingCoa, code: e.target.value })}
                    required
                  />
                </Field>
                <Field label="Mã sản phẩm / REF *">
                  <input
                    className={inputClass}
                    value={editingCoa.product_code}
                    onChange={(e) => setEditingCoa({ ...editingCoa, product_code: e.target.value })}
                    required
                  />
                </Field>
                <div className="sm:col-span-2">
                  <Field label="Tên sản phẩm hiển thị trên COA *">
                    <input
                      className={inputClass}
                      value={editingCoa.product_name}
                      onChange={(e) => setEditingCoa({ ...editingCoa, product_name: e.target.value })}
                      required
                    />
                  </Field>
                </div>
                <Field label="Số Lô (LOT) *">
                  <input
                    className={inputClass}
                    value={editingCoa.lot_code}
                    onChange={(e) => setEditingCoa({ ...editingCoa, lot_code: e.target.value })}
                    required
                  />
                </Field>
                <Field label="Ngày sản xuất (MFG) *">
                  <input
                    type="date"
                    className={inputClass}
                    value={editingCoa.mfg_date}
                    onChange={(e) => setEditingCoa({ ...editingCoa, mfg_date: e.target.value })}
                    required
                  />
                </Field>
                <Field label="Hạn sử dụng (EXP) *">
                  <input
                    type="date"
                    className={inputClass}
                    value={editingCoa.expiry_date}
                    onChange={(e) => setEditingCoa({ ...editingCoa, expiry_date: e.target.value })}
                    required
                  />
                </Field>
                <Field label="Mã Tiêu chuẩn (Spec)">
                  <input
                    className={inputClass}
                    value={editingCoa.spec_code}
                    onChange={(e) => setEditingCoa({ ...editingCoa, spec_code: e.target.value })}
                    placeholder="VD: TC0001"
                  />
                </Field>
                <Field label="Số lượng đạt *">
                  <input
                    type="number"
                    step="any"
                    className={inputClass}
                    value={editingCoa.good_qty}
                    onChange={(e) => setEditingCoa({ ...editingCoa, good_qty: e.target.value })}
                    required
                  />
                </Field>
                <Field label="Đơn vị tính (ĐVT) *">
                  <input
                    className={inputClass}
                    value={editingCoa.uom}
                    onChange={(e) => setEditingCoa({ ...editingCoa, uom: e.target.value })}
                    required
                  />
                </Field>
                <Field label="Số test/Kit (Nhập 0 nếu là BTP/Lẻ)">
                  <input
                    type="number"
                    min={0}
                    className={inputClass}
                    value={editingCoa.tests_per_kit}
                    onChange={(e) => setEditingCoa({ ...editingCoa, tests_per_kit: Number(e.target.value) })}
                  />
                </Field>
                <Field label="Chuyên viên Kiểm nghiệm (KN)">
                  <input
                    list="qc-hr-emp-names"
                    className={inputClass}
                    value={editingCoa.analyst_name}
                    onChange={(e) => setEditingCoa({ ...editingCoa, analyst_name: e.target.value })}
                  />
                </Field>
                <Field label="Người ký duyệt COA (QA/QC) *">
                  <input
                    list="qc-hr-emp-names"
                    className={inputClass}
                    value={editingCoa.issued_by_name}
                    onChange={(e) => setEditingCoa({ ...editingCoa, issued_by_name: e.target.value })}
                    required
                  />
                </Field>
                <div className="sm:col-span-2">
                  <Field label="Kết luận xuất xưởng (Final Disposition) *">
                    <input
                      className={inputClass}
                      value={editingCoa.qc_summary}
                      onChange={(e) => setEditingCoa({ ...editingCoa, qc_summary: e.target.value })}
                      required
                    />
                  </Field>
                </div>
                <Field label="Mẫu COA áp dụng">
                  <select
                    className={inputClass}
                    value={editingCoa.template_key || "STANDARD"}
                    onChange={(e) => setEditingCoa({ ...editingCoa, template_key: e.target.value })}
                  >
                    {formsConfig.coa_templates.map((t) => (
                      <option key={t.key} value={t.key}>
                        {t.name} ({t.form_code})
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Số HĐ gia công (nếu mẫu OEM)">
                  <input
                    className={inputClass}
                    value={editingCoa.custom_fields?.contract_no ?? ""}
                    onChange={(e) =>
                      setEditingCoa({
                        ...editingCoa,
                        custom_fields: { ...(editingCoa.custom_fields ?? {}), contract_no: e.target.value },
                      })
                    }
                    placeholder="VD: 01/2026/HĐGC-ABT"
                  />
                </Field>
                <Field label="Thể tích / Nồng độ (nếu tự pha / chứng dương)">
                  <div className="flex gap-1.5">
                    <input
                      className={inputClass}
                      value={editingCoa.custom_fields?.volume ?? ""}
                      onChange={(e) =>
                        setEditingCoa({
                          ...editingCoa,
                          custom_fields: { ...(editingCoa.custom_fields ?? {}), volume: e.target.value },
                        })
                      }
                      placeholder="Thể tích"
                    />
                    <input
                      className={inputClass}
                      value={editingCoa.custom_fields?.concentration ?? ""}
                      onChange={(e) =>
                        setEditingCoa({
                          ...editingCoa,
                          custom_fields: { ...(editingCoa.custom_fields ?? {}), concentration: e.target.value },
                        })
                      }
                      placeholder="Nồng độ"
                    />
                  </div>
                </Field>
                <Field label="Tiêu chuẩn Ct / Trình tự (nếu có)">
                  <div className="flex gap-1.5">
                    <input
                      className={inputClass}
                      value={editingCoa.custom_fields?.ct_standard ?? ""}
                      onChange={(e) =>
                        setEditingCoa({
                          ...editingCoa,
                          custom_fields: { ...(editingCoa.custom_fields ?? {}), ct_standard: e.target.value },
                        })
                      }
                      placeholder="Tiêu chuẩn Ct"
                    />
                    <input
                      className={inputClass}
                      value={editingCoa.custom_fields?.sequence ?? ""}
                      onChange={(e) =>
                        setEditingCoa({
                          ...editingCoa,
                          custom_fields: { ...(editingCoa.custom_fields ?? {}), sequence: e.target.value },
                        })
                      }
                      placeholder="Trình tự 5'→3'"
                    />
                  </div>
                </Field>
                <Field label="Ghi chú bổ sung trên COA">
                  <input
                    className={inputClass}
                    value={editingCoa.custom_notes}
                    onChange={(e) => setEditingCoa({ ...editingCoa, custom_notes: e.target.value })}
                    placeholder="Ghi chú điều kiện bảo quản / vận chuyển..."
                  />
                </Field>
                <div className="sm:col-span-4">
                  <Field label="Lý do ban hành phụ lục COA (Tối thiểu 5 ký tự — Audit Trail 21 CFR Part 11) *">
                    <input
                      className={inputClass}
                      value={editingCoa.reason ?? ""}
                      onChange={(e) => setEditingCoa({ ...editingCoa, reason: e.target.value })}
                      placeholder="Nhập rõ lý do hiệu chỉnh / ban hành phụ lục COA..."
                      minLength={5}
                      required
                    />
                  </Field>
                </div>
              </div>

              {/* Editable Analytical Results Table */}
              <div className="space-y-2 pt-2 border-t border-amber-200 dark:border-amber-800">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-extrabold uppercase text-slate-700 dark:text-slate-200">
                    📋 Danh sách Chỉ tiêu Kiểm nghiệm in trên COA ({editingCoa.qc_results_snapshot.length} chỉ tiêu)
                  </span>
                  <Button
                    variant="ghost"
                    onClick={() =>
                      setEditingCoa({
                        ...editingCoa,
                        qc_results_snapshot: [
                          ...editingCoa.qc_results_snapshot,
                          {
                            seq: editingCoa.qc_results_snapshot.length + 1,
                            parameter_name: "Chỉ tiêu kiểm nghiệm mới",
                            method: "SOP-QC",
                            spec_limit: "Đạt chuẩn / Conforms",
                            observed_value: "Đạt / Pass",
                            passed: true,
                          },
                        ],
                      })
                    }
                  >
                    + Thêm dòng chỉ tiêu COA
                  </Button>
                </div>

                <Table head={["#", "Chỉ tiêu kiểm nghiệm (Parameter)", "Phương pháp thử (Method)", "Mức yêu cầu (Specification)", "Kết quả phân tích (Result)", "Đánh giá", ""]}>
                  {editingCoa.qc_results_snapshot.map((row: any, idx: number) => (
                    <tr key={idx}>
                      <td className="py-1.5 pr-2 font-mono text-xs w-10">{idx + 1}</td>
                      <td className="py-1.5 pr-2">
                        <input
                          className={inputClass}
                          value={row.parameter_name}
                          onChange={(e) => {
                            const next = [...editingCoa.qc_results_snapshot];
                            next[idx] = { ...next[idx], parameter_name: e.target.value };
                            setEditingCoa({ ...editingCoa, qc_results_snapshot: next });
                          }}
                        />
                      </td>
                      <td className="py-1.5 pr-2">
                        <input
                          className={inputClass}
                          value={row.method}
                          onChange={(e) => {
                            const next = [...editingCoa.qc_results_snapshot];
                            next[idx] = { ...next[idx], method: e.target.value };
                            setEditingCoa({ ...editingCoa, qc_results_snapshot: next });
                          }}
                        />
                      </td>
                      <td className="py-1.5 pr-2">
                        <input
                          className={inputClass}
                          value={row.spec_limit}
                          onChange={(e) => {
                            const next = [...editingCoa.qc_results_snapshot];
                            next[idx] = { ...next[idx], spec_limit: e.target.value };
                            setEditingCoa({ ...editingCoa, qc_results_snapshot: next });
                          }}
                        />
                      </td>
                      <td className="py-1.5 pr-2">
                        <input
                          className={inputClass}
                          value={row.observed_value}
                          onChange={(e) => {
                            const next = [...editingCoa.qc_results_snapshot];
                            next[idx] = { ...next[idx], observed_value: e.target.value };
                            setEditingCoa({ ...editingCoa, qc_results_snapshot: next });
                          }}
                        />
                      </td>
                      <td className="py-1.5 pr-2 w-28">
                        <select
                          className={inputClass}
                          value={row.passed ? "PASS" : "FAIL"}
                          onChange={(e) => {
                            const next = [...editingCoa.qc_results_snapshot];
                            next[idx] = { ...next[idx], passed: e.target.value === "PASS" };
                            setEditingCoa({ ...editingCoa, qc_results_snapshot: next });
                          }}
                        >
                          <option value="PASS">ĐẠT / PASS</option>
                          <option value="FAIL">KHÔNG ĐẠT</option>
                        </select>
                      </td>
                      <td className="py-1.5 text-right w-10">
                        <button
                          type="button"
                          className="text-rose-600 hover:text-rose-800 font-bold px-2 py-1 cursor-pointer"
                          title="Xóa dòng chỉ tiêu này"
                          onClick={() => {
                            const next = editingCoa.qc_results_snapshot.filter((_: any, i: number) => i !== idx);
                            setEditingCoa({ ...editingCoa, qc_results_snapshot: next });
                          }}
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))}
                </Table>
              </div>
            </form>
          )}

          <QcDocumentPreview kind="COA" data={selectedCoa} formsConfig={formsConfig} />
        </Card>
      )}
    </div>
  );
}

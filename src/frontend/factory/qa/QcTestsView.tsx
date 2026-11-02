"use client";

import React, { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ActionBar, type AllowedAction } from "../actions";
import { api, fmtDate, fmtQty, useFactoryMe } from "../api";
import { printKitCoaCertificate, printTestCoa } from "../coa";
import { Button, Card, Empty, ErrorNote, Field, inputClass, StatusBadge, Table } from "../ui";

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
  onClose,
}: {
  id: string;
  standards: any[];
  standardUsages: any[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const me = useFactoryMe();
  const test = useQuery({ queryKey: ["factory", "qc-test", id], queryFn: () => api<QcDetail>(`/api/factory/qms/tests/${id}`) });
  const [values, setValues] = useState<Record<string, string>>({});

  // Reference Standard usage form state
  const [stdId, setStdId] = useState("");
  const [stdMeasuredVal, setStdMeasuredVal] = useState("");
  const [stdNotes, setStdNotes] = useState("");
  const [retainQty, setRetainQty] = useState("2");
  const [releaseNotice, setReleaseNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!test.data) return;
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
        },
      }),
    onSuccess: (res) => {
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
        },
      }),
    onSuccess: (res) => {
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

  return (
    <Card title={t ? `Phiếu ${t.code} — ${t.spec_code} rev ${t.spec_version} (${t.test_kind})` : "Phiếu QC"} actions={<Button variant="ghost" onClick={onClose}>Đóng</Button>}>
      <ErrorNote error={test.error ?? save.error ?? recordStdMut.error ?? releaseLotMut.error ?? retest.error} />
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
            <div className="flex flex-wrap items-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
              <Button variant="ghost" onClick={() => printTestCoa(t.id).catch((e) => window.alert(e.message))}>
                🖨️ In phiếu kết quả &amp; COA (Bản QC)
              </Button>
              {["LOT", "PRODUCTION_ORDER"].includes(t.entity_type) && t.overall_result === "PASS" && (
                <>
                  {t.coa_code ? (
                    <div className="px-3 py-2 rounded-xl border border-sky-200 dark:border-sky-800 bg-sky-50/70 dark:bg-sky-950/30 text-xs font-semibold text-sky-900 dark:text-sky-200 flex items-center gap-2">
                      <span>📜 Đã cấp COA chính thức: <b className="font-mono">{t.coa_code}</b> (Đã ánh xạ sang Sản xuất Kit &amp; Kinh doanh)</span>
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
  const [status, setStatus] = useState("");
  const [queueFilter, setQueueFilter] = useState<"ALL" | "IQC" | "IPQC" | "FQC">("ALL");
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedCoa, setSelectedCoa] = useState<any | null>(null);
  const [showProactiveForm, setShowProactiveForm] = useState(false);
  const [proactiveLotId, setProactiveLotId] = useState("");
  const [proactiveKind, setProactiveKind] = useState<"IQC" | "IPQC" | "FQC" | "RELEASE" | "STABILITY">("IQC");
  const [proactiveSpecId, setProactiveSpecId] = useState("");

  // COA Template Config & COA Certificate Editor States
  const [showCoaTemplateConfig, setShowCoaTemplateConfig] = useState(false);
  const [tplForm, setTplForm] = useState<{
    company_name: string;
    document_title: string;
    iso_subtitle: string;
    address_line: string;
    footer_statement: string;
    approver_title: string;
    results_display_mode: "SUMMARY_TEMPLATE" | "CONFORMS_ONLY" | "DETAILED_QC";
    default_coa_parameters: {
      seq: number;
      parameter_name: string;
      method: string;
      spec_limit: string;
      observed_value: string;
      passed: boolean;
    }[];
    apply_to_existing_coas: boolean;
  }>({
    company_name: "CÔNG TY TNHH GIẢI PHÁP Y SINH ABT — ABT BIOLOGICAL SOLUTIONS CO., LTD",
    document_title: "GIẤY CHỨNG NHẬN PHÂN TÍCH / CERTIFICATE OF ANALYSIS (COA)",
    iso_subtitle: "Do Phòng QA/QC Cấp Phát (ISO 13485:2016 & GMP-IVD)",
    address_line: "Nhà máy & Phòng Lab QA/QC Đạt Chuẩn ISO 13485:2016",
    footer_statement: "Chứng nhận điện tử cấp bởi Phòng QA/QC tuân thủ 21 CFR Part 11 & ISO 13485",
    approver_title: "Phòng QA/QC Phê duyệt & Cấp COA / Approved by QA/QC:",
    results_display_mode: "SUMMARY_TEMPLATE",
    default_coa_parameters: [
      {
        seq: 1,
        parameter_name: "Ngoại quan & Quy cách đóng gói / Appearance & Packaging",
        method: "Kiểm tra ngoại quan (TCCS)",
        spec_limit: "Đồng nhất, nguyên vẹn, đúng quy cách / Conforms",
        observed_value: "Đạt tiêu chuẩn / Conforms",
        passed: true,
      },
      {
        seq: 2,
        parameter_name: "Độ tinh khiết & Tính toàn vẹn thành phần / Purity & Integrity",
        method: "Tiêu chuẩn cơ sở ABT (TCCS)",
        spec_limit: "Đạt giới hạn chất lượng công bố / Meets Spec",
        observed_value: "Đạt tiêu chuẩn / Conforms",
        passed: true,
      },
      {
        seq: 3,
        parameter_name: "Hoạt tính sinh học & Hiệu năng phản ứng / Functional Performance",
        method: "Thử nghiệm hoạt tính (SOP-QC)",
        spec_limit: "Đạt độ nhạy & độ đặc hiệu chuẩn / Conforms",
        observed_value: "Đạt tiêu chuẩn / Conforms",
        passed: true,
      },
      {
        seq: 4,
        parameter_name: "Kiểm tra độ sạch & Không nhiễm chéo / Contamination Check",
        method: "Kiểm nghiệm đối chứng âm (NTC)",
        spec_limit: "Không phát hiện tín hiệu nhiễm / Negative",
        observed_value: "Đạt tiêu chuẩn / Conforms",
        passed: true,
      },
    ],
    apply_to_existing_coas: true,
  });
  const [editingCoa, setEditingCoa] = useState<any | null>(null);
  const [coaNotice, setCoaNotice] = useState<string | null>(null);

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
    if (qaOps.data?.coa_template) {
      const t = qaOps.data.coa_template;
      setTplForm((prev) => ({
        company_name: t.company_name ?? prev.company_name,
        document_title: t.document_title ?? prev.document_title,
        iso_subtitle: t.iso_subtitle ?? prev.iso_subtitle,
        address_line: t.address_line ?? prev.address_line,
        footer_statement: t.footer_statement ?? prev.footer_statement,
        approver_title: t.approver_title ?? prev.approver_title,
        results_display_mode: t.results_display_mode ?? "SUMMARY_TEMPLATE",
        default_coa_parameters:
          Array.isArray(t.default_coa_parameters) && t.default_coa_parameters.length > 0
            ? t.default_coa_parameters
            : prev.default_coa_parameters,
        apply_to_existing_coas: true,
      }));
    }
  }, [qaOps.data?.coa_template]);

  const saveTplMut = useMutation({
    mutationFn: (payload: typeof tplForm) =>
      api<any>("/api/factory/qms/ops", {
        method: "POST",
        json: { op: "save_coa_template", ...payload },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["factory", "qa-ops"] });
      setShowCoaTemplateConfig(false);
      setCoaNotice("✅ Đã lưu cài đặt Biểu mẫu COA (áp dụng cho các COA cấp mới, giữ nguyên lịch sử COA đã phát hành)!");
    },
  });

  const updateCoaMut = useMutation({
    mutationFn: (payload: any) =>
      api<any>("/api/factory/qms/ops", {
        method: "POST",
        json: { op: "update_coa_certificate", ...payload },
      }),
    onSuccess: (updated) => {
      qc.invalidateQueries({ queryKey: ["factory", "qa-ops"] });
      setSelectedCoa(updated);
      setEditingCoa(null);
      setCoaNotice(`✅ Đã cập nhật thông tin & chỉ tiêu trên Giấy chứng nhận ${updated.code} (Phiên bản v${updated.revision_no ?? 1})!`);
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
    mutationFn: (payload: { lot_id: string; test_kind?: string; spec_id?: string | null }) =>
      api<{ test_id: string; test_code: string }>("/api/factory/qms/ops", {
        method: "POST",
        json: { op: "receive_lot_qc", ...payload },
      }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["factory", "qc-tests"] });
      qc.invalidateQueries({ queryKey: ["factory", "qa-ops"] });
      setShowProactiveForm(false);
      if (res?.test_id) setSelected(res.test_id);
    },
  });

  const queue: any[] = qaOps.data?.reception_queue ?? [];
  const allLots: any[] = qaOps.data?.all_lots ?? queue;
  const filteredQueue = queueFilter === "ALL" ? queue : queue.filter((q) => q.qc_category === queueFilter);

  return (
    <div className="flex flex-col gap-3">
      {selected && (
        <QcDetailPanel
          key={selected}
          id={selected}
          standards={qaOps.data?.standards ?? []}
          standardUsages={qaOps.data?.standard_usages ?? []}
          onClose={() => setSelected(null)}
        />
      )}

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
            <Button onClick={() => setShowProactiveForm(!showProactiveForm)}>+ Tạo Phiếu QC Chủ động</Button>
          </div>
        }
      >
        <ErrorNote error={qaOps.error ?? receiveLotMut.error} />

        {showProactiveForm && (
          <form
            className="grid gap-2 sm:grid-cols-5 items-end p-3 mb-3 rounded-xl border border-sky-200 dark:border-sky-900 bg-sky-50/40 dark:bg-sky-950/20"
            onSubmit={(e) => {
              e.preventDefault();
              receiveLotMut.mutate({
                lot_id: proactiveLotId,
                test_kind: proactiveKind,
                spec_id: proactiveSpecId || null,
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

        {filteredQueue.length === 0 ? (
          <Empty>Hiện không có lô hàng nào đang chờ lấy mẫu hoặc chờ QC trong hàng đợi này.</Empty>
        ) : (
          <Table head={["Phân loại QC", "Số Lô (Lot)", "Mã & Tên Vật tư / BTP / Thành phẩm", "Số lượng · Kho", "Hạn dùng", "Trạng thái Lô", "Phiếu QC hiện tại", "Thao tác tại QC"]}>
            {filteredQueue.map((q) => (
              <tr key={q.lot_id}>
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
                      onClick={() => setSelected(q.latest_test_id)}
                    >
                      {q.latest_test_code} ({QC_STATUS_LABEL[q.latest_test_status] ?? q.latest_test_status})
                    </button>
                  ) : (
                    <span className="text-slate-400 text-xs">Chưa lập phiếu</span>
                  )}
                </td>
                <td className="py-2 pr-3">
                  {q.latest_test_id ? (
                    <Button variant="ghost" onClick={() => setSelected(q.latest_test_id)}>
                      Mở phiếu QC
                    </Button>
                  ) : (
                    <Button
                      onClick={() => receiveLotMut.mutate({ lot_id: q.lot_id, test_kind: q.qc_category })}
                      disabled={receiveLotMut.isPending}
                    >
                      🧪 Tiếp nhận & Lập phiếu {q.qc_category}
                    </Button>
                  )}
                </td>
              </tr>
            ))}
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
        {list.data?.length === 0 && <Empty>Không có phiếu QC nào.</Empty>}
        {list.data && list.data.length > 0 && (
          <Table head={["Mã phiếu", "Đối tượng (Lô NVL / BTP / Thành phẩm / Oligo)", "Loại QC", "Tiêu chuẩn áp dụng", "Trạng thái", "Kết luận", "COA (Do QC cấp)"]}>
            {list.data.map((r) => (
              <tr key={r.id} className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50" onClick={() => setSelected(r.id)}>
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
                <td className="py-2 pr-3">{r.overall_result ? <StatusBadge status={r.overall_result === "PASS" ? "RELEASED" : "REJECTED"} label={r.overall_result === "PASS" ? "Đạt" : "Không đạt"} /> : "—"}</td>
                <td className="py-2 pr-3 font-mono text-xs">
                  {r.coa_code ? (
                    <span className="px-2 py-0.5 rounded-lg bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 font-bold">
                      📜 {r.coa_code}
                    </span>
                  ) : (
                    <span className="text-slate-400">—</span>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {/* Official COA Issuance Registry at QA/QC */}
      <Card
        title={`📜 Sổ Cấp Phát Giấy Chứng Nhận Phân Tích (COA) — Do Phòng QA/QC Cấp & Ánh Xạ Sang Sản Xuất / Kinh Doanh (${(qaOps.data?.issued_coas ?? []).length})`}
        actions={
          <Button variant="ghost" onClick={() => setShowCoaTemplateConfig((v) => !v)}>
            ⚙️ {showCoaTemplateConfig ? "Đóng Cài đặt Biểu mẫu COA" : "Cài đặt Biểu mẫu COA (Header / Footer / Tiêu đề)"}
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
            className="mb-4 p-4 rounded-xl border border-sky-300 dark:border-sky-800 bg-sky-50/40 dark:bg-sky-950/20 space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              saveTplMut.mutate(tplForm);
            }}
          >
            <div className="flex items-center justify-between border-b border-sky-200 dark:border-sky-800 pb-2">
              <div>
                <div className="text-xs font-extrabold uppercase text-sky-800 dark:text-sky-300">
                  ⚙️ Cài đặt Biểu mẫu Giấy Chứng Nhận Phân Tích (COA Template) — Áp dụng toàn hệ thống
                </div>
                <div className="text-[11px] text-slate-500">
                  Tùy chỉnh Quốc hiệu / Tên công ty, Tiêu đề song ngữ, Dòng chứng nhận ISO 13485, Địa chỉ Phòng Lab và Lời cam kết pháp lý ở chân trang COA.
                </div>
              </div>
              <div className="flex gap-2">
                <Button type="submit" disabled={saveTplMut.isPending}>
                  💾 Lưu Biểu mẫu COA
                </Button>
                <Button variant="ghost" onClick={() => setShowCoaTemplateConfig(false)}>
                  Hủy
                </Button>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="1. Tên Công ty / Đơn vị cấp phát trên Header (Song ngữ) *">
                <input
                  className={inputClass}
                  value={tplForm.company_name}
                  onChange={(e) => setTplForm({ ...tplForm, company_name: e.target.value })}
                  required
                />
              </Field>
              <Field label="2. Tiêu đề chính của Biểu mẫu COA *">
                <input
                  className={inputClass}
                  value={tplForm.document_title}
                  onChange={(e) => setTplForm({ ...tplForm, document_title: e.target.value })}
                  required
                />
              </Field>
              <Field label="3. Dòng tiêu chuẩn / Thẩm quyền cấp phát (Sub-header)">
                <input
                  className={inputClass}
                  value={tplForm.iso_subtitle}
                  onChange={(e) => setTplForm({ ...tplForm, iso_subtitle: e.target.value })}
                />
              </Field>
              <Field label="4. Địa chỉ Nhà máy / Phòng Lab QA/QC (In trên Header A4)">
                <input
                  className={inputClass}
                  value={tplForm.address_line}
                  onChange={(e) => setTplForm({ ...tplForm, address_line: e.target.value })}
                />
              </Field>
              <Field label="5. Dòng cam kết chữ ký điện tử ở Chân trang (Footer Statement)">
                <input
                  className={inputClass}
                  value={tplForm.footer_statement}
                  onChange={(e) => setTplForm({ ...tplForm, footer_statement: e.target.value })}
                />
              </Field>
              <Field label="6. Chức danh Người phê duyệt COA (Cột chữ ký phải)">
                <input
                  className={inputClass}
                  value={tplForm.approver_title}
                  onChange={(e) => setTplForm({ ...tplForm, approver_title: e.target.value })}
                />
              </Field>
            </div>

            {/* PHẦN II: CÀI ĐẶT CHẾ ĐỘ & CÁC CHỈ TIÊU HIỂN THỊ TRÊN COA */}
            <div className="pt-3 border-t border-sky-200 dark:border-sky-800 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-xs font-extrabold uppercase text-sky-800 dark:text-sky-300">
                    📋 II. Cài đặt Chế độ &amp; Danh sách Chỉ tiêu Hiển thị trên COA
                  </div>
                  <div className="text-[11px] text-slate-500">
                    Tùy chọn hiển thị các chỉ tiêu mang tính khái quát/chung chung trên bản COA gửi khách hàng (không lộ thông số kỹ thuật hay số đo nội bộ của phòng Lab).
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <Button
                    variant="ghost"
                    onClick={() =>
                      setTplForm({
                        ...tplForm,
                        results_display_mode: "SUMMARY_TEMPLATE",
                        default_coa_parameters: [
                          {
                            seq: 1,
                            parameter_name: "Ngoại quan & Quy cách đóng gói / Appearance & Packaging",
                            method: "Kiểm tra ngoại quan (TCCS)",
                            spec_limit: "Đồng nhất, nguyên vẹn, đúng quy cách / Conforms",
                            observed_value: "Đạt tiêu chuẩn / Conforms",
                            passed: true,
                          },
                          {
                            seq: 2,
                            parameter_name: "Độ tinh khiết & Tính toàn vẹn thành phần / Purity & Integrity",
                            method: "Tiêu chuẩn cơ sở ABT (TCCS)",
                            spec_limit: "Đạt giới hạn chất lượng công bố / Meets Spec",
                            observed_value: "Đạt tiêu chuẩn / Conforms",
                            passed: true,
                          },
                          {
                            seq: 3,
                            parameter_name: "Hoạt tính sinh học & Hiệu năng phản ứng / Functional Performance",
                            method: "Thử nghiệm hoạt tính (SOP-QC)",
                            spec_limit: "Đạt độ nhạy & độ đặc hiệu chuẩn / Conforms",
                            observed_value: "Đạt tiêu chuẩn / Conforms",
                            passed: true,
                          },
                          {
                            seq: 4,
                            parameter_name: "Kiểm tra độ sạch & Không nhiễm chéo / Contamination Check",
                            method: "Kiểm nghiệm đối chứng âm (NTC)",
                            spec_limit: "Không phát hiện tín hiệu nhiễm / Negative",
                            observed_value: "Đạt tiêu chuẩn / Conforms",
                            passed: true,
                          },
                        ],
                      })
                    }
                  >
                    📋 Nạp Mẫu COA Tổng quát (4 chỉ tiêu chung)
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() =>
                      setTplForm({
                        ...tplForm,
                        results_display_mode: "SUMMARY_TEMPLATE",
                        default_coa_parameters: [
                          {
                            seq: 1,
                            parameter_name: "Cảm quan dung dịch & Bao bì / Appearance",
                            method: "Kiểm tra cảm quan (TCCS)",
                            spec_limit: "Dung dịch trong suốt, đồng nhất / Clear & homogeneous",
                            observed_value: "Đạt tiêu chuẩn / Conforms",
                            passed: true,
                          },
                          {
                            seq: 2,
                            parameter_name: "Chỉ tiêu Hóa lý & Độ ổn định pH / Physicochemical Spec",
                            method: "Tiêu chuẩn cơ sở ABT (TCCS)",
                            spec_limit: "Nằm trong dải tiêu chuẩn nhà sản xuất / Within Spec",
                            observed_value: "Đạt tiêu chuẩn / Conforms",
                            passed: true,
                          },
                          {
                            seq: 3,
                            parameter_name: "Hoạt tính khuếch đại trên mẫu chuẩn / Functional Assay",
                            method: "Real-time qPCR (SOP-QC)",
                            spec_limit: "Đạt hiệu năng khuếch đại & không nhiễm âm / Conforms",
                            observed_value: "Đạt tiêu chuẩn / Conforms",
                            passed: true,
                          },
                        ],
                      })
                    }
                  >
                    🧪 Nạp Mẫu COA Bán thành phẩm / Hóa chất (3 chỉ tiêu chung)
                  </Button>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 items-end">
                <Field label="7. Chế độ hiển thị Bảng chỉ tiêu trên COA *">
                  <select
                    className={inputClass}
                    value={tplForm.results_display_mode}
                    onChange={(e) => setTplForm({ ...tplForm, results_display_mode: e.target.value as any })}
                  >
                    <option value="SUMMARY_TEMPLATE">
                      1. Nêu chung theo Bộ chỉ tiêu chuẩn của Biểu mẫu COA bên dưới (Ẩn chỉ tiêu &amp; số đo chi tiết nội bộ)
                    </option>
                    <option value="CONFORMS_ONLY">
                      2. Lấy tên chỉ tiêu từ Phiếu QC nhưng chỉ ghi chung &quot;Đạt tiêu chuẩn / Conforms&quot; (Ẩn số đo pH, Ct...)
                    </option>
                    <option value="DETAILED_QC">
                      3. Hiển thị chi tiết từng chỉ tiêu &amp; số đo thực tế từ Phiếu QC
                    </option>
                  </select>
                </Field>
                <div className="pb-1.5">
                  <label className="flex items-center gap-2 text-xs font-semibold text-sky-900 dark:text-sky-200 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={tplForm.apply_to_existing_coas}
                      onChange={(e) => setTplForm({ ...tplForm, apply_to_existing_coas: e.target.checked })}
                    />
                    ⚡ Cập nhật áp dụng luôn bộ chỉ tiêu hiển thị này cho tất cả COA đã cấp trong sổ
                  </label>
                </div>
              </div>

              {tplForm.results_display_mode === "SUMMARY_TEMPLATE" && (
                <div className="space-y-2 bg-white dark:bg-slate-900 p-3 rounded-xl border border-slate-200 dark:border-slate-800">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-700 dark:text-slate-200">
                      Danh sách các Chỉ tiêu Chung hiển thị trên Biểu mẫu COA ({tplForm.default_coa_parameters.length} dòng):
                    </span>
                    <Button
                      variant="ghost"
                      onClick={() =>
                        setTplForm({
                          ...tplForm,
                          default_coa_parameters: [
                            ...tplForm.default_coa_parameters,
                            {
                              seq: tplForm.default_coa_parameters.length + 1,
                              parameter_name: "Chỉ tiêu chất lượng chung",
                              method: "Tiêu chuẩn cơ sở (TCCS)",
                              spec_limit: "Đạt tiêu chuẩn nhà sản xuất / Conforms",
                              observed_value: "Đạt tiêu chuẩn / Conforms",
                              passed: true,
                            },
                          ],
                        })
                      }
                    >
                      + Thêm dòng chỉ tiêu hiển thị trên COA
                    </Button>
                  </div>

                  <Table head={["#", "Tên chỉ tiêu hiển thị trên COA (Song ngữ / Chung)", "Phương pháp / Tham chiếu", "Mức yêu cầu hiển thị chung", "Kết quả hiển thị trên COA", "Kết luận", ""]}>
                    {tplForm.default_coa_parameters.map((row, idx) => (
                      <tr key={idx}>
                        <td className="py-1.5 pr-2 font-mono text-xs w-8">{idx + 1}</td>
                        <td className="py-1.5 pr-2">
                          <input
                            className={inputClass}
                            value={row.parameter_name}
                            onChange={(e) => {
                              const next = [...tplForm.default_coa_parameters];
                              next[idx] = { ...next[idx], parameter_name: e.target.value };
                              setTplForm({ ...tplForm, default_coa_parameters: next });
                            }}
                          />
                        </td>
                        <td className="py-1.5 pr-2">
                          <input
                            className={inputClass}
                            value={row.method}
                            onChange={(e) => {
                              const next = [...tplForm.default_coa_parameters];
                              next[idx] = { ...next[idx], method: e.target.value };
                              setTplForm({ ...tplForm, default_coa_parameters: next });
                            }}
                          />
                        </td>
                        <td className="py-1.5 pr-2">
                          <input
                            className={inputClass}
                            value={row.spec_limit}
                            onChange={(e) => {
                              const next = [...tplForm.default_coa_parameters];
                              next[idx] = { ...next[idx], spec_limit: e.target.value };
                              setTplForm({ ...tplForm, default_coa_parameters: next });
                            }}
                          />
                        </td>
                        <td className="py-1.5 pr-2">
                          <input
                            className={inputClass}
                            value={row.observed_value}
                            onChange={(e) => {
                              const next = [...tplForm.default_coa_parameters];
                              next[idx] = { ...next[idx], observed_value: e.target.value };
                              setTplForm({ ...tplForm, default_coa_parameters: next });
                            }}
                          />
                        </td>
                        <td className="py-1.5 pr-2 w-28">
                          <select
                            className={inputClass}
                            value={row.passed ? "PASS" : "FAIL"}
                            onChange={(e) => {
                              const next = [...tplForm.default_coa_parameters];
                              next[idx] = { ...next[idx], passed: e.target.value === "PASS" };
                              setTplForm({ ...tplForm, default_coa_parameters: next });
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
                            title="Xóa dòng chỉ tiêu này"
                            onClick={() => {
                              const next = tplForm.default_coa_parameters.filter((_, i) => i !== idx);
                              setTplForm({ ...tplForm, default_coa_parameters: next });
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
          </form>
        )}

        {(qaOps.data?.issued_coas ?? []).length === 0 ? (
          <Empty>Chưa có COA nào được cấp phát. Duyệt đạt Phiếu QC để cấp COA và tự động ánh xạ sang Phòng Sản xuất Kit &amp; Kinh doanh.</Empty>
        ) : (
          <Table head={["Số COA (Do QC cấp)", "Phiếu QC gốc", "Mã Lô & Sản phẩm", "NSX → HSD", "Quy cách / SL Đạt", "Người kiểm nghiệm & Người ký duyệt COA", "Trạng thái Ánh xạ", "Thao tác"]}>
            {(qaOps.data?.issued_coas ?? []).map((c: any) => (
              <tr key={c.id}>
                <td className="py-2 pr-3 font-mono text-xs font-bold text-emerald-700 dark:text-emerald-400">{c.code}</td>
                <td className="py-2 pr-3 font-mono text-xs">
                  {c.qc_test_code ? (
                    <button
                      type="button"
                      className="text-sky-700 dark:text-sky-400 underline font-semibold cursor-pointer"
                      onClick={() => c.qc_test_id && setSelected(c.qc_test_id)}
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
                  <StatusBadge status="RELEASED" label={c.order_code ? `Đã ánh xạ → ${c.order_code}` : "Đã ánh xạ sang SX & KD"} />
                </td>
                <td className="py-2 pr-3 text-xs whitespace-nowrap">
                  <div className="inline-flex items-center gap-1">
                    <button
                      type="button"
                      title="Xem & In COA Song ngữ"
                      className="px-2 py-1 rounded-lg text-[11px] font-medium border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                      onClick={() => {
                        setEditingCoa(null);
                        setSelectedCoa(c);
                      }}
                    >
                      📄 Xem/In
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
                        title="In Phiếu Kết quả QC gốc"
                        className="px-2 py-1 rounded-lg text-[11px] font-medium border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                        onClick={() => printTestCoa(c.qc_test_id).catch((e) => window.alert(e.message))}
                      >
                        🖨️ Phiếu KQ
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {selectedCoa && (
        <Card
          title={`Bản in Chứng nhận Phân tích Song ngữ — CERTIFICATE OF ANALYSIS (${selectedCoa.code} · Cấp bởi Phòng QA/QC)`}
          actions={
            <div className="flex flex-wrap gap-2">
              <Button variant="ghost" onClick={() => (editingCoa ? setEditingCoa(null) : startEditingCoa(selectedCoa))}>
                {editingCoa ? "👁️ Xem trước Bản in COA" : "✏️ Chỉnh sửa thông tin & chỉ tiêu COA"}
              </Button>
              <Button onClick={() => printKitCoaCertificate(selectedCoa, tplForm)}>🖨️ In COA (Print / PDF)</Button>
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
                    ✏️ Chỉnh sửa Thông tin &amp; Bảng Chỉ tiêu trên COA ({editingCoa.code})
                  </div>
                  <div className="text-[11px] text-slate-500">
                    Mọi thay đổi sẽ được cập nhật trực tiếp lên bản in COA và tự động đồng bộ sang tab Sản xuất Kit &amp; Kinh doanh.
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button type="submit" disabled={updateCoaMut.isPending}>
                    💾 Lưu cập nhật COA
                  </Button>
                  <Button variant="ghost" onClick={() => setEditingCoa(null)}>
                    Hủy sửa
                  </Button>
                </div>
              </div>

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
                    className={inputClass}
                    value={editingCoa.analyst_name}
                    onChange={(e) => setEditingCoa({ ...editingCoa, analyst_name: e.target.value })}
                  />
                </Field>
                <Field label="Người ký duyệt COA (QA/QC) *">
                  <input
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
                <Field label="Ghi chú bổ sung trên COA">
                  <input
                    className={inputClass}
                    value={editingCoa.custom_notes}
                    onChange={(e) => setEditingCoa({ ...editingCoa, custom_notes: e.target.value })}
                    placeholder="Ghi chú điều kiện bảo quản / vận chuyển..."
                  />
                </Field>
                <div className="sm:col-span-4">
                  <Field label="Lý do cập nhật phiên bản COA (Audit Trail — 21 CFR Part 11) *">
                    <input
                      className={inputClass}
                      value={editingCoa.reason ?? ""}
                      onChange={(e) => setEditingCoa({ ...editingCoa, reason: e.target.value })}
                      placeholder="Nhập lý do hiệu chỉnh phiên bản COA..."
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

          <div className="p-6 border-2 border-stone-800 rounded-xl bg-white text-stone-900 space-y-4">
            <div className="text-center border-b-2 border-stone-800 pb-3">
              <div className="text-xs font-bold tracking-widest text-sky-900">
                {tplForm.company_name}
              </div>
              {tplForm.address_line && (
                <div className="text-[11px] text-stone-600">{tplForm.address_line}</div>
              )}
              <div className="text-lg font-extrabold uppercase mt-1">
                {tplForm.document_title}
              </div>
              <div className="text-xs font-mono text-stone-600">
                Số chứng nhận / Certificate No.: <strong>{selectedCoa.code}</strong>
                {selectedCoa.revision_no ? <> · Phiên bản / Rev: <strong>v{selectedCoa.revision_no}</strong></> : null}
                {selectedCoa.qc_test_code ? <> · Phiếu QC gốc / QC Test Ref: <strong>{selectedCoa.qc_test_code}</strong></> : null}
                {tplForm.iso_subtitle ? <> · {tplForm.iso_subtitle}</> : null}
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-xs bg-stone-50 p-3 rounded-lg border border-stone-200">
              <div>
                <div className="text-stone-500">Tên sản phẩm / Product Name:</div>
                <div className="font-bold">{selectedCoa.product_name}</div>
              </div>
              <div>
                <div className="text-stone-500">Mã sản phẩm / Catalog No. (REF):</div>
                <div className="font-mono font-bold">{selectedCoa.product_code}</div>
              </div>
              <div>
                <div className="text-stone-500">Số lô / Lot Number (LOT):</div>
                <div className="font-mono font-bold text-sky-800">{selectedCoa.lot_code}</div>
              </div>
              <div>
                <div className="text-stone-500">Ngày sản xuất / Manufacturing Date:</div>
                <div className="font-semibold">{fmtDate(selectedCoa.mfg_date)}</div>
              </div>
              <div>
                <div className="text-stone-500">Hạn sử dụng / Expiry Date:</div>
                <div className="font-semibold">{fmtDate(selectedCoa.expiry_date)}</div>
              </div>
              <div>
                <div className="text-stone-500">Quy cách &amp; Tiêu chuẩn áp dụng / Spec:</div>
                <div className="font-semibold">
                  {Number(selectedCoa.tests_per_kit) > 0
                    ? `${selectedCoa.tests_per_kit} tests (${fmtQty(selectedCoa.good_qty)} ${selectedCoa.uom})`
                    : `${fmtQty(selectedCoa.good_qty)} ${selectedCoa.uom}`}
                  {selectedCoa.spec_code ? ` · ${selectedCoa.spec_code}` : ""}
                </div>
              </div>
            </div>

            <div className="space-y-1">
              <div className="text-xs font-bold uppercase text-stone-700">
                Kết quả kiểm nghiệm chất lượng (Do Phòng QA/QC Thực hiện) / Quality Control Analytical Results
              </div>
              <Table head={["#", "Chỉ tiêu kiểm nghiệm / Parameter", "Phương pháp thử / Method", "Mức yêu cầu / Specification", "Kết quả phân tích / Result", "Đánh giá / Conclusion"]}>
                {(Array.isArray(selectedCoa.qc_results_snapshot) && selectedCoa.qc_results_snapshot.length > 0) ? (
                  selectedCoa.qc_results_snapshot.map((st: any, idx: number) => (
                    <tr key={idx}>
                      <td className="px-3 py-1.5 text-xs font-mono">{st.seq ?? idx + 1}</td>
                      <td className="px-3 py-1.5 text-xs font-semibold">
                        {st.parameter_name ?? `${st.step_code ?? ""} ${st.step_name ?? ""}`}
                      </td>
                      <td className="px-3 py-1.5 text-xs">{st.method ?? "SOP-QC"}</td>
                      <td className="px-3 py-1.5 text-xs font-mono">{st.spec_limit ?? "Đạt chuẩn / Conforms"}</td>
                      <td className="px-3 py-1.5 text-xs font-mono font-semibold">
                        {st.observed_value ??
                          (st.param_values && Object.keys(st.param_values).length > 0
                            ? Object.entries(st.param_values)
                                .map(([k, v]) => `${k}: ${v}`)
                                .join(" · ")
                            : "—")}
                      </td>
                      <td className="px-3 py-1.5 text-xs font-bold text-emerald-700">
                        {st.passed === true ? "ĐẠT / PASS" : st.passed === false ? "KHÔNG ĐẠT / FAIL" : "CHƯA ĐÁNH GIÁ"}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={6} className="px-3 py-2 text-xs text-center text-stone-500">
                      Chưa có dữ liệu kiểm nghiệm QC được phê duyệt
                    </td>
                  </tr>
                )}
              </Table>
            </div>

            {selectedCoa.custom_notes && (
              <div className="text-xs text-stone-700 bg-stone-50 p-2.5 rounded border border-stone-200">
                <strong>Ghi chú / Remarks:</strong> {selectedCoa.custom_notes}
              </div>
            )}

            <div className="flex items-center justify-between pt-3 border-t border-stone-300 text-xs">
              <div>
                <div>
                  Kết luận xuất xưởng / Final Disposition: <strong className="text-emerald-700">{selectedCoa.qc_summary}</strong>
                </div>
                {selectedCoa.analyst_name && (
                  <div className="text-stone-600">Chuyên viên kiểm nghiệm / QC Analyst: <strong>{selectedCoa.analyst_name}</strong></div>
                )}
                <div className="text-stone-500">{tplForm.footer_statement}</div>
              </div>
              <div className="text-right">
                <div className="font-bold">{tplForm.approver_title}</div>
                <div className="font-mono text-sky-900 font-semibold">{selectedCoa.issued_by_name}</div>
              </div>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}

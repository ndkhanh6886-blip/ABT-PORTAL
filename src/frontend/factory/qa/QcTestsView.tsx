"use client";

import React, { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ActionBar, type AllowedAction } from "../actions";
import { api, fmtDate, fmtQty, useFactoryMe } from "../api";
import { printTestCoa } from "../coa";
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

  const releaseLotMut = useMutation({
    mutationFn: () =>
      api<{ lot_code: string; putaway_executed: boolean; retention_code: string | null }>("/api/factory/qms/ops", {
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
        `✅ Đã giải phóng lô ${res.lot_code} (RELEASED)${res.putaway_executed ? ", tự động chuyển hàng từ khu Biệt trữ sang kệ Chính thức" : ""}${
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
  const editable = t?.status === "IN_PROGRESS" && (t.analyst_id === me.data?.profile.user_id || me.data?.permissions.includes("qms.qc.lead"));
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
                🖨️ In phiếu kết quả (COA)
              </Button>
              {t.entity_type === "LOT" && t.overall_result === "PASS" && (
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
                    ✅ Giải phóng Lô ngay tại QC & Chuyển kệ chính
                  </Button>
                </div>
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
  const [showProactiveForm, setShowProactiveForm] = useState(false);
  const [proactiveLotId, setProactiveLotId] = useState("");
  const [proactiveKind, setProactiveKind] = useState<"IQC" | "IPQC" | "FQC" | "RELEASE" | "STABILITY">("IQC");

  const list = useQuery({
    queryKey: ["factory", "qc-tests", status],
    queryFn: () => api<QcRow[]>(`/api/factory/qms/tests${status ? `?status=${status}` : ""}`),
  });
  const qaOps = useQuery({
    queryKey: ["factory", "qa-ops"],
    queryFn: () => api<any>("/api/factory/qms/ops"),
  });

  const receiveLotMut = useMutation({
    mutationFn: (payload: { lot_id: string; test_kind?: string }) =>
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
            className="grid gap-2 sm:grid-cols-4 items-end p-3 mb-3 rounded-xl border border-sky-200 dark:border-sky-900 bg-sky-50/40 dark:bg-sky-950/20"
            onSubmit={(e) => {
              e.preventDefault();
              receiveLotMut.mutate({ lot_id: proactiveLotId, test_kind: proactiveKind });
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
          <Table head={["Mã phiếu", "Đối tượng (Lô NVL / BTP / Thành phẩm / Oligo)", "Loại QC", "Tiêu chuẩn áp dụng", "Trạng thái", "Kết luận"]}>
            {list.data.map((r) => (
              <tr key={r.id} className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50" onClick={() => setSelected(r.id)}>
                <td className="py-2 pr-3 font-mono font-semibold text-sky-700 dark:text-sky-400">{r.code}</td>
                <td className="py-2 pr-3">{r.lot_code ? `Lô ${r.lot_code} · ${r.item_code} ${r.item_name}` : r.sequence_code ? `Oligo ${r.sequence_code} · ${r.sequence_name}` : "—"}</td>
                <td className="py-2 pr-3 font-mono font-semibold">{r.test_kind}</td>
                <td className="py-2 pr-3 font-mono">{r.spec_code}</td>
                <td className="py-2 pr-3 whitespace-nowrap">{QC_STATUS_LABEL[r.status]}</td>
                <td className="py-2 pr-3">{r.overall_result ? <StatusBadge status={r.overall_result === "PASS" ? "RELEASED" : "REJECTED"} label={r.overall_result === "PASS" ? "Đạt" : "Không đạt"} /> : "—"}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}

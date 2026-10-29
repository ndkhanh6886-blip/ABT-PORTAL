"use client";

import React, { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ActionBar, type AllowedAction } from "../actions";
import { api, useFactoryMe } from "../api";
import { Button, Card, Empty, ErrorNote, inputClass, StatusBadge, Table } from "../ui";

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
const ACTION_LABEL: Record<string, string> = { start: "Bắt đầu kiểm nghiệm", submit_results: "Gửi kết quả", review: "Duyệt kết quả", return: "Trả lại", cancel: "Hủy phiếu" };

const DERIVED_HINT: Record<string, string> = { OD_TOTAL: "tổng OD", YIELD_NMOL: "nmol", YIELD_UG: "µg" };
/** Values the server takes from the post-synthesis record: nothing to type. */
const fromSubject = (p: Parameter) => p.derived_metric != null && p.derived_metric !== "MW_DELTA_DA";

/** Reference data of an Oligo sequence under test (theoretical values and the post-synthesis measurement). */
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

function QcDetailPanel({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();
  const me = useFactoryMe();
  const test = useQuery({ queryKey: ["factory", "qc-test", id], queryFn: () => api<QcDetail>(`/api/factory/qms/tests/${id}`) });
  const [values, setValues] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!test.data) return;
    setValues(
      Object.fromEntries(
        test.data.results.map((r) => [r.parameter_id, r.observed_numeric != null ? String(Number(r.observed_numeric)) : r.value_numeric != null ? String(Number(r.value_numeric)) : r.value_text ?? ""])
      )
    );
  }, [test.data]);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["factory", "qc-test", id] });
    qc.invalidateQueries({ queryKey: ["factory", "qc-tests"] });
    qc.invalidateQueries({ queryKey: ["factory", "lot"] });
  };
  const save = useMutation({
    mutationFn: () =>
      api(`/api/factory/qms/tests/${id}/results`, {
        method: "PUT",
        json: {
          results: test.data!.parameters
            .filter((p) => fromSubject(p) || (values[p.id] ?? "") !== "")
            .map((p) => fromSubject(p) ? { parameter_id: p.id } :  (p.value_type === "NUMERIC" ? { parameter_id: p.id, value_numeric: Number(values[p.id].replace(",", ".")) } : { parameter_id: p.id, value_text: values[p.id] })),
        },
      }),
    onSuccess: refresh,
  });
  const retest = useMutation({
    mutationFn: (reason: string) => api(`/api/factory/qms/tests/${id}/retest`, { method: "POST", idempotent: true, json: { reason } }),
    onSuccess: refresh,
  });
  const t = test.data;
  const editable = t?.status === "IN_PROGRESS" && t.analyst_id === me.data?.profile.user_id;
  const result = (pid: string) => t?.results.find((r) => r.parameter_id === pid);

  return (
    <Card title={t ? `Phiếu ${t.code} — ${t.spec_code} rev ${t.spec_version}` : "Phiếu QC"} actions={<Button variant="ghost" onClick={onClose}>Đóng</Button>}>
      <ErrorNote error={test.error} />
      {t && (
        <div className="flex flex-col gap-3">
          <p className="text-xs text-slate-600 dark:text-slate-300">
            {t.lot_code ? `Lô ${t.lot_code} — ${t.item_code} ${t.item_name}` : t.subject?.label ?? t.spec_name} · {QC_STATUS_LABEL[t.status]} · Kiểm nghiệm: {t.analyst_name ?? "—"} · Duyệt: {t.reviewer_name ?? "—"}
            {t.retest_reason && <> · Kiểm lại vì: {t.retest_reason}</>}
          </p>
          {t.subject?.reference && <OligoReference r={t.subject.reference} />}
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
                      r.value_numeric != null ? `${Number(r.value_numeric)} ${p.unit ?? ""}${r.observed_numeric != null ? ` (đo ${Number(r.observed_numeric)})` : ""}` : r.value_text === "PASS" ? "Đạt" : r.value_text === "FAIL" ? "Không đạt" : r.value_text
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
          <ErrorNote error={save.error ?? retest.error} />
          {t.overall_result && <p className="text-sm font-bold">Kết luận: <StatusBadge status={t.overall_result === "PASS" ? "RELEASED" : "REJECTED"} label={t.overall_result === "PASS" ? "ĐẠT" : "KHÔNG ĐẠT"} /></p>}
          <ActionBar endpoint={`/api/factory/qms/tests/${t.id}/actions`} version={t.version} actions={t.actions} labels={ACTION_LABEL} onDone={refresh} />
          {t.status === "REVIEWED" && me.data?.permissions.includes("qms.qc.lead") && (
            <div>
              <Button variant="ghost" onClick={() => { const r = window.prompt("Lý do kiểm lại:"); if (r) retest.mutate(r); }}>Tạo phiếu kiểm lại</Button>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

export function QcTestsView() {
  const [status, setStatus] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const list = useQuery({ queryKey: ["factory", "qc-tests", status], queryFn: () => api<QcRow[]>(`/api/factory/qms/tests${status ? `?status=${status}` : ""}`) });

  return (
    <div className="flex flex-col gap-3">
      {selected && <QcDetailPanel key={selected} id={selected} onClose={() => setSelected(null)} />}
      <Card
        title="Phiếu QC"
        actions={
          <select className={`${inputClass} w-52`} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Lọc trạng thái">
            <option value="">Đang mở (cần xử lý)</option>
            <option value="REVIEWED">Đã duyệt</option>
            <option value="CANCELLED">Đã hủy</option>
          </select>
        }
      >
        <ErrorNote error={list.error} />
        {list.data?.length === 0 && <Empty>Không có phiếu QC nào.</Empty>}
        {list.data && list.data.length > 0 && (
          <Table head={["Mã phiếu", "Đối tượng", "Loại", "Tiêu chuẩn", "Trạng thái", "Kết quả"]}>
            {list.data.map((r) => (
              <tr key={r.id} className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50" onClick={() => setSelected(r.id)}>
                <td className="py-2 pr-3 font-mono font-semibold text-sky-700 dark:text-sky-400">{r.code}</td>
                <td className="py-2 pr-3">{r.lot_code ? `${r.lot_code} · ${r.item_code} ${r.item_name}` : r.sequence_code ? `Oligo ${r.sequence_code} · ${r.sequence_name}` : "—"}</td>
                <td className="py-2 pr-3">{r.test_kind}</td>
                <td className="py-2 pr-3">{r.spec_code}</td>
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

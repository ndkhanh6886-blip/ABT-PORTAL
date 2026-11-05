"use client";

import React, { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ActionBar, type AllowedAction } from "../actions";
import { api, fmtDate, fmtDateTime } from "../api";
import { Button, Card, Empty, ErrorNote, Field, inputClass, Table } from "../ui";

interface Requirement {
  id: string;
  req_code: string;
  title: string;
  description: string | null;
  kind: string;
  status: "ACTIVE" | "OBSOLETE";
  test_codes: string[];
}
interface TestCase {
  id: string;
  tc_code: string;
  title: string;
  level: string;
  steps: string | null;
  expected: string;
  status: "ACTIVE" | "OBSOLETE";
  requirement_ids: string[];
  last_run: { version_tag: string; result: string; executed_at: string; executed_by_name: string | null } | null;
}
interface Problem {
  id: string;
  code: string;
  title: string;
  description: string;
  severity: string;
  source: string;
  status: string;
  found_in_version: string | null;
  fixed_in_version: string | null;
  root_cause: string | null;
  fix_summary: string | null;
  service_ticket_code: string | null;
  eco_id: string | null;
  eco_code: string | null;
  version: number;
  actions: AllowedAction[];
}
interface Lifecycle {
  can_manage: boolean;
  requirements: Requirement[];
  tests: TestCase[];
  versions: string[];
  version: string | null;
  traceability: { req_id: string; title: string; test_case_id: string; result: string }[] | null;
  problems: Problem[];
  service_tickets: { id: string; code: string; serial_no: string; symptom: string }[];
  ecos: { id: string; code: string; title: string; status: string }[];
}
interface Validation {
  id: string;
  code: string;
  system_name: string;
  system_version: string;
  gamp_category: string;
  gxp_impact: boolean;
  intended_use: string;
  risk_level: string;
  iq_summary: string | null;
  oq_summary: string | null;
  pq_summary: string | null;
  status: string;
  approved_by_name: string | null;
  approved_at: string | null;
  version: number;
  actions: AllowedAction[];
}

const KIND_LABEL: Record<string, string> = {
  FUNCTIONAL: "Chức năng",
  PERFORMANCE: "Hiệu năng",
  SAFETY: "An toàn",
  SECURITY: "Bảo mật",
  USABILITY: "Khả dụng",
  INTERFACE: "Giao tiếp",
  REGULATORY: "Pháp quy",
};
const SEVERITY_LABEL: Record<string, string> = { LOW: "Thấp", MEDIUM: "Trung bình", HIGH: "Cao", CRITICAL: "Nghiêm trọng" };
const PROBLEM_STATUS: Record<string, string> = { OPEN: "Mới", INVESTIGATING: "Đang điều tra", FIXED: "Đã sửa — chờ xác nhận", VERIFIED: "Đã xác nhận", REJECTED: "Từ chối" };
const VALIDATION_STATUS: Record<string, string> = { DRAFT: "Lập URS", IQ_DONE: "Xong IQ", OQ_DONE: "Xong OQ", PQ_DONE: "Xong PQ — chờ duyệt", IN_USE: "Được sử dụng", RETIRED: "Ngừng sử dụng" };
const PROBLEM_ACTIONS = { investigate: "Điều tra", fix: "Đã sửa", verify: "Xác nhận đã sửa", reopen: "Sửa chưa đạt — mở lại", reject: "Từ chối" };
const VALIDATION_ACTIONS = { complete_iq: "Hoàn tất IQ", complete_oq: "Hoàn tất OQ", complete_pq: "Hoàn tất PQ", approve_use: "Phê duyệt đưa vào sử dụng", retire: "Ngừng sử dụng" };
const resultTone = (r?: string | null) =>
  r === "PASS" ? "text-emerald-700 dark:text-emerald-400" : r === "FAIL" || r === "BLOCKED" ? "text-rose-600" : "text-amber-600";

/**
 * KTCN software lifecycle (IEC 62304): requirements, test cases and runs per build, the traceability matrix a release
 * will carry, problem reports (linked to service tickets / ECOs); and validation of in-house GMP software (GAMP 5).
 */
export function SoftwareLifecycleView() {
  const qc = useQueryClient();
  const projects = useQuery({ queryKey: ["factory", "rd", "projects", "SOFTWARE"], queryFn: () => api<any[]>("/api/factory/rd/projects?domain=SOFTWARE") });
  const [projectId, setProjectId] = useState("");
  const [version, setVersion] = useState("");
  const [tab, setTab] = useState<"req" | "test" | "trace" | "problem">("req");
  useEffect(() => {
    if (!projectId && projects.data?.[0]) setProjectId(projects.data[0].id);
  }, [projects.data, projectId]);

  const lc = useQuery({
    queryKey: ["factory", "rd", "software", projectId, version],
    queryFn: () => api<Lifecycle>(`/api/factory/rd/software/${projectId}${version ? `?version=${encodeURIComponent(version)}` : ""}`),
    enabled: Boolean(projectId),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["factory", "rd", "software"] });
  const op = useMutation({
    mutationFn: (body: Record<string, unknown>) => api("/api/factory/rd/software", { method: "POST", json: body }),
    onSuccess: refresh,
  });
  const d = lc.data;
  const canManage = Boolean(d?.can_manage);

  return (
    <div className="flex flex-col gap-3">
      <Card
        title="Vòng đời phát triển phần mềm (IEC 62304)"
        actions={
          <div className="flex flex-wrap gap-2">
            <select className={`${inputClass} !w-72`} value={projectId} onChange={(e) => { setProjectId(e.target.value); setVersion(""); }} aria-label="Dự án phần mềm">
              {(projects.data ?? []).map((p) => (
                <option key={p.id} value={p.id}>{p.code} — {p.name}</option>
              ))}
            </select>
            <select className={`${inputClass} !w-36`} value={version || d?.version || ""} onChange={(e) => setVersion(e.target.value)} aria-label="Phiên bản">
              {!d?.versions.length && <option value="">Chưa có bản dựng</option>}
              {(d?.versions ?? []).map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>
        }
      >
        {projects.data?.length === 0 && <Empty>Chưa có dự án phần mềm. Tạo dự án ở phần “Dự án phần mềm” bên dưới.</Empty>}
        <ErrorNote error={projects.error ?? lc.error ?? op.error} />
        {d && (
          <>
            <div className="flex flex-wrap gap-1.5 mb-3">
              {([
                ["req", `Yêu cầu SRS (${d.requirements.filter((r) => r.status === "ACTIVE").length})`],
                ["test", `Ca kiểm thử & lần chạy (${d.tests.filter((t) => t.status === "ACTIVE").length})`],
                ["trace", "Ma trận truy vết"],
                ["problem", `Báo lỗi (${d.problems.filter((p) => !["VERIFIED", "REJECTED"].includes(p.status)).length} mở)`],
              ] as const).map(([k, label]) => (
                <button
                  key={k}
                  onClick={() => setTab(k)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold cursor-pointer ${tab === k ? "bg-sky-700 text-white" : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300"}`}
                >
                  {label}
                </button>
              ))}
            </div>
            {tab === "req" && <RequirementsPanel d={d} projectId={projectId} canManage={canManage} save={op.mutate} busy={op.isPending} />}
            {tab === "test" && <TestsPanel d={d} projectId={projectId} canManage={canManage} save={op.mutate} busy={op.isPending} />}
            {tab === "trace" && <TracePanel d={d} />}
            {tab === "problem" && <ProblemsPanel d={d} projectId={projectId} canManage={canManage} save={op.mutate} busy={op.isPending} onDone={refresh} />}
          </>
        )}
      </Card>
      <ValidationsCard />
    </div>
  );
}

type Save = (body: Record<string, unknown>) => void;

function RequirementsPanel({ d, projectId, canManage, save, busy }: { d: Lifecycle; projectId: string; canManage: boolean; save: Save; busy: boolean }) {
  const [form, setForm] = useState({ req_code: "", title: "", kind: "FUNCTIONAL", description: "" });
  return (
    <div className="flex flex-col gap-3">
      {canManage && (
        <form
          className="grid gap-2 sm:grid-cols-6"
          onSubmit={(e) => {
            e.preventDefault();
            save({ op: "save_requirement", project_id: projectId, ...form });
            setForm({ req_code: "", title: "", kind: form.kind, description: "" });
          }}
        >
          <input className={inputClass} placeholder="SRS-001" value={form.req_code} onChange={(e) => setForm({ ...form, req_code: e.target.value.toUpperCase() })} required />
          <input className={`${inputClass} sm:col-span-3`} placeholder="Nội dung yêu cầu (đo được, kiểm được)" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
          <select className={inputClass} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
            {Object.entries(KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <Button type="submit" disabled={busy}>+ Thêm yêu cầu</Button>
        </form>
      )}
      {d.requirements.length === 0 ? (
        <Empty>Chưa có yêu cầu phần mềm.</Empty>
      ) : (
        <Table head={["Mã", "Yêu cầu", "Loại", "Ca kiểm thử", ""]}>
          {d.requirements.map((r) => (
            <tr key={r.id} className={r.status === "OBSOLETE" ? "opacity-50" : ""}>
              <td className="py-1.5 pr-2 font-mono font-semibold">{r.req_code}</td>
              <td className="py-1.5 pr-2">{r.title}</td>
              <td className="py-1.5 pr-2">{KIND_LABEL[r.kind] ?? r.kind}</td>
              <td className={`py-1.5 pr-2 font-mono ${r.test_codes.length ? "" : "text-amber-600"}`}>{r.test_codes.join(", ") || "Chưa có"}</td>
              <td className="py-1.5 pr-2 text-right">
                {canManage && (
                  <button
                    className="text-[11px] text-slate-500 underline cursor-pointer"
                    onClick={() => save({ op: "save_requirement", id: r.id, project_id: projectId, req_code: r.req_code, title: r.title, kind: r.kind, description: r.description, status: r.status === "ACTIVE" ? "OBSOLETE" : "ACTIVE" })}
                  >
                    {r.status === "ACTIVE" ? "Ngừng" : "Dùng lại"}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}

function TestsPanel({ d, projectId, canManage, save, busy }: { d: Lifecycle; projectId: string; canManage: boolean; save: Save; busy: boolean }) {
  const [form, setForm] = useState({ tc_code: "", title: "", level: "SYSTEM", steps: "", expected: "", requirement_ids: [] as string[] });
  const [run, setRun] = useState<{ id: string; version_tag: string; result: string; actual: string } | null>(null);
  const active = d.requirements.filter((r) => r.status === "ACTIVE");
  return (
    <div className="flex flex-col gap-3">
      {canManage && (
        <form
          className="grid gap-2 sm:grid-cols-6 p-3 rounded-xl border border-slate-200 dark:border-slate-800"
          onSubmit={(e) => {
            e.preventDefault();
            save({ op: "save_test_case", project_id: projectId, ...form });
            setForm({ tc_code: "", title: "", level: form.level, steps: "", expected: "", requirement_ids: [] });
          }}
        >
          <input className={inputClass} placeholder="TC-001" value={form.tc_code} onChange={(e) => setForm({ ...form, tc_code: e.target.value.toUpperCase() })} required />
          <input className={`${inputClass} sm:col-span-3`} placeholder="Tên ca kiểm thử" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
          <select className={inputClass} value={form.level} onChange={(e) => setForm({ ...form, level: e.target.value })}>
            <option value="UNIT">Đơn vị (unit)</option>
            <option value="INTEGRATION">Tích hợp</option>
            <option value="SYSTEM">Hệ thống</option>
          </select>
          <Button type="submit" disabled={busy}>+ Thêm ca kiểm thử</Button>
          <textarea className={`${inputClass} sm:col-span-3`} rows={2} placeholder="Các bước thực hiện" value={form.steps} onChange={(e) => setForm({ ...form, steps: e.target.value })} />
          <textarea className={`${inputClass} sm:col-span-3`} rows={2} placeholder="Kết quả mong đợi" value={form.expected} onChange={(e) => setForm({ ...form, expected: e.target.value })} required />
          <div className="sm:col-span-6 flex flex-wrap gap-1.5 text-[11px]">
            <span className="text-slate-500">Kiểm chứng yêu cầu:</span>
            {active.map((r) => {
              const on = form.requirement_ids.includes(r.id);
              return (
                <button
                  type="button"
                  key={r.id}
                  onClick={() => setForm({ ...form, requirement_ids: on ? form.requirement_ids.filter((x) => x !== r.id) : [...form.requirement_ids, r.id] })}
                  className={`px-2 py-0.5 rounded-lg border font-mono cursor-pointer ${on ? "bg-sky-700 text-white border-sky-700" : "border-slate-300 dark:border-slate-700"}`}
                  title={r.title}
                >
                  {r.req_code}
                </button>
              );
            })}
          </div>
        </form>
      )}
      {d.tests.length === 0 ? (
        <Empty>Chưa có ca kiểm thử.</Empty>
      ) : (
        <Table head={["Mã", "Ca kiểm thử", "Cấp", "Yêu cầu", "Lần chạy gần nhất", ""]}>
          {d.tests.map((t) => (
            <tr key={t.id} className={t.status === "OBSOLETE" ? "opacity-50" : ""}>
              <td className="py-1.5 pr-2 font-mono font-semibold">{t.tc_code}</td>
              <td className="py-1.5 pr-2">
                {t.title}
                <div className="text-[11px] text-slate-500">Mong đợi: {t.expected}</div>
              </td>
              <td className="py-1.5 pr-2">{t.level}</td>
              <td className="py-1.5 pr-2 font-mono text-[11px]">{d.requirements.filter((r) => t.requirement_ids.includes(r.id)).map((r) => r.req_code).join(", ") || "—"}</td>
              <td className="py-1.5 pr-2 text-[11px]">
                {t.last_run ? (
                  <span className={resultTone(t.last_run.result)}>
                    <b>{t.last_run.result}</b> · {t.last_run.version_tag} · {t.last_run.executed_by_name ?? ""} {fmtDate(t.last_run.executed_at)}
                  </span>
                ) : (
                  <span className="text-amber-600">Chưa chạy</span>
                )}
              </td>
              <td className="py-1.5 pr-2 text-right">
                {canManage && t.status === "ACTIVE" && (
                  <Button variant="ghost" onClick={() => setRun({ id: t.id, version_tag: d.version ?? "", result: "PASS", actual: "" })}>Ghi kết quả</Button>
                )}
              </td>
            </tr>
          ))}
        </Table>
      )}
      {run && (
        <form
          className="grid gap-2 sm:grid-cols-5 p-3 rounded-xl border border-sky-200 dark:border-sky-900"
          onSubmit={(e) => {
            e.preventDefault();
            save({ op: "record_run", test_case_id: run.id, version_tag: run.version_tag, result: run.result, actual: run.actual || null });
            setRun(null);
          }}
        >
          <span className="sm:col-span-5 text-xs font-bold">Ghi lần chạy {d.tests.find((t) => t.id === run.id)?.tc_code} (không sửa được sau khi ghi — chạy lại thì ghi lần mới)</span>
          <input className={inputClass} placeholder="Phiên bản bản dựng (v1.2.0)" value={run.version_tag} onChange={(e) => setRun({ ...run, version_tag: e.target.value })} required />
          <select className={inputClass} value={run.result} onChange={(e) => setRun({ ...run, result: e.target.value })}>
            <option value="PASS">Đạt (PASS)</option>
            <option value="FAIL">Không đạt (FAIL)</option>
            <option value="BLOCKED">Bị chặn (BLOCKED)</option>
          </select>
          <input className={`${inputClass} sm:col-span-2`} placeholder="Kết quả thực tế (bắt buộc khi không đạt)" value={run.actual} onChange={(e) => setRun({ ...run, actual: e.target.value })} />
          <div className="flex gap-2">
            <Button type="submit" disabled={busy}>Ghi</Button>
            <Button variant="ghost" type="button" onClick={() => setRun(null)}>Hủy</Button>
          </div>
        </form>
      )}
    </div>
  );
}

function TracePanel({ d }: { d: Lifecycle }) {
  if (!d.version) return <Empty>Chưa có lần chạy kiểm thử nào — ma trận truy vết lập theo phiên bản bản dựng.</Empty>;
  if (!d.traceability) return <Empty>Dự án chưa có yêu cầu phần mềm.</Empty>;
  const pass = d.traceability.filter((t) => t.result === "PASS").length;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-slate-600 dark:text-slate-300">
        Phiên bản <b className="font-mono">{d.version}</b>: <b>{pass}/{d.traceability.length}</b> yêu cầu đạt. Khi ký phát hành phiên bản này, hệ thống lưu
        đúng ma trận này vào hồ sơ phát hành; phần mềm cấp B/C chỉ phát hành được khi mọi yêu cầu đạt.
      </p>
      <Table head={["Yêu cầu", "Nội dung", "Ca kiểm thử", "Kết quả"]}>
        {d.traceability.map((t) => (
          <tr key={t.req_id}>
            <td className="py-1.5 pr-2 font-mono font-semibold">{t.req_id}</td>
            <td className="py-1.5 pr-2">{t.title}</td>
            <td className="py-1.5 pr-2 font-mono">{t.test_case_id || "—"}</td>
            <td className={`py-1.5 pr-2 font-bold ${resultTone(t.result)}`}>{t.result === "NOT_TESTED" ? "Chưa có kiểm thử" : t.result}</td>
          </tr>
        ))}
      </Table>
    </div>
  );
}

function ProblemsPanel({ d, projectId, canManage, save, busy, onDone }: { d: Lifecycle; projectId: string; canManage: boolean; save: Save; busy: boolean; onDone: () => void }) {
  const empty = { title: "", description: "", severity: "MEDIUM", source: "INTERNAL_TEST", found_in_version: d.version ?? "", service_ticket_id: "", eco_id: "" };
  const [form, setForm] = useState(empty);
  const [fixFor, setFixFor] = useState<string | null>(null);
  const [fix, setFix] = useState({ root_cause: "", fix_summary: "", fixed_in_version: "" });
  return (
    <div className="flex flex-col gap-3">
      {canManage && (
        <form
          className="grid gap-2 sm:grid-cols-6 p-3 rounded-xl border border-slate-200 dark:border-slate-800"
          onSubmit={(e) => {
            e.preventDefault();
            save({ op: "create_problem", project_id: projectId, ...form, service_ticket_id: form.service_ticket_id || null, eco_id: form.eco_id || null, found_in_version: form.found_in_version || null });
            setForm(empty);
          }}
        >
          <input className={`${inputClass} sm:col-span-3`} placeholder="Tiêu đề lỗi" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
          <select className={inputClass} value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value })}>
            {Object.entries(SEVERITY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select className={inputClass} value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })}>
            <option value="INTERNAL_TEST">Kiểm thử nội bộ</option>
            <option value="REVIEW">Rà soát thiết kế / mã</option>
            <option value="FIELD">Hiện trường</option>
            <option value="CUSTOMER">Khách hàng phản ánh</option>
          </select>
          <input className={inputClass} placeholder="Phát hiện ở phiên bản" value={form.found_in_version} onChange={(e) => setForm({ ...form, found_in_version: e.target.value })} />
          <textarea className={`${inputClass} sm:col-span-6`} rows={2} placeholder="Mô tả lỗi và cách tái hiện" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} required />
          <select className={`${inputClass} sm:col-span-3`} value={form.service_ticket_id} onChange={(e) => setForm({ ...form, service_ticket_id: e.target.value })} aria-label="Phiếu bảo hành">
            <option value="">— Từ phiếu bảo hành / dịch vụ (nếu có) —</option>
            {d.service_tickets.map((s) => <option key={s.id} value={s.id}>{s.code} · máy {s.serial_no} · {s.symptom.slice(0, 50)}</option>)}
          </select>
          <select className={`${inputClass} sm:col-span-2`} value={form.eco_id} onChange={(e) => setForm({ ...form, eco_id: e.target.value })} aria-label="ECO">
            <option value="">— Thay đổi qua ECO (nếu có) —</option>
            {d.ecos.map((e) => <option key={e.id} value={e.id}>{e.code} · {e.title.slice(0, 40)}</option>)}
          </select>
          <Button type="submit" disabled={busy}>+ Báo lỗi</Button>
        </form>
      )}
      {d.problems.length === 0 ? (
        <Empty>Chưa có lỗi được báo.</Empty>
      ) : (
        <Table head={["Mã", "Lỗi", "Mức", "Phiên bản", "Liên kết", "Trạng thái", ""]}>
          {d.problems.map((p) => (
            <tr key={p.id}>
              <td className="py-1.5 pr-2 font-mono font-semibold">{p.code}</td>
              <td className="py-1.5 pr-2">
                <b>{p.title}</b>
                <div className="text-[11px] text-slate-500">{p.description}</div>
                {p.fix_summary && <div className="text-[11px] text-emerald-700 dark:text-emerald-400">Sửa: {p.fix_summary} (nguyên nhân: {p.root_cause})</div>}
              </td>
              <td className={`py-1.5 pr-2 font-bold ${p.severity === "CRITICAL" || p.severity === "HIGH" ? "text-rose-600" : ""}`}>{SEVERITY_LABEL[p.severity]}</td>
              <td className="py-1.5 pr-2 font-mono text-[11px]">{p.found_in_version ?? "—"}{p.fixed_in_version ? ` → ${p.fixed_in_version}` : ""}</td>
              <td className="py-1.5 pr-2 text-[11px]">
                {p.service_ticket_code && <div>Phiếu {p.service_ticket_code}</div>}
                {canManage && !["VERIFIED", "REJECTED"].includes(p.status) ? (
                  <select className={`${inputClass} !py-0.5 !text-[11px]`} value={p.eco_id ?? ""} onChange={(e) => save({ op: "link_eco", problem_id: p.id, eco_id: e.target.value || null })} aria-label="ECO">
                    <option value="">Chưa gắn ECO</option>
                    {d.ecos.map((e) => <option key={e.id} value={e.id}>{e.code}</option>)}
                  </select>
                ) : (
                  p.eco_code && <div>ECO {p.eco_code}</div>
                )}
              </td>
              <td className="py-1.5 pr-2 text-[11px]">{PROBLEM_STATUS[p.status] ?? p.status}</td>
              <td className="py-1.5 pr-2">
                {p.actions.some((a) => a.action === "fix") && fixFor !== p.id && (
                  <Button variant="ghost" onClick={() => { setFixFor(p.id); setFix({ root_cause: "", fix_summary: "", fixed_in_version: "" }); }}>Ghi đã sửa…</Button>
                )}
                <ActionBar
                  endpoint={`/api/factory/rd/sw-problems/${p.id}/actions`}
                  version={p.version}
                  actions={fixFor === p.id ? p.actions : p.actions.filter((a) => a.action !== "fix")}
                  labels={PROBLEM_ACTIONS}
                  extraPayload={(action) => (action === "fix" ? fix : undefined)}
                  onDone={() => { setFixFor(null); onDone(); }}
                />
                {fixFor === p.id && (
                  <div className="grid gap-1 mt-1">
                    <input className={inputClass} placeholder="Nguyên nhân gốc" value={fix.root_cause} onChange={(e) => setFix({ ...fix, root_cause: e.target.value })} />
                    <input className={inputClass} placeholder="Nội dung sửa" value={fix.fix_summary} onChange={(e) => setFix({ ...fix, fix_summary: e.target.value })} />
                    <input className={inputClass} placeholder="Đã sửa ở phiên bản (v1.2.1)" value={fix.fixed_in_version} onChange={(e) => setFix({ ...fix, fixed_in_version: e.target.value })} />
                  </div>
                )}
              </td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}

function ValidationsCard() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["factory", "rd", "sw-validations"], queryFn: () => api<Validation[]>("/api/factory/rd/sw-validations") });
  const refresh = () => qc.invalidateQueries({ queryKey: ["factory", "rd", "sw-validations"] });
  const empty = { system_name: "", system_version: "", gamp_category: "4", risk_level: "MEDIUM", gxp_impact: true, intended_use: "" };
  const [form, setForm] = useState(empty);
  const [adding, setAdding] = useState(false);
  const [evidence, setEvidence] = useState<Record<string, string>>({});
  const create = useMutation({
    mutationFn: () => api("/api/factory/rd/software", { method: "POST", json: { op: "create_validation", ...form } }),
    onSuccess: () => { setAdding(false); setForm(empty); refresh(); },
  });
  return (
    <Card
      title="Thẩm định phần mềm nội bộ dùng cho GMP (GAMP 5: URS → IQ → OQ → PQ → phê duyệt sử dụng)"
      actions={<Button variant="ghost" onClick={() => setAdding(!adding)}>+ Lập hồ sơ thẩm định</Button>}
    >
      <ErrorNote error={list.error ?? create.error} />
      {adding && (
        <form className="grid gap-2 sm:grid-cols-4 mb-3 p-3 rounded-xl border border-slate-200 dark:border-slate-800" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
          <Field label="Phần mềm / hệ thống"><input className={inputClass} value={form.system_name} onChange={(e) => setForm({ ...form, system_name: e.target.value })} required /></Field>
          <Field label="Phiên bản"><input className={inputClass} value={form.system_version} onChange={(e) => setForm({ ...form, system_version: e.target.value })} required /></Field>
          <Field label="Nhóm GAMP 5">
            <select className={inputClass} value={form.gamp_category} onChange={(e) => setForm({ ...form, gamp_category: e.target.value })}>
              <option value="1">1 — Hạ tầng</option>
              <option value="3">3 — Không cấu hình</option>
              <option value="4">4 — Có cấu hình</option>
              <option value="5">5 — Phát triển riêng</option>
            </select>
          </Field>
          <Field label="Mức rủi ro">
            <select className={inputClass} value={form.risk_level} onChange={(e) => setForm({ ...form, risk_level: e.target.value })}>
              <option value="LOW">Thấp</option>
              <option value="MEDIUM">Trung bình</option>
              <option value="HIGH">Cao</option>
            </select>
          </Field>
          <div className="sm:col-span-4">
            <Field label="Mục đích sử dụng / yêu cầu người dùng (URS)">
              <textarea className={inputClass} rows={2} value={form.intended_use} onChange={(e) => setForm({ ...form, intended_use: e.target.value })} required />
            </Field>
          </div>
          <label className="text-xs flex items-center gap-1.5 sm:col-span-3">
            <input type="checkbox" checked={form.gxp_impact} onChange={(e) => setForm({ ...form, gxp_impact: e.target.checked })} /> Ảnh hưởng GMP (hồ sơ, dữ liệu lô, chữ ký điện tử)
          </label>
          <Button type="submit" disabled={create.isPending}>Lập hồ sơ</Button>
        </form>
      )}
      {list.data?.length === 0 && <Empty>Chưa có hồ sơ thẩm định phần mềm.</Empty>}
      {!!list.data?.length && (
        <Table head={["Mã", "Phần mềm", "GAMP / rủi ro", "IQ · OQ · PQ", "Trạng thái", ""]}>
          {list.data.map((v) => (
            <tr key={v.id}>
              <td className="py-1.5 pr-2 font-mono font-semibold">{v.code}</td>
              <td className="py-1.5 pr-2">
                <b>{v.system_name}</b> <span className="font-mono">{v.system_version}</span>
                <div className="text-[11px] text-slate-500">{v.intended_use}</div>
              </td>
              <td className="py-1.5 pr-2 text-[11px]">Nhóm {v.gamp_category} · {v.risk_level}{v.gxp_impact ? " · GMP" : ""}</td>
              <td className="py-1.5 pr-2 text-[11px]">
                {[["IQ", v.iq_summary], ["OQ", v.oq_summary], ["PQ", v.pq_summary]].map(([k, s]) => (
                  <div key={k} className={s ? "" : "text-slate-400"}>{k}: {s ?? "chưa"}</div>
                ))}
              </td>
              <td className="py-1.5 pr-2 text-[11px]">
                {VALIDATION_STATUS[v.status] ?? v.status}
                {v.approved_by_name && <div>✍ {v.approved_by_name} · {fmtDateTime(v.approved_at)}</div>}
              </td>
              <td className="py-1.5 pr-2">
                {v.actions.some((a) => a.action.startsWith("complete_")) && (
                  <input className={`${inputClass} mb-1`} placeholder="Tóm tắt kết quả bước này" value={evidence[v.id] ?? ""} onChange={(e) => setEvidence({ ...evidence, [v.id]: e.target.value })} />
                )}
                <ActionBar
                  endpoint={`/api/factory/rd/sw-validations/${v.id}/actions`}
                  version={v.version}
                  actions={v.actions}
                  labels={VALIDATION_ACTIONS}
                  extraPayload={(action) => (action.startsWith("complete_") ? { summary: evidence[v.id] ?? "" } : undefined)}
                  onDone={() => { setEvidence({ ...evidence, [v.id]: "" }); refresh(); }}
                />
              </td>
            </tr>
          ))}
        </Table>
      )}
    </Card>
  );
}

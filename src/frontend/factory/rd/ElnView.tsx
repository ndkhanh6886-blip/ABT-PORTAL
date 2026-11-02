"use client";

import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ActionBar, type AllowedAction } from "../actions";
import { api, fmtDate, fmtQty } from "../api";
import { Button, Card, Empty, ErrorNote, Field, inputClass, StatusBadge, Table } from "../ui";
import { useRdContext } from "./shared";

const EXP_STATUS: Record<string, [string, string]> = {
  PLANNED: ["QUARANTINE", "Kế hoạch"],
  IN_PROGRESS: ["PENDING_QC", "Đang làm thí nghiệm"],
  SUBMITTED: ["ON_HOLD", "Đã gửi duyệt"],
  APPROVED: ["RELEASED", "Đã ký duyệt (Khóa ALCOA+)"],
  SUPERSEDED: ["EXPIRED", "Đã thay bằng Revision mới"],
  CANCELLED: ["REJECTED", "Đã hủy"],
};

const EXP_ACTIONS = {
  start: "Bắt đầu thí nghiệm",
  submit: "Gửi duyệt sổ ELN",
  withdraw: "Thu hồi để sửa",
  return: "Yêu cầu sửa lại",
  approve: "Ký phê duyệt ELN",
  cancel: "Hủy thí nghiệm",
};

interface ExperimentDetail {
  id: string;
  code: string;
  project_id: string;
  project_code: string;
  project_name: string;
  title: string;
  objective: string;
  hypothesis: string | null;
  protocol_summary: string | null;
  conclusion: string | null;
  status: string;
  revision: number;
  parent_code: string | null;
  performer_name?: string | null;
  wbs_task_code?: string | null;
  created_by_name: string | null;
  submitted_by_name: string | null;
  approved_by_name: string | null;
  started_at: string | null;
  finished_at: string | null;
  approved_at: string | null;
  supersede_reason: string | null;
  version: number;
  entries: {
    id: string;
    seq: number;
    entry_type: string;
    title: string | null;
    content: Record<string, any>;
    attachment_id: string | null;
    attachment_name: string | null;
    created_by_name: string | null;
    created_at: string;
  }[];
  materials: {
    id: string;
    item_code: string;
    item_name: string;
    lot_code: string;
    expiry_date: string | null;
    qty: number;
    uom: string;
    document_code: string;
    role_in_exp: string | null;
    issued_by_name: string | null;
    issued_at: string;
  }[];
  assets: {
    id: string;
    asset_code: string;
    asset_name: string;
    asset_type: string;
    run_params: Record<string, any>;
    used_by_name: string | null;
    used_at: string;
  }[];
  signatures: {
    id: string;
    meaning: string;
    signer_name: string;
    signed_at: string;
    auth_method: string;
    record_hash: string;
  }[];
  actions: AllowedAction[];
}

function ExperimentPanel({
  id,
  canWrite,
  onClose,
  onSelectRevision,
}: {
  id: string;
  canWrite: boolean;
  onClose: () => void;
  onSelectRevision: (newId: string) => void;
}) {
  const qc = useQueryClient();
  const ctx = useRdContext("rd.view");
  const detail = useQuery({ queryKey: ["factory", "rd", "experiment", id], queryFn: () => api<ExperimentDetail>(`/api/factory/rd/experiments/${id}`) });
  const assetsList = useQuery({ queryKey: ["factory", "assets"], queryFn: () => api<any[]>("/api/factory/assets") });

  const [conclusion, setConclusion] = useState("");
  const [entryType, setEntryType] = useState("OBSERVATION");
  const [entryTitle, setEntryTitle] = useState("");
  const [entryBody, setEntryBody] = useState("");

  // Material consumption state
  const [whId, setWhId] = useState("");
  const [itemId, setItemId] = useState("");
  const [matQty, setMatQty] = useState("");
  const [matRole, setMatRole] = useState("");

  // Equipment state
  const [assetId, setAssetId] = useState("");
  const [runProgram, setRunProgram] = useState("");

  // Revision state
  const [revReason, setRevReason] = useState("");

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["factory", "rd", "experiment", id] });
    qc.invalidateQueries({ queryKey: ["factory", "rd", "experiments"] });
    qc.invalidateQueries({ queryKey: ["factory", "stock"] });
  };

  const saveConclusionMut = useMutation({
    mutationFn: () =>
      api(`/api/factory/rd/experiments/${id}`, {
        method: "PUT",
        json: { conclusion, version: detail.data!.version },
      }),
    onSuccess: refresh,
  });

  const addEntryMut = useMutation({
    mutationFn: () =>
      api(`/api/factory/rd/experiments/${id}`, {
        method: "POST",
        json: { kind: "entry", entry_type: entryType, title: entryTitle || null, content: { notes: entryBody } },
      }),
    onSuccess: () => {
      setEntryTitle("");
      setEntryBody("");
      refresh();
    },
  });

  const uploadFileMut = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      if (entryTitle) fd.append("title", entryTitle);
      const res = await fetch(`/api/factory/rd/experiments/${id}/files`, { method: "POST", body: fd, credentials: "same-origin" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Lỗi ${res.status}`);
    },
    onSuccess: refresh,
  });

  const consumeMatMut = useMutation({
    mutationFn: () => {
      const selItem = ctx.data?.items.find((i) => i.id === (itemId || ctx.data?.items[0]?.id));
      return api(`/api/factory/rd/experiments/${id}`, {
        method: "POST",
        json: {
          kind: "material",
          warehouse_id: whId || ctx.data?.warehouses[0]?.id,
          item_id: selItem?.id,
          qty: Number(matQty),
          uom: selItem?.base_uom || "mL",
          role_in_exp: matRole || null,
        },
      });
    },
    onSuccess: () => {
      setMatQty("");
      setMatRole("");
      refresh();
    },
  });

  const logAssetMut = useMutation({
    mutationFn: () =>
      api(`/api/factory/rd/experiments/${id}`, {
        method: "POST",
        json: { kind: "asset", asset_id: assetId || assetsList.data?.[0]?.id, run_params: { program: runProgram || "Standard PCR" } },
      }),
    onSuccess: () => {
      setRunProgram("");
      refresh();
    },
  });

  const createRevMut = useMutation({
    mutationFn: () =>
      api<{ id: string }>(`/api/factory/rd/experiments/${id}`, {
        method: "POST",
        json: { kind: "revision", reason: revReason },
      }),
    onSuccess: (created) => {
      setRevReason("");
      refresh();
      if (created?.id) onSelectRevision(created.id);
    },
  });

  const e = detail.data;
  const selectedItem = ctx.data?.items.find((i) => i.id === (itemId || ctx.data?.items[0]?.id));

  return (
    <Card title={e ? `Sổ thí nghiệm ELN ${e.code} (Rev ${e.revision}) — ${e.title}` : "Chi tiết thí nghiệm ELN"} actions={<Button variant="ghost" onClick={onClose}>Đóng</Button>}>
      <ErrorNote error={detail.error ?? saveConclusionMut.error ?? addEntryMut.error ?? uploadFileMut.error ?? consumeMatMut.error ?? logAssetMut.error ?? createRevMut.error} />
      {e && (
        <div className="flex flex-col gap-3 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={EXP_STATUS[e.status]?.[0] ?? "QUARANTINE"} label={EXP_STATUS[e.status]?.[1] ?? e.status} />
            <span>· Dự án: <b className="font-mono">{e.project_code}</b> ({e.project_name})</span>
            {e.wbs_task_code && (
              <span className="px-2 py-0.5 rounded bg-indigo-100 dark:bg-indigo-950/70 text-indigo-800 dark:text-indigo-300 font-mono font-bold">
                📌 Công việc WBS: {e.wbs_task_code}
              </span>
            )}
            <span>· NCV thực hiện: <b>{e.performer_name || e.created_by_name}</b></span>
            {e.parent_code && <span>· Sửa đổi từ bản gốc: <b className="font-mono">{e.parent_code}</b></span>}
            {e.approved_by_name && <span className="text-emerald-700 dark:text-emerald-400 font-bold">· Đã ký duyệt bởi {e.approved_by_name} ({fmtDate(e.approved_at)})</span>}
          </div>

          <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-900/30 space-y-1">
            <div><b>Mục tiêu thí nghiệm:</b> {e.objective}</div>
            {e.hypothesis && <div><b>Giả thuyết:</b> {e.hypothesis}</div>}
            {e.protocol_summary && <div><b>Tóm tắt quy trình / công thức:</b> {e.protocol_summary}</div>}
            <div><b>Kết luận:</b> {e.conclusion || <span className="text-slate-400">Chưa nhập kết luận</span>}</div>
          </div>

          {canWrite && e.status === "IN_PROGRESS" && (
            <form
              className="flex gap-2 items-end"
              onSubmit={(ev) => {
                ev.preventDefault();
                saveConclusionMut.mutate();
              }}
            >
              <div className="flex-1">
                <Field label="Cập nhật kết luận thí nghiệm (bắt buộc trước khi gửi duyệt)">
                  <input
                    className={inputClass}
                    value={conclusion || e.conclusion || ""}
                    onChange={(ev) => setConclusion(ev.target.value)}
                    placeholder="Nhập kết luận tổng hợp từ dữ liệu thực nghiệm..."
                  />
                </Field>
              </div>
              <Button type="submit" variant="ghost" disabled={saveConclusionMut.isPending}>Lưu kết luận</Button>
            </form>
          )}

          {/* ELN Entries */}
          <div className="flex flex-col gap-2">
            <b className="text-sm">1. Nhật ký thực nghiệm, Bảng số liệu & File dữ liệu thô ({e.entries.length})</b>
            {e.entries.length === 0 ? (
              <Empty>Chưa có mục nhật ký nào.</Empty>
            ) : (
              <Table head={["#", "Loại", "Tiêu đề", "Nội dung / Số liệu", "File đính kèm (SHA-256)", "Người ghi", "Thời gian"]}>
                {e.entries.map((en) => (
                  <tr key={en.id}>
                    <td className="py-2 pr-2 font-mono">{en.seq}</td>
                    <td className="py-2 pr-3 font-mono">{en.entry_type}</td>
                    <td className="py-2 pr-3 font-semibold">{en.title || "—"}</td>
                    <td className="py-2 pr-3 whitespace-pre-wrap">{en.content?.notes || JSON.stringify(en.content)}</td>
                    <td className="py-2 pr-3">
                      {en.attachment_id ? (
                        <a
                          href={`/api/factory/rd/experiments/${e.id}/files?entry_id=${en.id}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-sky-700 dark:text-sky-400 underline font-mono"
                        >
                          {en.attachment_name || "Tải file"}
                        </a>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="py-2 pr-3">{en.created_by_name}</td>
                    <td className="py-2 pr-3">{fmtDate(en.created_at)}</td>
                  </tr>
                ))}
              </Table>
            )}

            {canWrite && (e.status === "IN_PROGRESS" || e.status === "SUBMITTED") && (
              <form
                className="grid gap-2 sm:grid-cols-5 items-end p-3 rounded-xl border border-slate-200 dark:border-slate-800"
                onSubmit={(ev) => {
                  ev.preventDefault();
                  addEntryMut.mutate();
                }}
              >
                <Field label="Loại mục ELN">
                  <select className={inputClass} value={entryType} onChange={(ev) => setEntryType(ev.target.value)}>
                    <option value="OBSERVATION">Quan sát / Thực hiện</option>
                    <option value="RESULT">Kết quả định lượng (Ct, RFU, OD)</option>
                    <option value="TABLE">Bảng phối trộn Mastermix</option>
                    <option value="TEXT">Ghi chú bổ sung</option>
                  </select>
                </Field>
                <Field label="Tiêu đề mục">
                  <input className={inputClass} value={entryTitle} onChange={(ev) => setEntryTitle(ev.target.value)} placeholder="VD: Kết quả chạy qPCR dải pha loãng" />
                </Field>
                <div className="sm:col-span-2">
                  <Field label="Nội dung / Dữ liệu ghi nhận *">
                    <input className={inputClass} value={entryBody} onChange={(ev) => setEntryBody(ev.target.value)} placeholder="Ct 10^3 = 26.4; Ct 10^2 = 29.8; R² = 0.998..." required />
                  </Field>
                </div>
                <div className="flex flex-col gap-1">
                  <Button type="submit" disabled={addEntryMut.isPending}>+ Ghi nhật ký ELN</Button>
                  <input
                    type="file"
                    accept="application/pdf,image/png,image/jpeg,text/csv,.xlsx,.zip"
                    onChange={(ev) => ev.target.files?.[0] && uploadFileMut.mutate(ev.target.files[0])}
                    className="text-[10px]"
                  />
                </div>
              </form>
            )}
          </div>

          {/* Materials consumed from R&D Warehouse */}
          <div className="flex flex-col gap-2">
            <b className="text-sm">2. Nguyên liệu & Hóa chất sử dụng (Trừ kho R&D theo FEFO & Lô) ({e.materials.length})</b>
            {e.materials.length > 0 && (
              <Table head={["Mã VT", "Tên vật tư / hóa chất", "Số lô", "Hạn dùng", "Lượng xuất", "Vai trò trong TN", "Phiếu xuất kho", "Người xuất"]}>
                {e.materials.map((m) => (
                  <tr key={m.id}>
                    <td className="py-2 pr-3 font-mono font-semibold">{m.item_code}</td>
                    <td className="py-2 pr-3">{m.item_name}</td>
                    <td className="py-2 pr-3 font-mono text-sky-700 dark:text-sky-400">{m.lot_code}</td>
                    <td className="py-2 pr-3 font-mono">{fmtDate(m.expiry_date)}</td>
                    <td className="py-2 pr-3 font-mono">{fmtQty(m.qty)} {m.uom}</td>
                    <td className="py-2 pr-3">{m.role_in_exp || "—"}</td>
                    <td className="py-2 pr-3 font-mono">{m.document_code}</td>
                    <td className="py-2 pr-3">{m.issued_by_name}</td>
                  </tr>
                ))}
              </Table>
            )}
            {canWrite && e.status === "IN_PROGRESS" && (ctx.data?.warehouses.length ?? 0) > 0 && (ctx.data?.items.length ?? 0) > 0 && (
              <form
                className="grid gap-2 sm:grid-cols-5 items-end p-3 rounded-xl border border-slate-200 dark:border-slate-800"
                onSubmit={(ev) => {
                  ev.preventDefault();
                  consumeMatMut.mutate();
                }}
              >
                <Field label="Kho xuất *">
                  <select className={inputClass} value={whId || ctx.data?.warehouses[0]?.id || ""} onChange={(ev) => setWhId(ev.target.value)}>
                    {ctx.data?.warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} — {w.name}</option>)}
                  </select>
                </Field>
                <div className="sm:col-span-2">
                  <Field label="Hóa chất / Vật tư (Tự phân bổ lô RELEASED theo FEFO) *">
                    <select className={inputClass} value={itemId || ctx.data?.items[0]?.id || ""} onChange={(ev) => setItemId(ev.target.value)}>
                      {ctx.data?.items.map((it) => <option key={it.id} value={it.id}>{it.code} — {it.name} ({it.base_uom})</option>)}
                    </select>
                  </Field>
                </div>
                <Field label={`Số lượng (${selectedItem?.base_uom || "ĐV"}) *`}>
                  <input type="number" step="any" min="0.0001" className={inputClass} value={matQty} onChange={(ev) => setMatQty(ev.target.value)} required />
                </Field>
                <div className="flex gap-1 items-end">
                  <Field label="Vai trò">
                    <input className={inputClass} value={matRole} onChange={(ev) => setMatRole(ev.target.value)} placeholder="Enzyme, Buffer..." />
                  </Field>
                  <Button type="submit" disabled={consumeMatMut.isPending}>Xuất kho</Button>
                </div>
              </form>
            )}
          </div>

          {/* Equipment used */}
          <div className="flex flex-col gap-2">
            <b className="text-sm">3. Thiết bị phòng Lab sử dụng (Kiểm tra hiệu chuẩn tự động) ({e.assets.length})</b>
            {e.assets.length > 0 && (
              <Table head={["Mã máy", "Tên thiết bị", "Loại", "Chương trình / Thông số chạy", "Người vận hành", "Thời điểm"]}>
                {e.assets.map((a) => (
                  <tr key={a.id}>
                    <td className="py-2 pr-3 font-mono font-semibold">{a.asset_code}</td>
                    <td className="py-2 pr-3">{a.asset_name}</td>
                    <td className="py-2 pr-3 font-mono">{a.asset_type}</td>
                    <td className="py-2 pr-3 font-mono">{JSON.stringify(a.run_params)}</td>
                    <td className="py-2 pr-3">{a.used_by_name}</td>
                    <td className="py-2 pr-3">{fmtDate(a.used_at)}</td>
                  </tr>
                ))}
              </Table>
            )}
            {canWrite && e.status === "IN_PROGRESS" && (assetsList.data?.length ?? 0) > 0 && (
              <form
                className="grid gap-2 sm:grid-cols-4 items-end p-3 rounded-xl border border-slate-200 dark:border-slate-800"
                onSubmit={(ev) => {
                  ev.preventDefault();
                  logAssetMut.mutate();
                }}
              >
                <div className="sm:col-span-2">
                  <Field label="Chọn thiết bị (Chặn máy quá hạn hiệu chuẩn / đang bảo trì) *">
                    <select className={inputClass} value={assetId || assetsList.data?.[0]?.id || ""} onChange={(ev) => setAssetId(ev.target.value)}>
                      {assetsList.data?.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.code} — {a.name} ({a.status}{a.next_calibration_due ? ` · hạn HC ${a.next_calibration_due.slice(0, 10)}` : ""})
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
                <Field label="Chương trình nhiệt / Thông số chạy">
                  <input className={inputClass} value={runProgram} onChange={(ev) => setRunProgram(ev.target.value)} placeholder="95°C 3m; 45x (95°C 10s, 60°C 30s)" />
                </Field>
                <Button type="submit" disabled={logAssetMut.isPending}>Ghi nhận thiết bị</Button>
              </form>
            )}
          </div>

          {/* Electronic Signatures */}
          {e.signatures.length > 0 && (
            <div className="p-2.5 rounded-xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50/50 dark:bg-emerald-950/20">
              <b>Chữ ký điện tử (21 CFR Part 11):</b>
              {e.signatures.map((s) => (
                <div key={s.id} className="font-mono text-[11px]">
                  {s.meaning} bởi <b>{s.signer_name}</b> lúc {fmtDate(s.signed_at)} ({s.auth_method}) · SHA-256: {s.record_hash.slice(0, 16)}…
                </div>
              ))}
            </div>
          )}

          <ActionBar
            endpoint={`/api/factory/rd/experiments/${e.id}/actions`}
            version={e.version}
            actions={e.actions.filter((a) => a.action !== "supersede")}
            labels={EXP_ACTIONS}
            onDone={refresh}
          />

          {/* Create new revision when APPROVED */}
          {e.status === "APPROVED" && canWrite && (
            <form
              className="flex flex-wrap gap-2 items-end p-3 rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50/40 dark:bg-amber-950/20"
              onSubmit={(ev) => {
                ev.preventDefault();
                createRevMut.mutate();
              }}
            >
              <div className="flex-1 min-w-64">
                <Field label="Sổ ELN đã duyệt bị khóa cứng. Muốn bổ sung/sửa phải tạo Phiên bản mới (Revision) kèm lý do *">
                  <input
                    className={inputClass}
                    value={revReason}
                    onChange={(ev) => setRevReason(ev.target.value)}
                    placeholder="Nhập lý do tạo phiên bản sửa đổi (tối thiểu 5 ký tự)..."
                    required
                  />
                </Field>
              </div>
              <Button type="submit" disabled={createRevMut.isPending}>Tạo Revision {e.revision + 1}</Button>
            </form>
          )}
        </div>
      )}
    </Card>
  );
}

export function ElnView({ canWrite }: { canWrite: boolean }) {
  const qc = useQueryClient();
  const ctx = useRdContext("rd.view");
  const [projectId, setProjectId] = useState("");
  const [staffFilter, setStaffFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const [newProjId, setNewProjId] = useState("");
  const [performerName, setPerformerName] = useState("");
  const [wbsTaskCode, setWbsTaskCode] = useState("");
  const [title, setTitle] = useState("");
  const [objective, setObjective] = useState("");
  const [hypothesis, setHypothesis] = useState("");
  const [protocol, setProtocol] = useState("");

  const projects = useQuery({ queryKey: ["factory", "rd", "projects", ""], queryFn: () => api<any[]>("/api/factory/rd/projects") });
  const list = useQuery({
    queryKey: ["factory", "rd", "experiments", projectId],
    queryFn: () => api<any[]>(`/api/factory/rd/experiments${projectId ? `?project_id=${projectId}` : ""}`),
  });

  const createMut = useMutation({
    mutationFn: () =>
      api<{ id: string }>("/api/factory/rd/experiments", {
        method: "POST",
        idempotent: true,
        json: {
          project_id: newProjId || projects.data?.[0]?.id,
          title,
          objective,
          hypothesis: hypothesis || null,
          protocol_summary: protocol || null,
          performer_name: performerName || null,
          wbs_task_code: wbsTaskCode || null,
          start_now: true,
        },
      }),
    onSuccess: (created) => {
      setAdding(false);
      setTitle("");
      setObjective("");
      setHypothesis("");
      setProtocol("");
      setWbsTaskCode("");
      qc.invalidateQueries({ queryKey: ["factory", "rd", "experiments"] });
      if (created?.id) setSelected(created.id);
    },
  });

  const allExps = list.data ?? [];
  const staffOptions = Array.from(
    new Set([
      ...(ctx.data?.rd_staff?.map((s) => s.name) ?? []),
      ...allExps.map((r) => r.performer_name || r.created_by_name).filter(Boolean),
    ])
  );

  const filteredExps = allExps.filter((r) => {
    const performer = r.performer_name || r.created_by_name || "";
    if (staffFilter && performer !== staffFilter) return false;
    if (statusFilter && r.status !== statusFilter) return false;
    if (searchQuery.trim() !== "") {
      const q = searchQuery.toLowerCase();
      const hay = `${r.code || ""} ${r.title || ""} ${r.project_code || ""} ${r.wbs_task_code || ""} ${performer}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  return (
    <div className="flex flex-col gap-3">
      {selected && (
        <ExperimentPanel
          key={selected}
          id={selected}
          canWrite={canWrite}
          onClose={() => setSelected(null)}
          onSelectRevision={(newId) => setSelected(newId)}
        />
      )}

      <Card
        title="Sổ thí nghiệm điện tử (ELN — Tuân thủ ALCOA+ & 21 CFR Part 11)"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <input
              className={`${inputClass} w-44`}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="🔍 Tìm mã ELN, tiêu đề, WBS..."
            />
            <select className={`${inputClass} w-56`} value={staffFilter} onChange={(e) => setStaffFilter(e.target.value)}>
              <option value="">👤 Mọi nghiên cứu viên R&D</option>
              {staffOptions.map((st) => (
                <option key={st} value={st}>
                  {st}
                </option>
              ))}
            </select>
            <select className={`${inputClass} w-52`} value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">Mọi dự án R&D</option>
              {projects.data?.map((p) => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
            </select>
            <select className={`${inputClass} w-40`} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">Mọi trạng thái ELN</option>
              {Object.entries(EXP_STATUS).map(([k, [, label]]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
            {canWrite && <Button onClick={() => setAdding(!adding)}>+ Lập thí nghiệm ELN mới</Button>}
          </div>
        }
      >
        <ErrorNote error={list.error ?? createMut.error} />

        {/* Quick Researcher Workload Filter Bar for ELN */}
        {staffOptions.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 mb-3 pb-2.5 border-b border-slate-100 dark:border-slate-800 text-xs">
            <span className="font-semibold text-slate-500 mr-1">🧪 Lọc nhanh Nhật ký ELN theo Nghiên cứu viên R&D:</span>
            <button
              type="button"
              onClick={() => setStaffFilter("")}
              className={`px-2.5 py-1 rounded-full font-semibold cursor-pointer transition-all ${
                staffFilter === ""
                  ? "bg-indigo-600 text-white"
                  : "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200"
              }`}
            >
              Tất cả ({allExps.length})
            </button>
            {staffOptions.map((st) => {
              const cnt = allExps.filter((r) => (r.performer_name || r.created_by_name) === st).length;
              const active = staffFilter === st;
              return (
                <button
                  key={st}
                  type="button"
                  onClick={() => setStaffFilter(active ? "" : st)}
                  className={`px-2.5 py-1 rounded-full font-semibold cursor-pointer transition-all ${
                    active
                      ? "bg-indigo-600 text-white shadow-sm"
                      : "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200"
                  }`}
                >
                  👤 {st} ({cnt})
                </button>
              );
            })}
          </div>
        )}

        {adding && (
          <form
            className="grid gap-3 sm:grid-cols-3 p-3 mb-3 rounded-xl border border-sky-200 dark:border-sky-900 bg-sky-50/40 dark:bg-sky-950/20"
            onSubmit={(e) => {
              e.preventDefault();
              createMut.mutate();
            }}
          >
            <Field label="Thuộc dự án R&D *">
              <select className={inputClass} value={newProjId || projects.data?.[0]?.id || ""} onChange={(e) => setNewProjId(e.target.value)} required>
                {projects.data?.map((p) => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
              </select>
            </Field>
            <Field label="Nghiên cứu viên thực hiện (Phòng R&D)">
              <select className={inputClass} value={performerName} onChange={(e) => setPerformerName(e.target.value)}>
                <option value="">-- Mặc định theo người đăng nhập --</option>
                {staffOptions.map((st) => (
                  <option key={st} value={st}>
                    {st}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Mã công việc WBS liên kết (Tùy chọn)">
              <input
                className={inputClass}
                value={wbsTaskCode}
                onChange={(e) => setWbsTaskCode(e.target.value)}
                placeholder="VD: PRJ26-003-WBS-02"
              />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Tiêu đề thí nghiệm *">
                <input className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="VD: Khảo sát nhiệt độ bắt cặp (Ta) và nồng độ Mg2+" required />
              </Field>
            </div>
            <Field label="Giả thuyết khoa học">
              <input className={inputClass} value={hypothesis} onChange={(e) => setHypothesis(e.target.value)} placeholder="VD: Tăng Mg2+ lên 3.0 mM giúp giảm Ct ~1.2 chu kỳ" />
            </Field>
            <Field label="Mục tiêu thí nghiệm *">
              <input className={inputClass} value={objective} onChange={(e) => setObjective(e.target.value)} placeholder="Xác định điều kiện phản ứng đạt hiệu suất khuếch đại 95–105%" required />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Tóm tắt công thức / Protocol">
                <textarea className={inputClass} rows={2} value={protocol} onChange={(e) => setProtocol(e.target.value)} />
              </Field>
            </div>
            <div className="sm:col-span-3 flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setAdding(false)}>Hủy</Button>
              <Button type="submit" disabled={createMut.isPending}>Tạo & Bắt đầu ghi ELN</Button>
            </div>
          </form>
        )}

        {filteredExps.length === 0 && <Empty>Chưa có sổ thí nghiệm điện tử (ELN) nào khớp bộ lọc.</Empty>}
        {filteredExps.length > 0 && (
          <Table head={["Mã ELN", "Rev", "Tiêu đề thí nghiệm & Công việc WBS", "Dự án", "Mục nhật ký", "Vật tư R&D", "Nghiên cứu viên thực hiện", "Người duyệt", "Trạng thái"]}>
            {filteredExps.map((r) => (
              <tr key={r.id} className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50" onClick={() => setSelected(r.id)}>
                <td className="py-2 pr-3 font-mono font-semibold text-sky-700 dark:text-sky-400">{r.code}</td>
                <td className="py-2 pr-3 font-mono">v{r.revision}</td>
                <td className="py-2 pr-3">
                  <div className="font-semibold">{r.title}</div>
                  {r.wbs_task_code && (
                    <span className="mt-0.5 px-1.5 py-0.5 rounded bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 font-mono text-[10px] inline-block">
                      📌 WBS: {r.wbs_task_code}
                    </span>
                  )}
                </td>
                <td className="py-2 pr-3 font-mono">{r.project_code}</td>
                <td className="py-2 pr-3 font-mono">{r.entry_count}</td>
                <td className="py-2 pr-3 font-mono">{r.material_count}</td>
                <td className="py-2 pr-3">
                  <span className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 font-medium text-slate-800 dark:text-slate-200 inline-block">
                    👤 {r.performer_name || r.created_by_name}
                  </span>
                </td>
                <td className="py-2 pr-3">{r.approved_by_name || "—"}</td>
                <td className="py-2 pr-3">
                  <StatusBadge status={EXP_STATUS[r.status]?.[0] ?? "QUARANTINE"} label={EXP_STATUS[r.status]?.[1] ?? r.status} />
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}

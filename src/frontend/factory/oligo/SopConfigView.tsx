"use client";

import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { Button, Card, Empty, ErrorNote, Field, inputClass, Table } from "../ui";
import { ItemPicker } from "./EquipmentView";
import { PURIFICATION } from "./shared";

export interface StepField { key: string; label: string; type: "NUMBER" | "TEXT" | "EQUIPMENT" | "REAGENT"; unit?: string | null; required: boolean; item_id?: string | null; default_qty?: number | null; uom?: string | null }
interface Method { id: string; category: string; name: string; kind: "STANDARD" | "QUANTIFICATION"; target_hours: number | null; fields: StepField[]; status: string; version: number }
interface Workflow { id: string; name: string; description: string | null; purifications: string[]; steps: { method_id: string; name?: string | null }[]; revision: number; status: string; version: number }

export const FIELD_TYPE: Record<StepField["type"], string> = { NUMBER: "Số", TEXT: "Chữ", EQUIPMENT: "Thiết bị", REAGENT: "Hóa chất (trừ kho)" };
const blankField = (): StepField => ({ key: "", label: "", type: "NUMBER", unit: "", required: true });
const slug = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").replace(/^(\d)/, "f_$1").slice(0, 40);

function MethodEditor({ base, onClose }: { base?: Method; onClose: () => void }) {
  const qc = useQueryClient();
  const [m, setM] = useState({ category: base?.category ?? "", name: base?.name ?? "", kind: base?.kind ?? "STANDARD", target_hours: base?.target_hours != null ? String(base.target_hours) : "", status: base?.status ?? "ACTIVE" });
  const [fields, setFields] = useState<StepField[]>(base?.fields ?? []);
  const save = useMutation({
    mutationFn: () => {
      const body = { ...m, target_hours: m.target_hours ? Number(m.target_hours) : null, fields: fields.map((f) => ({ ...f, key: f.key || slug(f.label), default_qty: f.default_qty ?? null })) };
      if (!base) return api("/api/factory/oligo/sop/methods", { method: "POST", idempotent: true, json: body });
      const reason = window.prompt("Lý do sửa phương pháp:");
      if (!reason) throw new Error("Cần lý do sửa.");
      return api(`/api/factory/oligo/sop/methods/${base.id}`, { method: "PUT", json: { ...body, version: base.version, reason } });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["factory", "oligo-sop"] });
      onClose();
    },
  });
  const setF = (i: number, p: Partial<StepField>) => setFields(fields.map((f, j) => (j === i ? { ...f, ...p } : f)));
  return (
    <form className="flex flex-col gap-3 p-3 rounded-xl border border-sky-200 dark:border-sky-900 bg-sky-50/60 dark:bg-sky-950/30" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
      <div className="grid gap-3 sm:grid-cols-5 items-end">
        <Field label="Nhóm bước *"><input className={inputClass} list="sop-categories" value={m.category} onChange={(e) => setM({ ...m, category: e.target.value })} required /></Field>
        <Field label="Tên phương pháp *"><input className={inputClass} value={m.name} onChange={(e) => setM({ ...m, name: e.target.value })} required /></Field>
        <Field label="Loại" hint="Định lượng: bước đo OD (QC lấy OD/nmol từ đây)">
          <select className={inputClass} value={m.kind} onChange={(e) => setM({ ...m, kind: e.target.value as Method["kind"] })}>
            <option value="STANDARD">Thông thường</option>
            <option value="QUANTIFICATION">Định lượng (đo OD)</option>
          </select>
        </Field>
        <Field label="Thời gian chuẩn (giờ)"><input className={inputClass} type="number" step="any" min="0" value={m.target_hours} onChange={(e) => setM({ ...m, target_hours: e.target.value })} /></Field>
        <Field label="Trạng thái">
          <select className={inputClass} value={m.status} onChange={(e) => setM({ ...m, status: e.target.value })}>
            <option value="ACTIVE">Đang dùng</option>
            <option value="INACTIVE">Ngừng dùng</option>
          </select>
        </Field>
      </div>
      <datalist id="sop-categories">{["Cắt & khử bảo vệ", "Tinh sạch", "Khử muối", "Đo OD", "Làm khô / đông khô", "Click chemistry", "Hoàn nguyên & chia ống"].map((c) => <option key={c} value={c} />)}</datalist>
      <div className="text-xs font-bold">Thông số ghi ở bước này</div>
      {fields.map((f, i) => (
        <div key={i} className="flex flex-wrap gap-2 items-center text-xs">
          <input className={`${inputClass} w-48`} placeholder="Tên thông số" value={f.label} onChange={(e) => setF(i, { label: e.target.value })} required />
          <select className={`${inputClass} w-40`} value={f.type} onChange={(e) => setF(i, { type: e.target.value as StepField["type"] })}>
            {Object.entries(FIELD_TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          {f.type === "NUMBER" && <input className={`${inputClass} w-20`} placeholder="Đơn vị" value={f.unit ?? ""} onChange={(e) => setF(i, { unit: e.target.value })} />}
          {f.type === "REAGENT" && (
            <>
              <ItemPicker value={f.item_id ?? ""} onChange={(id) => setF(i, { item_id: id || null })} />
              <input className={`${inputClass} w-24`} type="number" step="any" min="0" placeholder="Lượng mặc định" value={f.default_qty ?? ""} onChange={(e) => setF(i, { default_qty: e.target.value === "" ? null : Number(e.target.value) })} />
              <input className={`${inputClass} w-16`} placeholder="ĐV" value={f.uom ?? ""} onChange={(e) => setF(i, { uom: e.target.value })} required />
            </>
          )}
          {f.type !== "REAGENT" && <label className="flex items-center gap-1"><input type="checkbox" checked={f.required} onChange={(e) => setF(i, { required: e.target.checked })} />Bắt buộc</label>}
          <button type="button" className="text-rose-600 cursor-pointer" onClick={() => setFields(fields.filter((_, j) => j !== i))}>Xóa</button>
        </div>
      ))}
      <div className="flex gap-2">
        <Button type="button" variant="ghost" onClick={() => setFields([...fields, blankField()])}>+ Thông số</Button>
        <Button type="button" variant="ghost" onClick={onClose}>Hủy</Button>
        <Button type="submit" disabled={save.isPending}>Lưu phương pháp</Button>
      </div>
      <ErrorNote error={save.error} />
    </form>
  );
}

function WorkflowEditor({ base, methods, onClose }: { base?: Workflow; methods: Method[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [w, setW] = useState({ name: base?.name ?? "", description: base?.description ?? "", purifications: base?.purifications ?? [], status: base?.status ?? "ACTIVE" });
  const [steps, setSteps] = useState<{ method_id: string; name: string }[]>(base?.steps.map((s) => ({ method_id: s.method_id, name: s.name ?? "" })) ?? []);
  const save = useMutation({
    mutationFn: () => {
      const body = { ...w, steps: steps.map((s) => ({ method_id: s.method_id, name: s.name || null })) };
      if (!base) return api("/api/factory/oligo/sop/workflows", { method: "POST", idempotent: true, json: body });
      const reason = window.prompt("Lý do sửa quy trình (các hồ sơ đang làm giữ bản cũ):");
      if (!reason) throw new Error("Cần lý do sửa.");
      return api(`/api/factory/oligo/sop/workflows/${base.id}`, { method: "PUT", json: { ...body, version: base.version, reason } });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["factory", "oligo-sop"] });
      onClose();
    },
  });
  const move = (i: number, d: number) => {
    const n = [...steps];
    [n[i], n[i + d]] = [n[i + d], n[i]];
    setSteps(n);
  };
  const active = methods.filter((m) => m.status === "ACTIVE");
  return (
    <form className="flex flex-col gap-3 p-3 rounded-xl border border-sky-200 dark:border-sky-900 bg-sky-50/60 dark:bg-sky-950/30" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
      <div className="grid gap-3 sm:grid-cols-3 items-end">
        <Field label="Tên quy trình *"><input className={inputClass} value={w.name} onChange={(e) => setW({ ...w, name: e.target.value })} required /></Field>
        <Field label="Mô tả"><input className={inputClass} value={w.description} onChange={(e) => setW({ ...w, description: e.target.value })} /></Field>
        <Field label="Trạng thái">
          <select className={inputClass} value={w.status} onChange={(e) => setW({ ...w, status: e.target.value })}>
            <option value="ACTIVE">Đang dùng</option>
            <option value="INACTIVE">Ngừng dùng</option>
          </select>
        </Field>
      </div>
      <div className="flex flex-wrap gap-3 text-xs items-center">
        <span className="text-slate-500">Mặc định cho tinh sạch:</span>
        {Object.entries(PURIFICATION).map(([k, v]) => (
          <label key={k} className="flex items-center gap-1">
            <input type="checkbox" checked={w.purifications.includes(k)} onChange={(e) => setW({ ...w, purifications: e.target.checked ? [...w.purifications, k] : w.purifications.filter((x) => x !== k) })} />
            {v}
          </label>
        ))}
      </div>
      <div className="text-xs font-bold">Các bước (theo thứ tự)</div>
      {steps.map((s, i) => (
        <div key={i} className="flex flex-wrap gap-2 items-center text-xs">
          <b className="w-6">{i + 1}.</b>
          <select className={`${inputClass} w-72`} value={s.method_id} onChange={(e) => setSteps(steps.map((x, j) => (j === i ? { ...x, method_id: e.target.value } : x)))} required>
            <option value="">Chọn phương pháp</option>
            {active.map((m) => <option key={m.id} value={m.id}>{m.category} — {m.name}{m.kind === "QUANTIFICATION" ? " (đo OD)" : ""}</option>)}
          </select>
          <input className={`${inputClass} w-48`} placeholder="Tên bước (tùy chọn)" value={s.name} onChange={(e) => setSteps(steps.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
          <button type="button" className="cursor-pointer disabled:opacity-30" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Lên">↑</button>
          <button type="button" className="cursor-pointer disabled:opacity-30" disabled={i === steps.length - 1} onClick={() => move(i, 1)} aria-label="Xuống">↓</button>
          <button type="button" className="text-rose-600 cursor-pointer" onClick={() => setSteps(steps.filter((_, j) => j !== i))}>Xóa</button>
        </div>
      ))}
      <div className="flex gap-2">
        <Button type="button" variant="ghost" onClick={() => setSteps([...steps, { method_id: "", name: "" }])}>+ Bước</Button>
        <Button type="button" variant="ghost" onClick={onClose}>Hủy</Button>
        <Button type="submit" disabled={save.isPending}>Lưu quy trình</Button>
      </div>
      <p className="text-[11px] text-slate-500">Quy trình phải có đúng một bước Định lượng (đo OD). Mỗi kiểu tinh sạch chỉ có một quy trình mặc định đang dùng; kiểu tinh sạch chưa có quy trình thì hậu tổng hợp dùng các bước cơ bản.</p>
      <ErrorNote error={save.error} />
    </form>
  );
}

/** "Quy trình SOP" (as OligoFlow's SOP configuration): 1. library of step methods, 2. workflows built from them. */
export function SopConfigView({ canManage }: { canManage: boolean }) {
  const sop = useQuery({ queryKey: ["factory", "oligo-sop"], queryFn: () => api<{ methods: Method[]; workflows: Workflow[] }>("/api/factory/oligo/sop") });
  const [method, setMethod] = useState<Method | "new" | null>(null);
  const [workflow, setWorkflow] = useState<Workflow | "new" | null>(null);
  const methods = sop.data?.methods ?? [];
  const nameOf = (id: string) => methods.find((m) => m.id === id)?.name ?? "?";
  return (
    <div className="flex flex-col gap-3">
      <ErrorNote error={sop.error} />
      <Card title="1. Thư viện phương pháp cho từng bước" actions={canManage && !method && <Button onClick={() => setMethod("new")}>+ Phương pháp</Button>}>
        {method && <MethodEditor key={method === "new" ? "new" : method.id} base={method === "new" ? undefined : method} onClose={() => setMethod(null)} />}
        {sop.data && methods.length === 0 && !method && <Empty>Chưa có phương pháp. Thêm các bước như cắt & khử bảo vệ, tinh sạch HPLC/PAGE/OPC, đo OD.</Empty>}
        {methods.length > 0 && (
          <Table head={["Nhóm bước", "Phương pháp", "Thời gian chuẩn", "Thông số ghi", "Trạng thái", ""]}>
            {methods.map((m) => (
              <tr key={m.id} className={m.status === "ACTIVE" ? "" : "opacity-50"}>
                <td className="py-1.5 pr-3 text-xs">{m.category}</td>
                <td className="py-1.5 pr-3">{m.name}{m.kind === "QUANTIFICATION" && <span className="text-sky-700 dark:text-sky-400 text-xs"> · đo OD</span>}</td>
                <td className="py-1.5 pr-3 text-xs">{m.target_hours ? `${m.target_hours} giờ` : "—"}</td>
                <td className="py-1.5 pr-3 text-xs">{m.fields.map((f) => `${f.label} (${FIELD_TYPE[f.type]}${f.type === "REAGENT" && f.default_qty != null ? ` ${f.default_qty} ${f.uom}` : ""})`).join(" · ") || "—"}</td>
                <td className="py-1.5 pr-3 text-xs">{m.status === "ACTIVE" ? "Đang dùng" : "Ngừng"}</td>
                <td className="py-1.5 pr-3 text-right">{canManage && <Button variant="ghost" onClick={() => setMethod(m)}>Sửa</Button>}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <Card title="2. Quy trình SOP sau tổng hợp" actions={canManage && !workflow && methods.length > 0 && <Button onClick={() => setWorkflow("new")}>+ Quy trình</Button>}>
        {workflow && <WorkflowEditor key={workflow === "new" ? "new" : workflow.id} base={workflow === "new" ? undefined : workflow} methods={methods} onClose={() => setWorkflow(null)} />}
        {sop.data && sop.data.workflows.length === 0 && !workflow && <Empty>Chưa có quy trình.</Empty>}
        {sop.data && sop.data.workflows.length > 0 && (
          <Table head={["Quy trình", "Mặc định cho", "Các bước", "Phiên bản", "Trạng thái", ""]}>
            {sop.data.workflows.map((w) => (
              <tr key={w.id} className={w.status === "ACTIVE" ? "" : "opacity-50"}>
                <td className="py-1.5 pr-3">{w.name}{w.description && <div className="text-[11px] text-slate-500">{w.description}</div>}</td>
                <td className="py-1.5 pr-3 text-xs">{w.purifications.map((p) => PURIFICATION[p as keyof typeof PURIFICATION]).join(", ") || "—"}</td>
                <td className="py-1.5 pr-3 text-xs">{w.steps.map((s, i) => `${i + 1}. ${s.name || nameOf(s.method_id)}`).join(" → ")}</td>
                <td className="py-1.5 pr-3 text-xs">rev {w.revision}</td>
                <td className="py-1.5 pr-3 text-xs">{w.status === "ACTIVE" ? "Đang dùng" : "Ngừng"}</td>
                <td className="py-1.5 pr-3 text-right">{canManage && <Button variant="ghost" onClick={() => setWorkflow(w)}>Sửa</Button>}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}

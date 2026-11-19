"use client";

import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as XLSX from "xlsx";
import { api, useFactoryMe } from "../api";
import { Button, Card, Empty, ErrorNote, Field, inputClass, Table } from "../ui";
import { openExcelImportTemplate } from "../import/FactoryExcelImportModule";
import { ItemPicker } from "./EquipmentView";
import { PURIFICATION } from "./shared";

export interface StepField {
  key: string;
  label: string;
  type: "NUMBER" | "TEXT" | "EQUIPMENT" | "REAGENT" | "COLUMN";
  unit?: string | null;
  required: boolean;
  item_id?: string | null;
  item_code?: string | null;
  item_name?: string | null;
  default_qty?: number | null;
  uom?: string | null;
}
interface Method { id: string; category: string; name: string; kind: "STANDARD" | "QUANTIFICATION"; target_hours: number | null; fields: StepField[]; status: string; version: number }
interface Workflow { id: string; name: string; description: string | null; purifications: string[]; steps: { method_id: string; name?: string | null }[]; revision: number; status: string; version: number }

export const FIELD_TYPE: Record<StepField["type"], string> = { NUMBER: "Số", TEXT: "Chữ", EQUIPMENT: "Thiết bị", REAGENT: "Hóa chất (trừ kho)", COLUMN: "Cột sắc ký (khấu hao)" };
const blankField = (): StepField => ({ key: "", label: "", type: "NUMBER", unit: "", required: true });
const slug = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/gi, "d").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").replace(/^(\d)/, "f_$1").slice(0, 34);

function buildUniqueMethodFields(fields: StepField[]) {
  const used = new Set<string>();
  return fields.map((f, idx) => {
    let baseKey = (f.key || slug(f.label) || `field_${idx + 1}`).replace(/[^a-z0-9_]/g, "_");
    if (!/^[a-z]/.test(baseKey)) baseKey = `f_${baseKey}`;
    baseKey = baseKey.slice(0, 34);
    let key = baseKey;
    let seq = 2;
    while (used.has(key)) {
      const suffix = `_${seq++}`;
      key = `${baseKey.slice(0, 40 - suffix.length)}${suffix}`;
    }
    used.add(key);
    return {
      key,
      label: f.label,
      type: f.type,
      unit: f.unit || null,
      required: f.required,
      item_id: f.type === "REAGENT" ? f.item_id || null : null,
      default_qty: f.type === "REAGENT" ? f.default_qty ?? null : null,
      uom: f.type === "REAGENT" ? f.uom || null : null,
    };
  });
}

function downloadSheet(rows: unknown[][], sheetName: string, fileName: string) {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, fileName);
}

function exportMethodsExcel(methods: Method[]) {
  const headers = ["Nhóm bước *", "Tên phương pháp *", "Loại bước", "Định mức giờ", "Tên thông số / Hóa chất", "Loại thông số", "Mã hóa chất", "Định mức / mẫu", "Đơn vị", "Bắt buộc", "Trạng thái"];
  const keys = ["category", "method_name", "kind", "target_hours", "field_label", "field_type", "item_code", "default_qty", "uom", "required", "status"];
  const body: unknown[][] = [headers, keys];
  for (const m of methods) {
    if (m.fields.length === 0) {
      body.push([m.category, m.name, m.kind, m.target_hours ?? "", "", "", "", "", "", "", m.status]);
    } else {
      for (const f of m.fields) {
        body.push([
          m.category,
          m.name,
          m.kind,
          m.target_hours ?? "",
          f.label,
          f.type,
          f.item_code ?? "",
          f.default_qty ?? "",
          f.uom ?? f.unit ?? "",
          f.required ? "TRUE" : "FALSE",
          m.status,
        ]);
      }
    }
  }
  downloadSheet(body, "PhuongPhapSOP", "oligo_sop_methods.xlsx");
}

function exportWorkflowsExcel(workflows: Workflow[], methods: Method[]) {
  const headers = ["Tên quy trình SOP *", "Áp dụng tinh sạch", "Mô tả", "Thứ tự bước *", "Nhóm bước", "Tên phương pháp *", "Tên bước hiển thị", "Trạng thái"];
  const keys = ["workflow_name", "purifications", "description", "step_order", "method_category", "method_name", "step_name", "status"];
  const body: unknown[][] = [headers, keys];
  for (const w of workflows) {
    w.steps.forEach((s, idx) => {
      const m = methods.find((x) => x.id === s.method_id);
      body.push([
        w.name,
        idx === 0 ? w.purifications.join(", ") : "",
        idx === 0 ? (w.description ?? "") : "",
        idx + 1,
        m?.category ?? "",
        m?.name ?? "",
        s.name ?? "",
        w.status,
      ]);
    });
  }
  downloadSheet(body, "QuyTrinhSOP", "oligo_sop_workflows.xlsx");
}

function MethodEditor({ base, isClone, onClose }: { base?: Method; isClone?: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const isEdit = Boolean(base && !isClone);
  const [m, setM] = useState({
    category: base?.category ?? "",
    name: isClone && base ? `${base.name} (Bản sao)` : (base?.name ?? ""),
    kind: base?.kind ?? "STANDARD",
    target_hours: base?.target_hours != null ? String(base.target_hours) : "",
    status: base?.status ?? "ACTIVE",
  });
  const [fields, setFields] = useState<StepField[]>(base?.fields ?? []);
  const save = useMutation({
    mutationFn: () => {
      const body = { ...m, target_hours: m.target_hours ? Number(m.target_hours) : null, fields: buildUniqueMethodFields(fields) };
      if (!isEdit) return api("/api/factory/oligo/sop/methods", { method: "POST", idempotent: true, json: body });
      const reason = window.prompt("Lý do sửa phương pháp:", "Cập nhật thông tin phương pháp SOP");
      if (reason === null) throw new Error("Đã hủy thao tác sửa.");
      return api(`/api/factory/oligo/sop/methods/${base!.id}`, {
        method: "PUT",
        json: { ...body, version: base!.version, reason: reason.trim() || "Cập nhật thông tin phương pháp SOP" },
      });
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
        <Field label="Nhóm bước *">
          <input
            className={inputClass}
            list="sop-categories"
            value={m.category}
            onChange={(e) => {
              const category = e.target.value;
              const norm = category.trim().toLowerCase();
              const autoQuant = (norm === "đo od" || norm === "do od") && m.kind === "STANDARD";
              setM({ ...m, category, ...(autoQuant ? { kind: "QUANTIFICATION" as const } : {}) });
            }}
            required
          />
        </Field>
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
      <datalist id="sop-categories">{["Cắt & khử bảo vệ", "Làm khô", "Tinh sạch", "Khử muối", "Đo OD", "QC", "Làm khô / đông khô", "Click chemistry", "Hoàn nguyên & chia ống"].map((c) => <option key={c} value={c} />)}</datalist>
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
              <ItemPicker
                value={f.item_id ?? ""}
                current={f.item_code ? `${f.item_code} · ${f.item_name ?? ""}` : undefined}
                onChange={(id) => setF(i, { item_id: id || null })}
              />
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

function WorkflowEditor({ base, isClone, methods, onClose }: { base?: Workflow; isClone?: boolean; methods: Method[]; onClose: () => void }) {
  const qc = useQueryClient();
  const isEdit = Boolean(base && !isClone);
  const [w, setW] = useState({
    name: isClone && base ? `${base.name} (Bản sao)` : (base?.name ?? ""),
    description: base?.description ?? "",
    purifications: isClone ? [] : (base?.purifications ?? []),
    status: base?.status ?? "ACTIVE",
  });
  const [steps, setSteps] = useState<{ method_id: string; name: string }[]>(base?.steps.map((s) => ({ method_id: s.method_id, name: s.name ?? "" })) ?? []);
  const save = useMutation({
    mutationFn: () => {
      const body = { ...w, steps: steps.map((s) => ({ method_id: s.method_id, name: s.name || null })) };
      if (!isEdit) return api("/api/factory/oligo/sop/workflows", { method: "POST", idempotent: true, json: body });
      const reason = window.prompt("Lý do sửa quy trình (các hồ sơ đang làm giữ bản cũ):", "Cập nhật quy trình SOP");
      if (reason === null) throw new Error("Đã hủy thao tác sửa.");
      return api(`/api/factory/oligo/sop/workflows/${base!.id}`, {
        method: "PUT",
        json: { ...body, version: base!.version, reason: reason.trim() || "Cập nhật quy trình SOP" },
      });
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
  const qc = useQueryClient();
  const me = useFactoryMe();
  const perms = new Set(me.data?.permissions ?? []);
  const hasSopManage = Boolean(
    canManage ||
      me.data?.is_root ||
      perms.has("oligo.sop.manage") ||
      perms.has("oligo.post.manage") ||
      perms.has("oligo.sop.edit")
  );
  const canEditSop = hasSopManage;
  const canDeleteSop = Boolean(hasSopManage || perms.has("oligo.sop.delete"));
  const canCreateOrClone = hasSopManage;

  const sop = useQuery({ queryKey: ["factory", "oligo-sop"], queryFn: () => api<{ methods: Method[]; workflows: Workflow[] }>("/api/factory/oligo/sop") });
  const [methodState, setMethodState] = useState<{ item?: Method; isClone?: boolean } | null>(null);
  const [workflowState, setWorkflowState] = useState<{ item?: Workflow; isClone?: boolean } | null>(null);
  const [methodQ, setMethodQ] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const methods = sop.data?.methods ?? [];
  const workflows = sop.data?.workflows ?? [];
  const nameOf = (id: string) => methods.find((m) => m.id === id)?.name ?? "?";

  const categoryCounts = React.useMemo(() => {
    const map = new Map<string, number>();
    for (const m of methods) {
      const cat = (m.category || "Khác").trim();
      map.set(cat, (map.get(cat) ?? 0) + 1);
    }
    return Array.from(map.entries());
  }, [methods]);

  const filteredMethods = React.useMemo(() => {
    const q = methodQ.trim().toLowerCase();
    return methods.filter((m) => {
      if (categoryFilter && (m.category || "Khác").trim() !== categoryFilter) return false;
      if (!q) return true;
      const fieldsStr = m.fields.map((f) => `${f.label} ${f.item_code ?? ""} ${f.unit ?? ""}`).join(" ");
      return `${m.category} ${m.name} ${fieldsStr}`.toLowerCase().includes(q);
    });
  }, [methods, methodQ, categoryFilter]);

  const deleteMethodMut = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api(`/api/factory/oligo/sop/methods/${id}`, { method: "DELETE", json: { reason } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["factory", "oligo-sop"] });
    },
  });

  const deleteWorkflowMut = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api(`/api/factory/oligo/sop/workflows/${id}`, { method: "DELETE", json: { reason } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["factory", "oligo-sop"] });
    },
  });

  return (
    <div className="flex flex-col gap-3">
      <ErrorNote error={sop.error ?? deleteMethodMut.error ?? deleteWorkflowMut.error} />
      <Card
        title="1. Thư viện phương pháp cho từng bước (Cắt & khử bảo vệ, Tinh sạch, Đo OD, Đông khô…)"
        actions={
          <div className="flex flex-wrap gap-1.5">
            {methods.length > 0 && (
              <Button type="button" variant="ghost" onClick={() => exportMethodsExcel(filteredMethods)}>
                📤 Xuất Excel (.xlsx)
              </Button>
            )}
            {canCreateOrClone && (
              <Button
                type="button"
                variant="ghost"
                onClick={() =>
                  openExcelImportTemplate({
                    templateKey: "OLIGO_POST_METHOD",
                    deptFilter: "P-OLIGO",
                    targetDeptCode: "P-OLIGO",
                    targetWarehouseCode: "KHO-OLIGO",
                  })
                }
              >
                📥 Nhập Excel Phương pháp ↗
              </Button>
            )}
            {canCreateOrClone && !methodState && (
              <Button type="button" onClick={() => setMethodState({})}>
                + Tạo phương pháp bước mới
              </Button>
            )}
          </div>
        }
      >
        {methodState && (
          <MethodEditor
            key={`${methodState.item?.id ?? "new"}-${methodState.isClone ? "clone" : "edit"}`}
            base={methodState.item}
            isClone={methodState.isClone}
            onClose={() => setMethodState(null)}
          />
        )}
        {methods.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3 p-2 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50">
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => setCategoryFilter("")}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition-colors cursor-pointer ${
                  categoryFilter === ""
                    ? "bg-sky-700 text-white border-sky-700"
                    : "bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-100"
                }`}
              >
                Tất cả ({methods.length})
              </button>
              {categoryCounts.map(([cat, cnt]) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setCategoryFilter(categoryFilter === cat ? "" : cat)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition-colors cursor-pointer ${
                    categoryFilter === cat
                      ? "bg-sky-700 text-white border-sky-700"
                      : "bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-100"
                  }`}
                >
                  {cat} ({cnt})
                </button>
              ))}
            </div>
            <input
              className={`${inputClass} w-72`}
              placeholder="🔍 Tìm tên phương pháp, nhóm bước, mã hóa chất..."
              value={methodQ}
              onChange={(e) => setMethodQ(e.target.value)}
            />
          </div>
        )}
        {sop.data && methods.length === 0 && !methodState && (
          <Empty>
            <div className="flex flex-col items-center gap-2">
              <span>Chưa có phương pháp. Thêm các bước như cắt &amp; khử bảo vệ, tinh sạch HPLC/PAGE/OPC, đo OD.</span>
              {canCreateOrClone && <Button type="button" onClick={() => setMethodState({})}>+ Tạo phương pháp bước đầu tiên</Button>}
            </div>
          </Empty>
        )}
        {methods.length > 0 && filteredMethods.length === 0 && (
          <Empty>Không tìm thấy phương pháp nào khớp từ khóa hoặc nhóm bước đang chọn.</Empty>
        )}
        {filteredMethods.length > 0 && (
          <Table head={["Nhóm bước", "Phương pháp", "Thời gian chuẩn", "Thông số ghi", "Trạng thái", "Thao tác"]}>
            {filteredMethods.map((m) => (
              <tr key={m.id} className={m.status === "ACTIVE" ? "" : "opacity-50"}>
                <td className="py-1.5 pr-3 text-xs">{m.category}</td>
                <td className="py-1.5 pr-3">{m.name}{m.kind === "QUANTIFICATION" && <span className="text-sky-700 dark:text-sky-400 text-xs"> · đo OD</span>}</td>
                <td className="py-1.5 pr-3 text-xs">{m.target_hours ? `${m.target_hours} giờ` : "—"}</td>
                <td className="py-1.5 pr-3 text-xs">
                  {m.fields
                    .map((f) =>
                      f.type === "REAGENT"
                        ? `${f.label} (${f.item_code || FIELD_TYPE[f.type]}${f.default_qty != null ? `: ${f.default_qty} ${f.uom ?? ""}` : ""})`
                        : `${f.label} (${FIELD_TYPE[f.type]}${f.unit ? ` ${f.unit}` : ""})`
                    )
                    .join(" · ") || "—"}
                </td>
                <td className="py-1.5 pr-3 text-xs">{m.status === "ACTIVE" ? "Đang dùng" : "Ngừng"}</td>
                <td className="py-1.5 pr-3 text-right whitespace-nowrap">
                  <div className="inline-flex items-center gap-1">
                    {canEditSop && (
                      <Button type="button" variant="ghost" onClick={() => setMethodState({ item: m })}>Sửa</Button>
                    )}
                    {canCreateOrClone && (
                      <Button type="button" variant="ghost" onClick={() => setMethodState({ item: m, isClone: true })}>Nhân bản</Button>
                    )}
                    {canDeleteSop && (
                      <Button
                        type="button"
                        variant="ghost"
                        className="text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/50"
                        disabled={deleteMethodMut.isPending}
                        onClick={() => {
                          const reason = window.prompt(
                            `Nhập lý do xóa phương pháp "${m.name}" (${m.category}):`,
                            "Xóa phương pháp không còn sử dụng"
                          );
                          if (!reason || reason.trim().length < 3) return;
                          deleteMethodMut.mutate({ id: m.id, reason: reason.trim() });
                        }}
                      >
                        Xóa
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <Card
        title="2. Quy trình SOP sau tổng hợp (ghép các phương pháp theo thứ tự)"
        actions={
          <div className="flex flex-wrap gap-1.5">
            {workflows.length > 0 && (
              <Button type="button" variant="ghost" onClick={() => exportWorkflowsExcel(workflows, methods)}>
                📤 Xuất Excel (.xlsx)
              </Button>
            )}
            {canManage && (
              <Button
                type="button"
                variant="ghost"
                onClick={() =>
                  openExcelImportTemplate({
                    templateKey: "OLIGO_POST_WORKFLOW",
                    deptFilter: "P-OLIGO",
                    targetDeptCode: "P-OLIGO",
                    targetWarehouseCode: "KHO-OLIGO",
                  })
                }
              >
                📥 Nhập Excel Quy trình ↗
              </Button>
            )}
            {canManage && !workflowState && (
              <Button type="button" onClick={() => setWorkflowState({})}>
                + Tạo quy trình SOP mới
              </Button>
            )}
          </div>
        }
      >
        {workflowState && (
          <WorkflowEditor
            key={`${workflowState.item?.id ?? "new"}-${workflowState.isClone ? "clone" : "edit"}`}
            base={workflowState.item}
            isClone={workflowState.isClone}
            methods={methods}
            onClose={() => setWorkflowState(null)}
          />
        )}
        {sop.data && workflows.length === 0 && !workflowState && (
          <Empty>
            <div className="flex flex-col items-center gap-2">
              <span>Chưa có quy trình SOP hậu tổng hợp.</span>
              {canManage && <Button type="button" onClick={() => setWorkflowState({})}>+ Tạo quy trình SOP đầu tiên</Button>}
            </div>
          </Empty>
        )}
        {workflows.length > 0 && (
          <Table head={["Quy trình", "Mặc định cho", "Các bước", "Phiên bản", "Trạng thái", ""]}>
            {workflows.map((w) => (
              <tr key={w.id} className={w.status === "ACTIVE" ? "" : "opacity-50"}>
                <td className="py-1.5 pr-3">{w.name}{w.description && <div className="text-[11px] text-slate-500">{w.description}</div>}</td>
                <td className="py-1.5 pr-3 text-xs">{w.purifications.map((p) => PURIFICATION[p as keyof typeof PURIFICATION]).join(", ") || "—"}</td>
                <td className="py-1.5 pr-3 text-xs">{w.steps.map((s, i) => `${i + 1}. ${s.name || nameOf(s.method_id)}`).join(" → ")}</td>
                <td className="py-1.5 pr-3 text-xs">rev {w.revision}</td>
                <td className="py-1.5 pr-3 text-xs">{w.status === "ACTIVE" ? "Đang dùng" : "Ngừng"}</td>
                <td className="py-1.5 pr-3 text-right whitespace-nowrap">
                  <div className="inline-flex items-center gap-1">
                    {canEditSop && (
                      <Button type="button" variant="ghost" onClick={() => setWorkflowState({ item: w })}>Sửa</Button>
                    )}
                    {canCreateOrClone && (
                      <Button type="button" variant="ghost" onClick={() => setWorkflowState({ item: w, isClone: true })}>Nhân bản</Button>
                    )}
                    {canDeleteSop && (
                      <Button
                        type="button"
                        variant="ghost"
                        className="text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/50"
                        disabled={deleteWorkflowMut.isPending}
                        onClick={() => {
                          const reason = window.prompt(
                            `Nhập lý do xóa quy trình SOP "${w.name}":`,
                            "Xóa quy trình SOP không còn sử dụng"
                          );
                          if (!reason || reason.trim().length < 3) return;
                          deleteWorkflowMut.mutate({ id: w.id, reason: reason.trim() });
                        }}
                      >
                        Xóa
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}

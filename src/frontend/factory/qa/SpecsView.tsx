"use client";

import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ActionBar, type AllowedAction } from "../actions";
import { api, useFactoryMe } from "../api";
import { Button, Card, Empty, ErrorNote, Field, inputClass, StatusBadge, Table } from "../ui";

interface SpecRow {
  id: string;
  code: string;
  spec_version: number;
  name: string;
  applies_to: string;
  status: string;
  item_code: string | null;
  item_name: string | null;
  parameter_count: number;
}
interface Param {
  name: string;
  method: string;
  unit: string;
  value_type: "NUMERIC" | "TEXT" | "PASS_FAIL";
  lower_limit: string;
  upper_limit: string;
  target: string;
  is_critical: boolean;
  derived_metric: string;
  oligo_purifications: string[];
}
interface SpecDetail extends SpecRow {
  version: number;
  item_id: string | null;
  notes: string | null;
  parameters: (Omit<Param, "lower_limit" | "upper_limit" | "derived_metric" | "oligo_purifications"> & {
    lower_limit: string | null;
    upper_limit: string | null;
    derived_metric: string | null;
    oligo_purifications: string[] | null;
  })[];
  actions: AllowedAction[];
}

const APPLIES: Record<string, string> = { ITEM: "Vật tư (chung)", RECEIPT: "Kiểm tra đầu vào", PRODUCT: "Thành phẩm", OLIGO: "Oligo", DEVICE_MODEL: "Model thiết bị" };
const SPEC_STATUS: Record<string, [string, string]> = { DRAFT: ["PENDING_QC", "Bản nháp"], EFFECTIVE: ["RELEASED", "Hiệu lực"], OBSOLETE: ["EXPIRED", "Hết hiệu lực"] };
const ACTION_LABEL = { approve: "Phê duyệt cho hiệu lực", obsolete: "Ngừng hiệu lực" };
const blankParam = (): Param => ({ name: "", method: "", unit: "", value_type: "NUMERIC", lower_limit: "", upper_limit: "", target: "", is_critical: true, derived_metric: "", oligo_purifications: [] });
const NEEDS_ITEM = ["ITEM", "RECEIPT", "PRODUCT"];
/** Oligo: values the server computes from the sequence instead of the analyst typing them. */
const DERIVED: Record<string, string> = {
  "": "Kiểm nghiệm viên nhập",
  MW_DELTA_DA: "ΔMW = MW đo − MW lý thuyết (Da)",
  OD_TOTAL: "Tổng OD260 (từ hậu tổng hợp)",
  YIELD_NMOL: "nmol (từ hậu tổng hợp)",
  YIELD_UG: "µg (từ hậu tổng hợp)",
};
const PURIFICATIONS = ["DESALT", "OPC", "HPLC", "PAGE"];

function SpecEditor({ base, mode, onClose }: { base?: SpecDetail; mode: "new" | "revision" | "edit"; onClose: () => void }) {
  const qc = useQueryClient();
  const [head, setHead] = useState({ name: base?.name ?? "", applies_to: base?.applies_to ?? "ITEM", item_id: base?.item_id ?? "", notes: base?.notes ?? "" });
  const [params, setParams] = useState<Param[]>(
    base?.parameters.map((p) => ({ ...p, method: p.method ?? "", unit: p.unit ?? "", target: p.target ?? "", derived_metric: p.derived_metric ?? "", oligo_purifications: p.oligo_purifications ?? [], lower_limit: p.lower_limit == null ? "" : String(Number(p.lower_limit)), upper_limit: p.upper_limit == null ? "" : String(Number(p.upper_limit)) })) ?? [blankParam()]
  );
  const [q, setQ] = useState("");
  const items = useQuery({
    queryKey: ["factory", "items", "picker", q],
    queryFn: () => api<{ rows: { id: string; code: string; name: string }[] }>(`/api/factory/master/items?page_size=50&q=${encodeURIComponent(q)}`),
    enabled: mode === "new" && NEEDS_ITEM.includes(head.applies_to),
  });
  const save = useMutation({
    mutationFn: () => {
      const body = {
        ...head,
        item_id: head.item_id || null,
        parameters: params.map((p) => ({
          ...p,
          lower_limit: p.value_type === "NUMERIC" && p.lower_limit !== "" ? Number(p.lower_limit) : null,
          upper_limit: p.value_type === "NUMERIC" && p.upper_limit !== "" ? Number(p.upper_limit) : null,
          target: p.target || null,
          derived_metric: head.applies_to === "OLIGO" && p.derived_metric ? p.derived_metric : null,
          oligo_purifications: head.applies_to === "OLIGO" && p.oligo_purifications.length ? p.oligo_purifications : null,
        })),
      };
      if (mode === "edit") return api(`/api/factory/qms/specs/${base!.id}`, { method: "PATCH", json: { ...body, version: base!.version } });
      return api("/api/factory/qms/specs", { method: "POST", idempotent: true, json: mode === "revision" ? { ...body, from_code: base!.code } : body });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["factory", "specs"] });
      qc.invalidateQueries({ queryKey: ["factory", "spec"] });
      onClose();
    },
  });
  const setP = (i: number, patch: Partial<Param>) => setParams(params.map((p, j) => (j === i ? { ...p, ...patch } : p)));

  return (
    <Card title={mode === "new" ? "Tiêu chuẩn QC mới" : mode === "revision" ? `Phiên bản mới của ${base!.code}` : `Sửa bản nháp ${base!.code}`}>
      <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Tên tiêu chuẩn *"><input className={inputClass} value={head.name} onChange={(e) => setHead({ ...head, name: e.target.value })} required /></Field>
          <Field label="Áp dụng cho">
            <select className={inputClass} value={head.applies_to} disabled={mode !== "new"} onChange={(e) => setHead({ ...head, applies_to: e.target.value })}>
              {Object.entries(APPLIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          {!NEEDS_ITEM.includes(head.applies_to) ? null : mode === "new" ? (
            <Field label="Vật tư *">
              <input className={inputClass} placeholder="Tìm mã / tên vật tư…" value={q} onChange={(e) => setQ(e.target.value)} />
              <select className={inputClass} value={head.item_id} onChange={(e) => setHead({ ...head, item_id: e.target.value })}>
                <option value="">Chọn vật tư</option>
                {items.data?.rows.map((i) => <option key={i.id} value={i.id}>{i.code} — {i.name}</option>)}
              </select>
            </Field>
          ) : (
            <Field label="Vật tư"><input className={inputClass} value={`${base!.item_code ?? ""} ${base!.item_name ?? ""}`} disabled /></Field>
          )}
        </div>
        <div className="flex flex-col gap-2">
          {params.map((p, i) => (
            <div key={i} className="grid gap-2 grid-cols-2 lg:grid-cols-8 items-end p-2 rounded-xl border border-slate-200 dark:border-slate-800">
              <Field label={`Chỉ tiêu ${i + 1} *`}><input className={inputClass} value={p.name} onChange={(e) => setP(i, { name: e.target.value })} required /></Field>
              <Field label="Phương pháp"><input className={inputClass} value={p.method} onChange={(e) => setP(i, { method: e.target.value })} /></Field>
              <Field label="Kiểu">
                <select className={inputClass} value={p.value_type} onChange={(e) => setP(i, { value_type: e.target.value as Param["value_type"] })}>
                  <option value="NUMERIC">Số</option>
                  <option value="PASS_FAIL">Đạt / Không đạt</option>
                  <option value="TEXT">Mô tả</option>
                </select>
              </Field>
              <Field label="Đơn vị"><input className={inputClass} value={p.unit} onChange={(e) => setP(i, { unit: e.target.value })} /></Field>
              <Field label="Min"><input className={inputClass} inputMode="decimal" disabled={p.value_type !== "NUMERIC"} value={p.lower_limit} onChange={(e) => setP(i, { lower_limit: e.target.value })} /></Field>
              <Field label="Max"><input className={inputClass} inputMode="decimal" disabled={p.value_type !== "NUMERIC"} value={p.upper_limit} onChange={(e) => setP(i, { upper_limit: e.target.value })} /></Field>
              <Field label="Mô tả đạt"><input className={inputClass} disabled={p.value_type !== "TEXT"} value={p.target} onChange={(e) => setP(i, { target: e.target.value })} /></Field>
              <div className="flex items-center gap-2 pb-2">
                <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={p.is_critical} onChange={(e) => setP(i, { is_critical: e.target.checked })} />Bắt buộc</label>
                {params.length > 1 && <button type="button" className="text-rose-600 text-xs cursor-pointer" onClick={() => setParams(params.filter((_, j) => j !== i))}>Xóa</button>}
              </div>
              {head.applies_to === "OLIGO" && (
                <div className="col-span-2 lg:col-span-8 flex flex-wrap items-center gap-3 text-xs">
                  <select className={`${inputClass} w-72`} value={p.derived_metric} disabled={p.value_type !== "NUMERIC"} onChange={(e) => setP(i, { derived_metric: e.target.value })} aria-label="Cách lấy giá trị">
                    {Object.entries(DERIVED).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                  <span className="text-slate-500">Chỉ áp dụng cho tinh sạch (bỏ trống = mọi loại):</span>
                  {PURIFICATIONS.map((pu) => (
                    <label key={pu} className="flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={p.oligo_purifications.includes(pu)}
                        onChange={(e) => setP(i, { oligo_purifications: e.target.checked ? [...p.oligo_purifications, pu] : p.oligo_purifications.filter((x) => x !== pu) })}
                      />
                      {pu}
                    </label>
                  ))}
                </div>
              )}
            </div>
          ))}
          <div><Button type="button" variant="ghost" onClick={() => setParams([...params, blankParam()])}>+ Thêm chỉ tiêu</Button></div>
        </div>
        <ErrorNote error={save.error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Hủy</Button>
          <Button type="submit" disabled={save.isPending}>{save.isPending ? "Đang lưu…" : "Lưu bản nháp"}</Button>
        </div>
      </form>
    </Card>
  );
}

function SpecDetailPanel({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();
  const me = useFactoryMe();
  const [editing, setEditing] = useState<"revision" | "edit" | null>(null);
  const spec = useQuery({ queryKey: ["factory", "spec", id], queryFn: () => api<SpecDetail>(`/api/factory/qms/specs/${id}`) });
  const s = spec.data;
  const canManage = me.data?.permissions.includes("qms.spec.manage");
  if (s && editing) return <SpecEditor base={s} mode={editing} onClose={() => setEditing(null)} />;
  return (
    <Card title={s ? `${s.code} rev ${s.spec_version} — ${s.name}` : "Tiêu chuẩn"} actions={<Button variant="ghost" onClick={onClose}>Đóng</Button>}>
      <ErrorNote error={spec.error} />
      {s && (
        <div className="flex flex-col gap-3">
          <p className="text-xs text-slate-600 dark:text-slate-300">
            {APPLIES[s.applies_to]} · {s.item_code} {s.item_name} · <StatusBadge status={SPEC_STATUS[s.status][0]} label={SPEC_STATUS[s.status][1]} />
          </p>
          <Table head={["#", "Chỉ tiêu", "Phương pháp", "Yêu cầu", "Bắt buộc"]}>
            {s.parameters.map((p, i) => (
              <tr key={i}>
                <td className="py-2 pr-3">{i + 1}</td>
                <td className="py-2 pr-3">
                  {p.name}
                  {(p.derived_metric || p.oligo_purifications?.length) && (
                    <div className="text-[11px] text-slate-500">
                      {[p.derived_metric && DERIVED[p.derived_metric], p.oligo_purifications?.length && `chỉ ${p.oligo_purifications.join(", ")}`].filter(Boolean).join(" · ")}
                    </div>
                  )}
                </td>
                <td className="py-2 pr-3">{p.method || "—"}</td>
                <td className="py-2 pr-3">
                  {p.value_type === "NUMERIC" ? [p.lower_limit != null && `≥ ${Number(p.lower_limit)}`, p.upper_limit != null && `≤ ${Number(p.upper_limit)}`].filter(Boolean).join(", ") || "—" : p.value_type === "PASS_FAIL" ? "Đạt" : p.target || "—"} {p.unit}
                </td>
                <td className="py-2 pr-3">{p.is_critical ? "Có" : "Không"}</td>
              </tr>
            ))}
          </Table>
          <ActionBar endpoint={`/api/factory/qms/specs/${s.id}/actions`} version={s.version} actions={s.actions} labels={ACTION_LABEL} onDone={() => { qc.invalidateQueries({ queryKey: ["factory", "spec", id] }); qc.invalidateQueries({ queryKey: ["factory", "specs"] }); }} />
          {canManage && (
            <div className="flex gap-2">
              {s.status === "DRAFT" && <Button variant="ghost" onClick={() => setEditing("edit")}>Sửa bản nháp</Button>}
              {s.status === "EFFECTIVE" && <Button variant="ghost" onClick={() => setEditing("revision")}>Tạo phiên bản mới</Button>}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

export function SpecsView() {
  const me = useFactoryMe();
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const specs = useQuery({ queryKey: ["factory", "specs"], queryFn: () => api<SpecRow[]>("/api/factory/qms/specs") });
  return (
    <div className="flex flex-col gap-3">
      {creating && <SpecEditor mode="new" onClose={() => setCreating(false)} />}
      {selected && !creating && <SpecDetailPanel key={selected} id={selected} onClose={() => setSelected(null)} />}
      <Card title="Tiêu chuẩn QC" actions={me.data?.permissions.includes("qms.spec.manage") && !creating && <Button onClick={() => setCreating(true)}>+ Tiêu chuẩn mới</Button>}>
        <ErrorNote error={specs.error} />
        {specs.data?.length === 0 && <Empty>Chưa có tiêu chuẩn QC. Không có tiêu chuẩn hiệu lực thì không lấy mẫu QC được.</Empty>}
        {specs.data && specs.data.length > 0 && (
          <Table head={["Mã", "Rev", "Tên", "Áp dụng", "Vật tư", "Chỉ tiêu", "Trạng thái"]}>
            {specs.data.map((s) => (
              <tr key={s.id} className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50" onClick={() => setSelected(s.id)}>
                <td className="py-2 pr-3 font-mono font-semibold text-sky-700 dark:text-sky-400">{s.code}</td>
                <td className="py-2 pr-3">{s.spec_version}</td>
                <td className="py-2 pr-3">{s.name}</td>
                <td className="py-2 pr-3">{APPLIES[s.applies_to]}</td>
                <td className="py-2 pr-3">{s.item_code ? `${s.item_code} ${s.item_name}` : "—"}</td>
                <td className="py-2 pr-3">{s.parameter_count}</td>
                <td className="py-2 pr-3"><StatusBadge status={SPEC_STATUS[s.status][0]} label={SPEC_STATUS[s.status][1]} /></td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}

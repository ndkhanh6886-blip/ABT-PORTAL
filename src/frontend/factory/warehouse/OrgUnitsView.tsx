"use client";

import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { Button, Card, Empty, ErrorNote, Field, inputClass, Table } from "../ui";

interface OrgUnit {
  id: string;
  code: string;
  name: string;
  unit_type: "COMPANY" | "DEPARTMENT" | "TEAM";
  parent_id: string | null;
  module_key: string | null;
}

const TYPE_LABEL = { COMPANY: "Công ty", DEPARTMENT: "Phòng ban", TEAM: "Tổ / nhóm" };
const MODULE_LABEL: Record<string, string> = {
  RD: "R&D",
  KIT: "Sản xuất Kit",
  OLIGO: "Tổng hợp Oligo",
  DEVICE: "Kỹ thuật-Công nghệ (thiết bị)",
  QA: "QA/QC",
  WH: "Kho",
  PURCHASE: "Cung ứng NVL",
  SALES: "Kinh doanh",
  HR: "Nhân sự",
  BOD: "Ban giám đốc",
};

/** Org structure of the factory: the owner of warehouses and the scope of roles. */
export function OrgUnitsView() {
  const qc = useQueryClient();
  const units = useQuery({ queryKey: ["factory", "org-units"], queryFn: () => api<OrgUnit[]>("/api/factory/org-units") });
  const [form, setForm] = useState({ code: "", name: "", unit_type: "DEPARTMENT", parent_id: "", module_key: "" });
  const create = useMutation({
    mutationFn: () =>
      api("/api/factory/org-units", { method: "POST", json: { ...form, parent_id: form.parent_id || null, module_key: form.module_key || null } }),
    onSuccess: () => {
      setForm({ code: "", name: "", unit_type: "DEPARTMENT", parent_id: "", module_key: "" });
      qc.invalidateQueries({ queryKey: ["factory", "org-units"] });
    },
  });
  const byId = new Map(units.data?.map((u) => [u.id, u]) ?? []);

  return (
    <Card title="Cơ cấu tổ chức nhà máy">
      <form
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6 items-end mb-4 p-3 rounded-xl bg-slate-50 dark:bg-slate-950/50 border border-slate-200 dark:border-slate-800"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <Field label="Mã *"><input className={inputClass} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} required /></Field>
        <Field label="Tên *"><input className={inputClass} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></Field>
        <Field label="Cấp">
          <select className={inputClass} value={form.unit_type} onChange={(e) => setForm({ ...form, unit_type: e.target.value })}>
            {Object.entries(TYPE_LABEL).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </Field>
        <Field label="Thuộc đơn vị">
          <select className={inputClass} value={form.parent_id} onChange={(e) => setForm({ ...form, parent_id: e.target.value })}>
            <option value="">— (cấp công ty)</option>
            {units.data?.map((u) => (
              <option key={u.id} value={u.id}>{u.code} — {u.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Phân hệ" hint="Định tuyến công việc và thẻ Điều hành">
          <select className={inputClass} value={form.module_key} onChange={(e) => setForm({ ...form, module_key: e.target.value })}>
            <option value="">—</option>
            {Object.entries(MODULE_LABEL).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </Field>
        <Button type="submit" disabled={create.isPending}>+ Thêm đơn vị</Button>
        <div className="sm:col-span-2 lg:col-span-6"><ErrorNote error={create.error} /></div>
      </form>
      <ErrorNote error={units.error} />
      {units.data?.length === 0 && <Empty>Chưa có đơn vị nào. Bắt đầu bằng đơn vị cấp Công ty, sau đó các phòng ban.</Empty>}
      {units.data && units.data.length > 0 && (
        <Table head={["Mã", "Tên", "Cấp", "Thuộc", "Phân hệ"]}>
          {units.data.map((u) => (
            <tr key={u.id}>
              <td className="py-2 pr-3 font-mono font-semibold">{u.code}</td>
              <td className="py-2 pr-3">{u.name}</td>
              <td className="py-2 pr-3">{TYPE_LABEL[u.unit_type]}</td>
              <td className="py-2 pr-3">{u.parent_id ? byId.get(u.parent_id)?.name ?? "—" : "—"}</td>
              <td className="py-2 pr-3">{u.module_key ? MODULE_LABEL[u.module_key] : "—"}</td>
            </tr>
          ))}
        </Table>
      )}
    </Card>
  );
}

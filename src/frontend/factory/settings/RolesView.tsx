"use client";

import React, { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { Button, Card, Empty, ErrorNote, Field, inputClass } from "../ui";

export interface Role {
  id: string;
  code: string;
  name: string;
  description: string | null;
  status: string;
  version: number;
  permissions: string[];
  holders: number;
}
interface Permission {
  code: string;
  module: string;
  description: string;
  is_gxp_critical: boolean;
}

const MODULE_LABEL: Record<string, string> = { core: "Quản trị", master: "Danh mục chủ", inv: "Kho" };

function PermissionPicker({ catalogue, value, onChange }: { catalogue: Permission[]; value: string[]; onChange: (v: string[]) => void }) {
  const groups = useMemo(() => {
    const m = new Map<string, Permission[]>();
    for (const p of catalogue) m.set(p.module, [...(m.get(p.module) ?? []), p]);
    return [...m.entries()];
  }, [catalogue]);
  const toggle = (code: string) => onChange(value.includes(code) ? value.filter((c) => c !== code) : [...value, code]);
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {groups.map(([module, perms]) => (
        <fieldset key={module} className="rounded-xl border border-slate-200 dark:border-slate-800 p-3">
          <legend className="px-1 text-xs font-bold text-slate-600 dark:text-slate-300">{MODULE_LABEL[module] ?? module}</legend>
          {perms.map((p) => (
            <label key={p.code} className="flex items-start gap-2 py-1 text-xs text-slate-700 dark:text-slate-200">
              <input type="checkbox" className="mt-0.5" checked={value.includes(p.code)} onChange={() => toggle(p.code)} />
              <span>
                {p.description}
                {p.is_gxp_critical && <span className="ml-1 text-[10px] font-bold text-rose-600 dark:text-rose-400">GMP</span>}
                <span className="block font-mono text-[10px] text-slate-400">{p.code}</span>
              </span>
            </label>
          ))}
        </fieldset>
      ))}
    </div>
  );
}

function RoleEditor({ role, catalogue, onClose }: { role: Role | null; catalogue: Permission[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ code: role?.code ?? "", name: role?.name ?? "", description: role?.description ?? "", permissions: role?.permissions ?? [], reason: "" });
  const save = useMutation({
    mutationFn: () =>
      role
        ? api(`/api/factory/roles/${role.id}`, { method: "PATCH", json: { version: role.version, name: form.name, description: form.description, permissions: form.permissions, reason: form.reason } })
        : api("/api/factory/roles", { method: "POST", idempotent: true, json: { code: form.code, name: form.name, description: form.description, permissions: form.permissions } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["factory", "roles"] });
      qc.invalidateQueries({ queryKey: ["factory", "me"] });
      onClose();
    },
  });
  return (
    <form
      className="flex flex-col gap-3 mb-4 p-3 rounded-xl bg-slate-50 dark:bg-slate-950/50 border border-slate-200 dark:border-slate-800"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Mã vai trò *"><input className={inputClass} value={form.code} disabled={Boolean(role)} onChange={(e) => setForm({ ...form, code: e.target.value })} required /></Field>
        <Field label="Tên *"><input className={inputClass} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></Field>
        <Field label="Mô tả"><input className={inputClass} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
      </div>
      <PermissionPicker catalogue={catalogue} value={form.permissions} onChange={(permissions) => setForm({ ...form, permissions })} />
      {role && (
        <Field label="Lý do thay đổi *" hint={`Áp dụng ngay cho ${role.holders} người đang giữ vai trò; được ghi vào audit trail.`}>
          <input className={inputClass} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} required />
        </Field>
      )}
      <ErrorNote error={save.error} />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onClose}>Hủy</Button>
        <Button type="submit" disabled={save.isPending}>{save.isPending ? "Đang lưu…" : "Lưu vai trò"}</Button>
      </div>
    </form>
  );
}

export function RolesView() {
  const roles = useQuery({ queryKey: ["factory", "roles"], queryFn: () => api<Role[]>("/api/factory/roles") });
  const catalogue = useQuery({ queryKey: ["factory", "permissions"], queryFn: () => api<Permission[]>("/api/factory/permissions") });
  const [editing, setEditing] = useState<Role | "new" | null>(null);
  const describe = new Map(catalogue.data?.map((p) => [p.code, p.description]) ?? []);

  return (
    <Card title="Vai trò" actions={editing === null && <Button onClick={() => setEditing("new")}>+ Vai trò mới</Button>}>
      {editing !== null && catalogue.data && (
        <RoleEditor key={editing === "new" ? "new" : editing.id} role={editing === "new" ? null : editing} catalogue={catalogue.data} onClose={() => setEditing(null)} />
      )}
      <ErrorNote error={roles.error ?? catalogue.error} />
      {roles.data?.length === 0 && <Empty>Chưa có vai trò. Chạy npm run factory:migrate để tạo các vai trò mặc định.</Empty>}
      <div className="grid gap-3 md:grid-cols-2">
        {roles.data?.map((r) => (
          <div key={r.id} className="rounded-xl border border-slate-200 dark:border-slate-800 p-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-sm font-bold text-slate-800 dark:text-slate-100">{r.name}</div>
                <div className="font-mono text-[11px] text-slate-400">{r.code} · {r.holders} người giữ</div>
              </div>
              <Button variant="ghost" onClick={() => setEditing(r)}>Sửa</Button>
            </div>
            {r.description && <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{r.description}</p>}
            <ul className="mt-2 flex flex-wrap gap-1">
              {r.permissions.map((p) => (
                <li key={p} className="px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-[11px] text-slate-600 dark:text-slate-300">
                  {describe.get(p) ?? p}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Card>
  );
}

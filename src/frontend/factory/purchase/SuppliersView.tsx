"use client";

import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { Button, Card, Empty, ErrorNote, Field, inputClass, Table } from "../ui";

interface Partner {
  id: string;
  code: string;
  name: string;
  tax_code: string | null;
  is_supplier: boolean;
  is_subcontractor: boolean;
  address: string | null;
  payment_terms: string | null;
}

/** Suppliers and subcontractors of the factory (separate from the Kinh doanh supplier list in ABT Portal). */
export function SuppliersView({ canManage }: { canManage: boolean }) {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [form, setForm] = useState({ code: "", name: "", tax_code: "", address: "", payment_terms: "", is_supplier: true, is_subcontractor: false });
  const list = useQuery({ queryKey: ["factory", "partners", "all", q], queryFn: () => api<Partner[]>(`/api/factory/master/partners?q=${encodeURIComponent(q)}`) });
  const create = useMutation({
    mutationFn: () => api("/api/factory/master/partners", { method: "POST", idempotent: true, json: { ...form, code: form.code || undefined, tax_code: form.tax_code || null } }),
    onSuccess: () => {
      setForm({ code: "", name: "", tax_code: "", address: "", payment_terms: "", is_supplier: true, is_subcontractor: false });
      qc.invalidateQueries({ queryKey: ["factory", "partners"] });
    },
  });
  return (
    <Card title="Nhà cung cấp và đơn vị gia công" actions={<input className={`${inputClass} w-60`} placeholder="Tìm mã, tên, MST…" value={q} onChange={(e) => setQ(e.target.value)} />}>
      {canManage && (
        <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 items-end mb-4 p-3 rounded-xl bg-slate-50 dark:bg-slate-950/50 border border-slate-200 dark:border-slate-800" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
          <Field label="Mã" hint="Để trống: tự cấp (DT0001…)"><input className={inputClass} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} /></Field>
          <Field label="Tên *"><input className={inputClass} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></Field>
          <Field label="Mã số thuế"><input className={inputClass} value={form.tax_code} onChange={(e) => setForm({ ...form, tax_code: e.target.value })} /></Field>
          <Field label="Điều khoản thanh toán"><input className={inputClass} value={form.payment_terms} onChange={(e) => setForm({ ...form, payment_terms: e.target.value })} /></Field>
          <Field label="Địa chỉ"><input className={inputClass} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></Field>
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={form.is_supplier} onChange={(e) => setForm({ ...form, is_supplier: e.target.checked })} />Nhà cung cấp</label>
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={form.is_subcontractor} onChange={(e) => setForm({ ...form, is_subcontractor: e.target.checked })} />Gia công ngoài</label>
          <Button type="submit" disabled={create.isPending}>+ Thêm đối tác</Button>
          <div className="sm:col-span-2 lg:col-span-4"><ErrorNote error={create.error} /></div>
        </form>
      )}
      <ErrorNote error={list.error} />
      {list.data?.length === 0 && <Empty>Chưa có đối tác.</Empty>}
      {list.data && list.data.length > 0 && (
        <Table head={["Mã", "Tên", "MST", "Vai trò", "Thanh toán", "Địa chỉ"]}>
          {list.data.map((p) => (
            <tr key={p.id}>
              <td className="py-2 pr-3 font-mono font-semibold">{p.code}</td>
              <td className="py-2 pr-3">{p.name}</td>
              <td className="py-2 pr-3">{p.tax_code ?? "—"}</td>
              <td className="py-2 pr-3">{[p.is_supplier && "NCC", p.is_subcontractor && "Gia công"].filter(Boolean).join(", ") || "—"}</td>
              <td className="py-2 pr-3">{p.payment_terms ?? "—"}</td>
              <td className="py-2 pr-3">{p.address ?? "—"}</td>
            </tr>
          ))}
        </Table>
      )}
    </Card>
  );
}

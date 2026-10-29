"use client";

import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { Button, Card, ErrorNote, Field, inputClass, StatusBadge, Table } from "../ui";

interface Entry {
  id: string;
  code: string;
  name: string;
  kind: string;
  base_letter: string | null;
  nn_role: string;
  mw: number | null;
  mw_delta: number | null;
  ext_coeff_260: number;
  aliases: string[];
  position_type: string;
  status: string;
  version: number;
}

const KIND: Record<string, string> = {
  BASE: "Base", LNA: "LNA (+N)", OME: "2'-OMe (mN)", F2: "2'-F (fN)", METHYL: "5-Methyl", DYE: "Thuốc nhuộm", QUENCHER: "Quencher", MODIFIER: "Biến đổi", SPACER: "Spacer",
};
const POSITION: Record<string, string> = { ANY: "Bất kỳ", "5PRIME": "Đầu 5'", "3PRIME": "Đầu 3'", INTERNAL: "Bên trong" };

function EditRow({ e, onDone }: { e: Entry; onDone: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    name: e.name,
    mw: e.mw == null ? "" : String(e.mw),
    mw_delta: e.mw_delta == null ? "" : String(e.mw_delta),
    ext: String(e.ext_coeff_260),
    aliases: e.aliases.join(", "),
    position_type: e.position_type,
    reason: "",
  });
  const save = useMutation({
    mutationFn: () =>
      api(`/api/factory/oligo/modifications/${e.id}`, {
        method: "PATCH",
        json: {
          version: e.version,
          reason: form.reason,
          name: form.name,
          ...(e.mw != null ? { mw: Number(form.mw) } : { mw_delta: Number(form.mw_delta) }),
          ext_coeff_260: Number(form.ext),
          aliases: form.aliases.split(/[,;\s]+/).filter(Boolean),
          position_type: form.position_type,
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["factory", "oligo-catalog"] });
      onDone();
    },
  });
  return (
    <tr>
      <td colSpan={8} className="py-2">
        <form className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6 items-end p-3 rounded-xl bg-slate-50 dark:bg-slate-950/50 border border-slate-200 dark:border-slate-800" onSubmit={(ev) => { ev.preventDefault(); save.mutate(); }}>
          <Field label="Tên"><input className={inputClass} value={form.name} onChange={(x) => setForm({ ...form, name: x.target.value })} /></Field>
          {e.mw != null ? (
            <Field label="MW (g/mol)"><input className={inputClass} inputMode="decimal" value={form.mw} onChange={(x) => setForm({ ...form, mw: x.target.value })} /></Field>
          ) : (
            <Field label="MW cộng thêm vào base"><input className={inputClass} inputMode="decimal" value={form.mw_delta} onChange={(x) => setForm({ ...form, mw_delta: x.target.value })} /></Field>
          )}
          <Field label="ε260"><input className={inputClass} inputMode="decimal" value={form.ext} onChange={(x) => setForm({ ...form, ext: x.target.value })} /></Field>
          <Field label="Vị trí">
            <select className={inputClass} value={form.position_type} onChange={(x) => setForm({ ...form, position_type: x.target.value })}>
              {Object.entries(POSITION).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          <Field label="Tên gọi khác"><input className={inputClass} value={form.aliases} onChange={(x) => setForm({ ...form, aliases: x.target.value })} /></Field>
          <Field label="Lý do thay đổi *"><input className={inputClass} value={form.reason} onChange={(x) => setForm({ ...form, reason: x.target.value })} required /></Field>
          <div className="lg:col-span-6 flex gap-2 justify-end">
            <Button type="button" variant="ghost" onClick={onDone}>Hủy</Button>
            <Button type="submit" disabled={save.isPending}>Lưu</Button>
          </div>
          <div className="lg:col-span-6"><ErrorNote error={save.error} /></div>
        </form>
      </td>
    </tr>
  );
}

/** Bases and modifications the analyser recognises, with the parameters used in every calculation. */
export function CatalogView({ canManage }: { canManage: boolean }) {
  const list = useQuery({ queryKey: ["factory", "oligo-catalog"], queryFn: () => api<Entry[]>("/api/factory/oligo/modifications") });
  const [editing, setEditing] = useState<string | null>(null);
  return (
    <Card title="Danh mục base và modification">
      <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
        Thông số khởi tạo bằng giá trị hiệu dụng của OligoFlow cũ. Sửa thông số ảnh hưởng mọi phép tính sau đó, phải ghi lý do và được lưu vào nhật ký kiểm tra.
      </p>
      <ErrorNote error={list.error} />
      {list.data && (
        <Table head={["Mã", "Tên", "Loại", "MW", "ε260", "Vị trí", "Tên gọi khác", ""]}>
          {list.data.map((e) =>
            editing === e.id ? (
              <EditRow key={e.id} e={e} onDone={() => setEditing(null)} />
            ) : (
              <tr key={e.id}>
                <td className="py-2 pr-3 font-mono font-semibold">{e.code}</td>
                <td className="py-2 pr-3">{e.name}</td>
                <td className="py-2 pr-3 whitespace-nowrap">{KIND[e.kind]}{e.nn_role === "MOD" && e.base_letter ? " (tính như modification)" : ""}</td>
                <td className="py-2 pr-3 text-right whitespace-nowrap">{e.mw != null ? e.mw.toLocaleString("vi-VN") : `base + ${e.mw_delta}`}</td>
                <td className="py-2 pr-3 text-right">{e.nn_role === "BASE" ? "theo NN" : e.ext_coeff_260.toLocaleString("vi-VN")}</td>
                <td className="py-2 pr-3">{POSITION[e.position_type]}</td>
                <td className="py-2 pr-3 text-[11px] text-slate-500">{e.aliases.join(", ") || "—"}</td>
                <td className="py-2 pr-3 text-right">
                  {e.status !== "ACTIVE" && <StatusBadge status="EXPIRED" label="Ngừng" />}
                  {canManage && <Button variant="ghost" onClick={() => setEditing(e.id)}>Sửa</Button>}
                </td>
              </tr>
            )
          )}
        </Table>
      )}
    </Card>
  );
}

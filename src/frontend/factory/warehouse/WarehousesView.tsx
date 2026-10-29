"use client";

import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { Button, Card, Empty, ErrorNote, Field, inputClass, Table } from "../ui";

export interface WarehouseRow {
  id: string;
  code: string;
  name: string;
  purpose: string;
  access_mode: string;
  owner_org_unit_id: string;
  owner_name: string;
}
interface OrgUnit {
  id: string;
  code: string;
  name: string;
  unit_type: string;
}
interface LocationRow {
  id: string;
  code: string;
  name: string;
  temperature_condition: string;
  is_quarantine: boolean;
}

const PURPOSE_LABEL: Record<string, string> = {
  RAW: "Nguyên vật liệu",
  FINISHED: "Thành phẩm",
  QUARANTINE: "Biệt trữ",
  RD: "R&D",
  OLIGO: "Hóa chất Oligo",
  DEVICE_PARTS: "Linh kiện thiết bị",
};
const TEMP_LABEL: Record<string, string> = { RT: "Nhiệt độ phòng", "2-8": "2–8 °C", "-20": "−20 °C", "-80": "−80 °C" };

function Locations({ warehouse, canManage }: { warehouse: WarehouseRow; canManage: boolean }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ code: "", name: "", temperature_condition: "RT", is_quarantine: false });
  const locs = useQuery({ queryKey: ["factory", "locations", warehouse.id], queryFn: () => api<LocationRow[]>(`/api/factory/master/warehouses/${warehouse.id}/locations`) });
  const add = useMutation({
    mutationFn: () => api(`/api/factory/master/warehouses/${warehouse.id}/locations`, { method: "POST", json: form }),
    onSuccess: () => {
      setForm({ code: "", name: "", temperature_condition: "RT", is_quarantine: false });
      qc.invalidateQueries({ queryKey: ["factory", "locations", warehouse.id] });
    },
  });
  return (
    <div className="mt-2 pl-3 border-l-2 border-sky-200 dark:border-sky-900">
      <ErrorNote error={locs.error} />
      {locs.data?.length === 0 && <p className="text-xs text-slate-400 py-2">Kho chưa có vị trí. Cần ít nhất một vị trí biệt trữ và một vị trí thường.</p>}
      {locs.data && locs.data.length > 0 && (
        <ul className="text-xs text-slate-600 dark:text-slate-300 grid gap-1 py-1">
          {locs.data.map((l) => (
            <li key={l.id}>
              <span className="font-mono font-semibold">{l.code}</span> — {l.name} · {TEMP_LABEL[l.temperature_condition]}
              {l.is_quarantine && <span className="ml-1 text-amber-600 dark:text-amber-400 font-semibold">biệt trữ</span>}
            </li>
          ))}
        </ul>
      )}
      {canManage && (
        <form
          className="grid gap-2 sm:grid-cols-5 items-end pt-2"
          onSubmit={(e) => {
            e.preventDefault();
            add.mutate();
          }}
        >
          <input className={inputClass} placeholder="Mã vị trí" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} required />
          <input className={inputClass} placeholder="Tên (tủ, kệ, ngăn…)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          <select className={inputClass} value={form.temperature_condition} onChange={(e) => setForm({ ...form, temperature_condition: e.target.value })}>
            {Object.entries(TEMP_LABEL).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
            <input type="checkbox" checked={form.is_quarantine} onChange={(e) => setForm({ ...form, is_quarantine: e.target.checked })} />
            Vị trí biệt trữ
          </label>
          <Button type="submit" disabled={add.isPending}>+ Thêm vị trí</Button>
          <div className="sm:col-span-5"><ErrorNote error={add.error} /></div>
        </form>
      )}
    </div>
  );
}

export function WarehousesView({ warehouses, canManage, error }: { warehouses: WarehouseRow[]; canManage: boolean; error: unknown }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState<string | null>(null);
  const [form, setForm] = useState({ code: "", name: "", owner_org_unit_id: "", purpose: "RAW", access_mode: "OWNER_ONLY" });
  const orgUnits = useQuery({ queryKey: ["factory", "org-units"], queryFn: () => api<OrgUnit[]>("/api/factory/org-units"), enabled: canManage });
  const create = useMutation({
    mutationFn: () => api("/api/factory/master/warehouses", { method: "POST", json: form }),
    onSuccess: () => {
      setForm({ code: "", name: "", owner_org_unit_id: "", purpose: "RAW", access_mode: "OWNER_ONLY" });
      qc.invalidateQueries({ queryKey: ["factory", "warehouses"] });
    },
  });

  return (
    <Card title="Kho và vị trí lưu trữ">
      {canManage && (
        <form
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6 items-end mb-4 p-3 rounded-xl bg-slate-50 dark:bg-slate-950/50 border border-slate-200 dark:border-slate-800"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <Field label="Mã kho *"><input className={inputClass} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} required /></Field>
          <Field label="Tên kho *"><input className={inputClass} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></Field>
          <Field label="Phòng sở hữu *">
            <select className={inputClass} value={form.owner_org_unit_id} onChange={(e) => setForm({ ...form, owner_org_unit_id: e.target.value })} required>
              <option value="">Chọn phòng</option>
              {orgUnits.data?.filter((o) => o.unit_type !== "COMPANY").map((o) => (
                <option key={o.id} value={o.id}>{o.code} — {o.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Mục đích">
            <select className={inputClass} value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })}>
              {Object.entries(PURPOSE_LABEL).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </Field>
          <Field label="Phòng khác">
            <select className={inputClass} value={form.access_mode} onChange={(e) => setForm({ ...form, access_mode: e.target.value })}>
              <option value="OWNER_ONLY">Không xem được</option>
              <option value="SHARED_READ">Được xem tồn</option>
            </select>
          </Field>
          <Button type="submit" disabled={create.isPending}>+ Tạo kho</Button>
          <div className="sm:col-span-2 lg:col-span-6"><ErrorNote error={create.error ?? orgUnits.error} /></div>
        </form>
      )}
      <ErrorNote error={error} />
      {warehouses.length === 0 ? (
        <Empty>{canManage ? "Chưa có kho nào. Tạo cơ cấu tổ chức trước, rồi tạo kho cho từng phòng." : "Bạn chưa được cấp quyền xem kho nào."}</Empty>
      ) : (
        <Table head={["Mã", "Tên kho", "Phòng sở hữu", "Mục đích", "Phòng khác", ""]}>
          {warehouses.map((w) => (
            <React.Fragment key={w.id}>
              <tr>
                <td className="py-2 pr-3 font-mono font-semibold">{w.code}</td>
                <td className="py-2 pr-3">{w.name}</td>
                <td className="py-2 pr-3">{w.owner_name}</td>
                <td className="py-2 pr-3">{PURPOSE_LABEL[w.purpose] ?? w.purpose}</td>
                <td className="py-2 pr-3">{w.access_mode === "SHARED_READ" ? "Được xem tồn" : "Không"}</td>
                <td className="py-2 pr-3 text-right">
                  <Button variant="ghost" onClick={() => setOpen(open === w.id ? null : w.id)}>{open === w.id ? "Ẩn vị trí" : "Vị trí"}</Button>
                </td>
              </tr>
              {open === w.id && (
                <tr>
                  <td colSpan={6} className="pb-3"><Locations warehouse={w} canManage={canManage} /></td>
                </tr>
              )}
            </React.Fragment>
          ))}
        </Table>
      )}
    </Card>
  );
}

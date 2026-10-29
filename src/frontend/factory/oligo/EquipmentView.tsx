"use client";

import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, fmtDate } from "../api";
import { Button, Card, Empty, ErrorNote, Field, inputClass, Table } from "../ui";
import { useOligoUnits, useScales } from "./shared";

interface Asset { id: string; code: string; name: string; status: string; owner_name: string; next_calibration_due: string | null; column_positions: number | null; supported_scales: string[] | null; model: string | null; serial_no: string | null }
interface Rule { role: string; name: string; basis: string; qty: number; uom: string; item_id: string | null; status: string; version: number; item_code: string | null; item_name: string | null; base_uom: string | null }

const BASIS: Record<string, string> = { PER_CYCLE: "mỗi chu kỳ", PER_COUPLING: "mỗi lần ghép base", PER_MOD: "mỗi modification" };
const ASSET_STATUS: Record<string, string> = { IN_SERVICE: "Đang dùng", UNDER_MAINTENANCE: "Bảo trì", OUT_OF_CALIBRATION: "Hết hiệu chuẩn", RETIRED: "Ngừng" };

function NewSynthesizer() {
  const qc = useQueryClient();
  const units = useOligoUnits("asset.manage");
  const scales = useScales();
  const [f, setF] = useState({ owner_org_unit_id: "", name: "", model: "", serial_no: "", next_calibration_due: "", column_positions: "8", scales: [] as string[] });
  const create = useMutation({
    mutationFn: () =>
      api("/api/factory/assets", {
        method: "POST",
        idempotent: true,
        json: {
          asset_type: "SYNTHESIZER",
          name: f.name,
          owner_org_unit_id: f.owner_org_unit_id || units.data?.[0]?.id,
          model: f.model || null,
          serial_no: f.serial_no || null,
          next_calibration_due: f.next_calibration_due || null,
          synthesizer: { column_positions: Number(f.column_positions), supported_scales: f.scales },
        },
      }),
    onSuccess: () => {
      setF({ ...f, name: "", model: "", serial_no: "" });
      qc.invalidateQueries({ queryKey: ["factory", "assets"] });
    },
  });
  if (!units.data?.length) return null;
  return (
    <form className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6 items-end mb-4 p-3 rounded-xl bg-slate-50 dark:bg-slate-950/50 border border-slate-200 dark:border-slate-800" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
      {units.data.length > 1 && (
        <Field label="Phòng">
          <select className={inputClass} value={f.owner_org_unit_id} onChange={(e) => setF({ ...f, owner_org_unit_id: e.target.value })} required>
            <option value="">Chọn</option>
            {units.data.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </Field>
      )}
      <Field label="Tên máy *"><input className={inputClass} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></Field>
      <Field label="Model"><input className={inputClass} value={f.model} onChange={(e) => setF({ ...f, model: e.target.value })} /></Field>
      <Field label="Số serial"><input className={inputClass} value={f.serial_no} onChange={(e) => setF({ ...f, serial_no: e.target.value })} /></Field>
      <Field label="Số vị trí cột *"><input className={inputClass} type="number" min="1" max="384" value={f.column_positions} onChange={(e) => setF({ ...f, column_positions: e.target.value })} required /></Field>
      <Field label="Hạn hiệu chuẩn"><input className={inputClass} type="date" value={f.next_calibration_due} onChange={(e) => setF({ ...f, next_calibration_due: e.target.value })} /></Field>
      <div className="sm:col-span-3 lg:col-span-5 flex flex-wrap gap-3 text-xs">
        <span className="text-slate-500">Thang chạy được (bỏ trống = mọi thang):</span>
        {scales.data?.map((s) => (
          <label key={s.code} className="flex items-center gap-1">
            <input type="checkbox" checked={f.scales.includes(s.code)} onChange={(e) => setF({ ...f, scales: e.target.checked ? [...f.scales, s.code] : f.scales.filter((x) => x !== s.code) })} />
            {s.label}
          </label>
        ))}
      </div>
      <Button type="submit" disabled={create.isPending}>+ Thêm máy</Button>
      <div className="sm:col-span-3 lg:col-span-6"><ErrorNote error={create.error} /></div>
    </form>
  );
}

interface ItemOpt { id: string; code: string; name: string; base_uom: string }

/** Searchable stock item select (server-side search, 30 hits). */
function ItemPicker({ value, current, onChange }: { value: string; current?: string; onChange: (id: string) => void }) {
  const [q, setQ] = useState("");
  const items = useQuery({
    queryKey: ["factory", "items-pick", q],
    queryFn: () => api<{ rows: ItemOpt[] }>(`/api/factory/master/items?page_size=30&q=${encodeURIComponent(q)}`),
  });
  return (
    <div className="flex gap-1">
      <input className={`${inputClass} w-32`} placeholder="Tìm mã hàng" value={q} onChange={(e) => setQ(e.target.value)} />
      <select className={`${inputClass} w-56`} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">— chưa gắn —</option>
        {value && current && !items.data?.rows.some((i) => i.id === value) && <option value={value}>{current}</option>}
        {items.data?.rows.map((i) => <option key={i.id} value={i.id}>{i.code} · {i.name} ({i.base_uom})</option>)}
      </select>
    </div>
  );
}

function RuleRow({ r, canManage }: { r: Rule; canManage: boolean }) {
  const qc = useQueryClient();
  const [edit, setEdit] = useState(false);
  const [qty, setQty] = useState(String(r.qty));
  const [itemId, setItemId] = useState(r.item_id ?? "");
  const save = useMutation({
    mutationFn: (reason: string) => api(`/api/factory/oligo/reagent-rules/${encodeURIComponent(r.role)}`, { method: "PATCH", json: { version: r.version, qty: Number(qty), item_id: itemId || null, reason } }),
    onSuccess: () => {
      setEdit(false);
      qc.invalidateQueries({ queryKey: ["factory", "oligo-reagent-rules"] });
    },
  });
  return (
    <tr>
      <td className="py-1.5 pr-3 font-mono text-xs">{r.role}</td>
      <td className="py-1.5 pr-3 text-xs">{r.name}</td>
      <td className="py-1.5 pr-3 text-xs whitespace-nowrap">
        {edit ? <input className={`${inputClass} w-24`} type="number" step="any" min="0" value={qty} onChange={(e) => setQty(e.target.value)} /> : r.qty} {r.uom} / {BASIS[r.basis]}
      </td>
      <td className="py-1.5 pr-3 text-xs">
        {edit ? (
          <ItemPicker value={itemId} current={r.item_id ? `${r.item_code} · ${r.item_name}` : undefined} onChange={setItemId} />
        ) : r.item_id ? `${r.item_code} · ${r.item_name}` : <span className="text-amber-700 dark:text-amber-400">Chưa gắn mã hàng — chưa lập mẻ được</span>}
        {save.error != null && <ErrorNote error={save.error} />}
      </td>
      <td className="py-1.5 pr-3 text-right whitespace-nowrap">
        {canManage && !edit && <Button variant="ghost" onClick={() => setEdit(true)}>Sửa</Button>}
        {edit && (
          <>
            <Button variant="ghost" onClick={() => setEdit(false)}>Hủy</Button>
            <Button onClick={() => { const reason = window.prompt("Lý do thay đổi định mức:"); if (reason) save.mutate(reason); }} disabled={save.isPending}>Lưu</Button>
          </>
        )}
      </td>
    </tr>
  );
}

interface Mod { id: string; code: string; name: string; kind: string; version: number; amidite_item_id: string | null; status: string }

function AmiditeRow({ m, label, canManage }: { m: Mod; label: string | undefined; canManage: boolean }) {
  const qc = useQueryClient();
  const [edit, setEdit] = useState(false);
  const [itemId, setItemId] = useState(m.amidite_item_id ?? "");
  const save = useMutation({
    mutationFn: (reason: string) => api(`/api/factory/oligo/modifications/${m.id}`, { method: "PATCH", json: { version: m.version, amidite_item_id: itemId || null, reason } }),
    onSuccess: () => {
      setEdit(false);
      qc.invalidateQueries({ queryKey: ["factory", "oligo-catalog"] });
    },
  });
  return (
    <tr>
      <td className="py-1.5 pr-3 font-mono text-xs">{m.code}</td>
      <td className="py-1.5 pr-3 text-xs">{m.name}</td>
      <td className="py-1.5 pr-3 text-xs">
        {edit ? <ItemPicker value={itemId} current={label} onChange={setItemId} /> : m.amidite_item_id ? label ?? "đã gắn" : <span className="text-slate-400">— (dùng định mức MOD_DEFAULT nếu cần)</span>}
        {save.error != null && <ErrorNote error={save.error} />}
      </td>
      <td className="py-1.5 pr-3 text-right whitespace-nowrap">
        {canManage && !edit && <Button variant="ghost" onClick={() => setEdit(true)}>Gắn</Button>}
        {edit && (
          <>
            <Button variant="ghost" onClick={() => setEdit(false)}>Hủy</Button>
            <Button onClick={() => { const reason = window.prompt("Lý do:"); if (reason) save.mutate(reason); }} disabled={save.isPending}>Lưu</Button>
          </>
        )}
      </td>
    </tr>
  );
}

/** Synthesizers of the Oligo department and the consumption rules (OligoFlow model) that size reservations. */
export function EquipmentView({ canManageAssets, canManageRules, canManageCatalog }: { canManageAssets: boolean; canManageRules: boolean; canManageCatalog: boolean }) {
  const mods = useQuery({ queryKey: ["factory", "oligo-catalog"], queryFn: () => api<Mod[]>("/api/factory/oligo/modifications") });
  const modItems = useQuery({
    queryKey: ["factory", "items-by-id", mods.data?.map((m) => m.amidite_item_id).filter(Boolean).join(",")],
    enabled: !!mods.data,
    queryFn: () => api<{ rows: ItemOpt[] }>("/api/factory/master/items?page_size=200"),
  });
  const itemLabel = (id: string | null) => {
    const i = id ? modItems.data?.rows.find((x) => x.id === id) : undefined;
    return i ? `${i.code} · ${i.name}` : undefined;
  };
  const assets = useQuery({ queryKey: ["factory", "assets", "SYNTHESIZER"], queryFn: () => api<Asset[]>("/api/factory/assets?type=SYNTHESIZER") });
  const rules = useQuery({ queryKey: ["factory", "oligo-reagent-rules"], queryFn: () => api<Rule[]>("/api/factory/oligo/reagent-rules") });
  return (
    <div className="flex flex-col gap-3">
      <Card title="Máy tổng hợp">
        {canManageAssets && <NewSynthesizer />}
        <ErrorNote error={assets.error} />
        {assets.data?.length === 0 && <Empty>Chưa khai báo máy tổng hợp.</Empty>}
        {assets.data && assets.data.length > 0 && (
          <Table head={["Mã", "Tên", "Phòng", "Model / serial", "Số cột", "Thang", "Hạn hiệu chuẩn", "Trạng thái"]}>
            {assets.data.map((a) => (
              <tr key={a.id}>
                <td className="py-1.5 pr-3 font-mono">{a.code}</td>
                <td className="py-1.5 pr-3">{a.name}</td>
                <td className="py-1.5 pr-3 text-xs">{a.owner_name}</td>
                <td className="py-1.5 pr-3 text-xs">{[a.model, a.serial_no].filter(Boolean).join(" / ") || "—"}</td>
                <td className="py-1.5 pr-3 text-right">{a.column_positions}</td>
                <td className="py-1.5 pr-3 text-xs">{a.supported_scales?.length ? a.supported_scales.join(", ") : "Mọi thang"}</td>
                <td className="py-1.5 pr-3 text-xs">{fmtDate(a.next_calibration_due)}</td>
                <td className="py-1.5 pr-3 text-xs">{ASSET_STATUS[a.status] ?? a.status}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <Card title="Định mức hóa chất tổng hợp">
        <p className="text-[11px] text-slate-500 mb-2">Dùng để giữ chỗ khi lập mẻ; lượng thực tế nhập khi kết thúc mẻ. Mỗi vai trò phải gắn một mã hàng trong kho NVL. Amidite của modification gắn tại Danh mục modification.</p>
        <ErrorNote error={rules.error} />
        {rules.data && (
          <Table head={["Vai trò", "Tên", "Định mức", "Mã hàng kho", ""]}>
            {rules.data.map((r) => <RuleRow key={r.role} r={r} canManage={canManageRules} />)}
          </Table>
        )}
      </Card>
      <Card title="Amidite của modification">
        <p className="text-[11px] text-slate-500 mb-2">Modification gắn mã hàng riêng được giữ chỗ / xuất đúng mã đó; chưa gắn thì tính theo vai trò MOD_DEFAULT (dye nội phân tử theo ALKYL).</p>
        <ErrorNote error={mods.error} />
        {mods.data && (
          <Table head={["Mã", "Tên", "Mã hàng amidite", ""]}>
            {mods.data.filter((m) => m.kind !== "BASE" && m.status === "ACTIVE").map((m) => <AmiditeRow key={m.id} m={m} label={itemLabel(m.amidite_item_id)} canManage={canManageCatalog} />)}
          </Table>
        )}
      </Card>
    </div>
  );
}

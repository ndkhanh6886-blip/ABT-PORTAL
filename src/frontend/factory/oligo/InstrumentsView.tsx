"use client";

import React, { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, fmtDate, fmtQty } from "../api";
import { Button, Card, Empty, ErrorNote, Field, inputClass, Table } from "../ui";
import { ItemPicker } from "./EquipmentView";
import { useOligoUnits } from "./shared";

interface Asset { id: string; code: string; name: string; asset_type: string; status: string; owner_name: string; next_calibration_due: string | null; model: string | null; serial_no: string | null }
interface Slot {
  slot_no: number; label: string; item_id: string; item_code: string; item_name: string; base_uom: string; current_lot_id: string | null; lot_code: string | null; expiry_date: string | null;
  available: number | null; lots: { lot_id: string; code: string; available: number; expiry_date: string | null }[]; usage: { kind: string; label: string; qty: number }[];
}
interface SlotsData { asset: { id: string; code: string; name: string }; slots: Slot[]; events: { slot_no: number; event: string; usage_kind: string | null; qty: number | null; source_ref: string | null; notes: string | null; created_at: string; lot_code: string | null; by_name: string | null }[] }

const TYPES: Record<string, string> = { HPLC: "HPLC", SPECTROPHOTOMETER: "Máy đo quang (OD)", MASS_SPEC: "Khối phổ", CENTRIFUGE: "Ly tâm", FREEZER: "Tủ đông / tủ lạnh", BALANCE: "Cân", PCR: "PCR", OTHER: "Khác" };
const KINDS: Record<string, string> = { RUN: "Chạy mẫu", PURGE: "Rửa / cân bằng máy", MAINTENANCE: "Bảo trì", LOSS: "Hao hụt" };
const EVENTS: Record<string, string> = { INSTALL: "Lắp chai", REMOVE: "Tháo chai", USAGE: "Tiêu hao" };

function NewInstrument() {
  const qc = useQueryClient();
  const units = useOligoUnits("asset.manage");
  const [f, setF] = useState({ owner_org_unit_id: "", asset_type: "HPLC", name: "", model: "", serial_no: "", next_calibration_due: "" });
  const create = useMutation({
    mutationFn: () =>
      api("/api/factory/assets", {
        method: "POST",
        idempotent: true,
        json: { ...f, owner_org_unit_id: f.owner_org_unit_id || units.data?.[0]?.id, model: f.model || null, serial_no: f.serial_no || null, next_calibration_due: f.next_calibration_due || null },
      }),
    onSuccess: () => {
      setF({ ...f, name: "", model: "", serial_no: "" });
      qc.invalidateQueries({ queryKey: ["factory", "assets"] });
    },
  });
  if (!units.data?.length) return null;
  return (
    <form className="grid gap-3 sm:grid-cols-3 lg:grid-cols-7 items-end mb-4 p-3 rounded-xl bg-slate-50 dark:bg-slate-950/50 border border-slate-200 dark:border-slate-800" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
      {units.data.length > 1 && (
        <Field label="Phòng">
          <select className={inputClass} value={f.owner_org_unit_id} onChange={(e) => setF({ ...f, owner_org_unit_id: e.target.value })} required>
            <option value="">Chọn</option>
            {units.data.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </Field>
      )}
      <Field label="Loại">
        <select className={inputClass} value={f.asset_type} onChange={(e) => setF({ ...f, asset_type: e.target.value })}>
          {Object.entries(TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </Field>
      <Field label="Tên *"><input className={inputClass} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></Field>
      <Field label="Model"><input className={inputClass} value={f.model} onChange={(e) => setF({ ...f, model: e.target.value })} /></Field>
      <Field label="Số serial"><input className={inputClass} value={f.serial_no} onChange={(e) => setF({ ...f, serial_no: e.target.value })} /></Field>
      <Field label="Hạn hiệu chuẩn"><input className={inputClass} type="date" value={f.next_calibration_due} onChange={(e) => setF({ ...f, next_calibration_due: e.target.value })} /></Field>
      <Button type="submit" disabled={create.isPending}>+ Thêm thiết bị</Button>
      <div className="sm:col-span-3 lg:col-span-7"><ErrorNote error={create.error} /></div>
    </form>
  );
}

function UsageForm({ assetId, slot, onDone }: { assetId: string; slot: Slot; onDone: () => void }) {
  const [f, setF] = useState({ kind: "PURGE", qty: "", notes: "" });
  const log = useMutation({
    mutationFn: () => api(`/api/factory/assets/${assetId}/slots/${slot.slot_no}/usage`, { method: "POST", idempotent: true, json: { kind: f.kind, qty: Number(f.qty), notes: f.notes || null } }),
    onSuccess: () => {
      setF({ ...f, qty: "", notes: "" });
      onDone();
    },
  });
  return (
    <form className="flex flex-wrap gap-1 items-center" onSubmit={(e) => { e.preventDefault(); log.mutate(); }}>
      <select className={`${inputClass} w-36`} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} aria-label="Loại tiêu hao">
        {Object.entries(KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </select>
      <input className={`${inputClass} w-20`} inputMode="decimal" placeholder={slot.base_uom} value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} required aria-label="Lượng" />
      <input className={`${inputClass} w-32`} placeholder="Ghi chú" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
      <Button type="submit" variant="ghost" disabled={log.isPending}>Ghi</Button>
      {log.error != null && <ErrorNote error={log.error} />}
    </form>
  );
}

function SlotsPanel({ assetId, canConfigure, canOperate, onClose }: { assetId: string; canConfigure: boolean; canOperate: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const data = useQuery({ queryKey: ["factory", "asset-slots", assetId], queryFn: () => api<SlotsData>(`/api/factory/assets/${assetId}/slots`) });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<{ slot_no: string; label: string; item_id: string; item_label?: string }[]>([]);
  useEffect(() => {
    if (data.data) setDraft(data.data.slots.map((s) => ({ slot_no: String(s.slot_no), label: s.label, item_id: s.item_id, item_label: `${s.item_code} · ${s.item_name}` })));
  }, [data.data]);
  const refresh = () => qc.invalidateQueries({ queryKey: ["factory", "asset-slots", assetId] });
  const save = useMutation({
    mutationFn: () => api(`/api/factory/assets/${assetId}/slots`, { method: "PUT", json: { slots: draft.map((d) => ({ slot_no: Number(d.slot_no), label: d.label, item_id: d.item_id })) } }),
    onSuccess: () => {
      setEditing(false);
      refresh();
    },
  });
  const bottle = useMutation({ mutationFn: ({ slot, lot }: { slot: number; lot: string | null }) => api(`/api/factory/assets/${assetId}/slots/${slot}/bottle`, { method: "PUT", json: { lot_id: lot } }), onSuccess: refresh });
  const d = data.data;
  return (
    <Card title={d ? `Vị trí hóa chất — ${d.asset.code} ${d.asset.name}` : "Vị trí hóa chất"} actions={<Button variant="ghost" onClick={onClose}>Đóng</Button>}>
      <ErrorNote error={data.error ?? bottle.error} />
      {d && !editing && (
        <div className="flex flex-col gap-3">
          {d.slots.length === 0 && <Empty>Chưa khai báo vị trí (ví dụ HPLC: Đệm A, Đệm B, dung môi rửa).</Empty>}
          {d.slots.length > 0 && (
            <Table head={["Vị trí", "Mã hàng", "Chai đang lắp", "Còn (sổ kho)", "Đã dùng từ khi lắp", "Lắp / thay chai", "Ghi tiêu hao"]}>
              {d.slots.map((s) => (
                <tr key={s.slot_no}>
                  <td className="py-1.5 pr-3 text-xs"><b>{s.slot_no}</b> {s.label}</td>
                  <td className="py-1.5 pr-3 text-xs">{s.item_code} · {s.item_name}</td>
                  <td className="py-1.5 pr-3 font-mono text-xs">{s.lot_code ?? <span className="font-sans text-amber-700 dark:text-amber-400">Trống</span>}{s.expiry_date && <div className="font-sans text-slate-500">HD {fmtDate(s.expiry_date)}</div>}</td>
                  <td className="py-1.5 pr-3 text-right text-xs">{s.available == null ? "—" : `${fmtQty(s.available)} ${s.base_uom}`}</td>
                  <td className="py-1.5 pr-3 text-xs">{s.usage.map((u) => `${u.label}: ${fmtQty(u.qty)}`).join(" · ") || "—"}</td>
                  <td className="py-1.5 pr-3">
                    {canOperate && (
                      <select className={`${inputClass} w-48`} value={s.current_lot_id ?? ""} disabled={bottle.isPending} onChange={(e) => bottle.mutate({ slot: s.slot_no, lot: e.target.value || null })} aria-label={`Chai cho vị trí ${s.label}`}>
                        <option value="">— tháo chai —</option>
                        {s.lots.map((l) => <option key={l.lot_id} value={l.lot_id}>{l.code} (còn {fmtQty(l.available)})</option>)}
                      </select>
                    )}
                  </td>
                  <td className="py-1.5 pr-3">{canOperate && s.current_lot_id && <UsageForm assetId={assetId} slot={s} onDone={refresh} />}</td>
                </tr>
              ))}
            </Table>
          )}
          <p className="text-[11px] text-slate-500">
            Bước SOP có chọn thiết bị này và dùng hóa chất trùng mã hàng của một vị trí: lượng dùng được trừ đúng chai đang lắp (ghi là “Chạy mẫu”). Rửa máy, bảo trì, hao hụt ghi tay ở đây.
          </p>
          {canConfigure && <div><Button variant="ghost" onClick={() => setEditing(true)}>Cấu hình vị trí</Button></div>}
          {d.events.length > 0 && (
            <Table head={["Lúc", "Vị trí", "Sự kiện", "Lô", "Lượng", "Nguồn / ghi chú", "Người"]}>
              {d.events.map((e, i) => (
                <tr key={i}>
                  <td className="py-1 pr-3 text-xs whitespace-nowrap">{new Date(e.created_at).toLocaleString("vi-VN")}</td>
                  <td className="py-1 pr-3 text-xs">{e.slot_no}</td>
                  <td className="py-1 pr-3 text-xs">{e.usage_kind ? KINDS[e.usage_kind] : EVENTS[e.event]}</td>
                  <td className="py-1 pr-3 font-mono text-xs">{e.lot_code ?? "—"}</td>
                  <td className="py-1 pr-3 text-right text-xs">{e.qty == null ? "" : fmtQty(e.qty)}</td>
                  <td className="py-1 pr-3 text-xs">{[e.source_ref, e.notes].filter(Boolean).join(" · ")}</td>
                  <td className="py-1 pr-3 text-xs">{e.by_name ?? ""}</td>
                </tr>
              ))}
            </Table>
          )}
        </div>
      )}
      {d && editing && (
        <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
          {draft.map((s, i) => (
            <div key={i} className="flex flex-wrap gap-2 items-center text-xs">
              <input className={`${inputClass} w-16`} type="number" min="1" max="50" value={s.slot_no} onChange={(e) => setDraft(draft.map((x, j) => (j === i ? { ...x, slot_no: e.target.value } : x)))} aria-label="Số vị trí" />
              <input className={`${inputClass} w-40`} placeholder="Tên vị trí (Đệm A…)" value={s.label} onChange={(e) => setDraft(draft.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} required />
              <ItemPicker value={s.item_id} current={s.item_label} onChange={(id) => setDraft(draft.map((x, j) => (j === i ? { ...x, item_id: id } : x)))} />
              <button type="button" className="text-rose-600 cursor-pointer" onClick={() => setDraft(draft.filter((_, j) => j !== i))}>Xóa</button>
            </div>
          ))}
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={() => setDraft([...draft, { slot_no: String(Math.max(0, ...draft.map((x) => Number(x.slot_no) || 0)) + 1), label: "", item_id: "" }])}>+ Vị trí</Button>
            <Button type="button" variant="ghost" onClick={() => setEditing(false)}>Hủy</Button>
            <Button type="submit" disabled={save.isPending}>Lưu cấu hình</Button>
          </div>
          <ErrorNote error={save.error} />
        </form>
      )}
    </Card>
  );
}

/** Lab instruments other than synthesizers (HPLC, spectrophotometer …) with their reagent / solvent positions. */
export function InstrumentsView({ canManage, canOperate }: { canManage: boolean; canOperate: boolean }) {
  const assets = useQuery({ queryKey: ["factory", "assets", "all"], queryFn: () => api<Asset[]>("/api/factory/assets") });
  const [open, setOpen] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const list = assets.data?.filter((a) => a.asset_type !== "SYNTHESIZER") ?? [];
  return (
    <div className="flex flex-col gap-3">
      {open && <SlotsPanel key={open} assetId={open} canConfigure={canManage} canOperate={canOperate} onClose={() => setOpen(null)} />}
      <Card
        title="Thiết bị khác (HPLC, máy đo quang …)"
        actions={
          canManage ? (
            <Button onClick={() => setShowAdd((v) => !v)}>
              {showAdd ? "Đóng form" : "+ Thêm thiết bị"}
            </Button>
          ) : null
        }
      >
        {canManage && showAdd && <NewInstrument />}
        <ErrorNote error={assets.error} />
        {assets.data && list.length === 0 && <Empty>Chưa khai báo thiết bị.</Empty>}
        {list.length > 0 && (
          <Table head={["Mã", "Tên", "Loại", "Phòng", "Model / serial", "Hạn hiệu chuẩn", ""]}>
            {list.map((a) => (
              <tr key={a.id}>
                <td className="py-1.5 pr-3 font-mono">{a.code}</td>
                <td className="py-1.5 pr-3">{a.name}</td>
                <td className="py-1.5 pr-3 text-xs">{TYPES[a.asset_type] ?? a.asset_type}</td>
                <td className="py-1.5 pr-3 text-xs">{a.owner_name}</td>
                <td className="py-1.5 pr-3 text-xs">{[a.model, a.serial_no].filter(Boolean).join(" / ") || "—"}</td>
                <td className="py-1.5 pr-3 text-xs">{fmtDate(a.next_calibration_due)}</td>
                <td className="py-1.5 pr-3 text-right"><Button variant="ghost" onClick={() => setOpen(a.id)}>Vị trí hóa chất</Button></td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}

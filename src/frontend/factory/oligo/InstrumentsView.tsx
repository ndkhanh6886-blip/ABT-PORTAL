"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, fmtDate, fmtQty } from "../api";
import { Button, Card, Empty, ErrorNote, Field, inputClass, Table } from "../ui";
import { ItemPicker } from "./EquipmentView";
import { useOligoUnits } from "./shared";

interface Asset {
  id: string;
  code: string;
  name: string;
  asset_type: string;
  status: string;
  owner_code?: string;
  owner_name: string;
  next_calibration_due: string | null;
  model: string | null;
  serial_no: string | null;
}
interface Slot {
  slot_no: number;
  label: string;
  item_id: string;
  item_code: string;
  item_name: string;
  base_uom: string;
  current_lot_id: string | null;
  lot_code: string | null;
  expiry_date: string | null;
  bottle_volume_base?: number;
  std_qty_per_run?: number;
  std_qty_per_purge?: number;
  bottle_price_vnd?: number;
  design_runs?: number;
  used_current_bottle?: number;
  remaining_in_bottle?: number;
  runs_current_bottle?: number;
  runs_total?: number;
  total_used_qty?: number;
  cost_per_ml?: number;
  cost_per_run?: number;
  depreciated_current_bottle_vnd?: number;
  depreciated_total_vnd?: number;
  available: number | null;
  lots: { lot_id: string; code: string; available: number; expiry_date: string | null }[];
  usage: { kind: string; label: string; qty: number }[];
}
interface SlotsData {
  asset: { id: string; code: string; name: string };
  slots: Slot[];
  events: {
    slot_no: number;
    event: string;
    usage_kind: string | null;
    qty: number | null;
    source_ref: string | null;
    notes: string | null;
    created_at: string;
    lot_code: string | null;
    by_name: string | null;
  }[];
}

const TYPES: Record<string, string> = {
  HPLC: "HPLC",
  SPECTROPHOTOMETER: "Máy đo quang (OD)",
  MASS_SPEC: "Khối phổ",
  CENTRIFUGE: "Ly tâm",
  FREEZER: "Tủ đông / tủ lạnh",
  BALANCE: "Cân",
  PCR: "PCR",
  OTHER: "Khác",
};
const KINDS: Record<string, string> = {
  RUN: "Chạy mẫu (Tinh sạch)",
  PURGE: "Rửa / cân bằng máy (Purge)",
  MAINTENANCE: "Bảo trì",
  LOSS: "Hao hụt / Bay hơi",
};
const EVENTS: Record<string, string> = { INSTALL: "Lắp chai", REMOVE: "Tháo chai", USAGE: "Tiêu hao" };
const vnd = (v: number | null | undefined) => `${Math.round(Number(v || 0)).toLocaleString("vi-VN", { maximumFractionDigits: 0 })} đ`;

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
  const stdRun = slot.std_qty_per_run ?? 15;
  const stdPurge = slot.std_qty_per_purge ?? 30;
  const [f, setF] = useState({ kind: "RUN", qty: String(stdRun), notes: "" });
  const log = useMutation({
    mutationFn: () =>
      api(`/api/factory/assets/${assetId}/slots/${slot.slot_no}/usage`, {
        method: "POST",
        idempotent: true,
        json: { kind: f.kind, qty: Number(f.qty), notes: f.notes || null },
      }),
    onSuccess: () => {
      setF({ kind: "RUN", qty: String(stdRun), notes: "" });
      onDone();
    },
  });
  return (
    <form className="flex flex-wrap gap-1 items-center" onSubmit={(e) => { e.preventDefault(); log.mutate(); }}>
      <select
        className={`${inputClass} w-36 text-xs`}
        value={f.kind}
        onChange={(e) => {
          const nextKind = e.target.value;
          setF({
            ...f,
            kind: nextKind,
            qty: nextKind === "RUN" ? String(stdRun) : nextKind === "PURGE" ? String(stdPurge) : f.qty,
          });
        }}
        aria-label="Loại tiêu hao"
      >
        {Object.entries(KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </select>
      <input
        className={`${inputClass} w-20 text-xs font-mono`}
        inputMode="decimal"
        placeholder={slot.base_uom}
        value={f.qty}
        onChange={(e) => setF({ ...f, qty: e.target.value })}
        required
        aria-label="Lượng"
      />
      <input
        className={`${inputClass} w-28 text-xs`}
        placeholder="Ghi chú / Mã mẫu"
        value={f.notes}
        onChange={(e) => setF({ ...f, notes: e.target.value })}
      />
      <Button type="submit" variant="ghost" disabled={log.isPending} title="Trừ tồn kho & ghi nhận khấu hao hóa chất HPLC">
        Ghi ({slot.base_uom})
      </Button>
      {log.error != null && <ErrorNote error={log.error} />}
    </form>
  );
}

export function SlotsPanel({ assetId, canConfigure, canOperate, onClose }: { assetId: string; canConfigure: boolean; canOperate: boolean; onClose?: () => void }) {
  const qc = useQueryClient();
  const data = useQuery({ queryKey: ["factory", "asset-slots", assetId], queryFn: () => api<SlotsData>(`/api/factory/assets/${assetId}/slots`) });
  const [editing, setEditing] = useState(false);
  const [sampleRunsCount, setSampleRunsCount] = useState("1");
  const [batchNote, setBatchNote] = useState("");
  const [draft, setDraft] = useState<
    {
      slot_no: string;
      label: string;
      item_id: string;
      item_label?: string;
      bottle_volume_base: string;
      std_qty_per_run: string;
      std_qty_per_purge: string;
      bottle_price_vnd: string;
      design_runs: string;
    }[]
  >([]);

  useEffect(() => {
    if (data.data) {
      setDraft(
        data.data.slots.map((s) => ({
          slot_no: String(s.slot_no),
          label: s.label,
          item_id: s.item_id,
          item_label: `${s.item_code} · ${s.item_name}`,
          bottle_volume_base: String(s.bottle_volume_base ?? 2500),
          std_qty_per_run: String(s.std_qty_per_run ?? 15),
          std_qty_per_purge: String(s.std_qty_per_purge ?? 30),
          bottle_price_vnd: String(s.bottle_price_vnd ?? 1850000),
          design_runs: String(s.design_runs ?? 140),
        }))
      );
    }
  }, [data.data]);

  const refresh = () => qc.invalidateQueries({ queryKey: ["factory", "asset-slots", assetId] });

  const save = useMutation({
    mutationFn: () =>
      api(`/api/factory/assets/${assetId}/slots`, {
        method: "PUT",
        json: {
          slots: draft
            .filter((d) => d.slot_no && d.label && d.item_id)
            .map((d) => ({
              slot_no: Number(d.slot_no),
              label: d.label,
              item_id: d.item_id,
              bottle_volume_base: Number(d.bottle_volume_base || 2500),
              std_qty_per_run: Number(d.std_qty_per_run || 15),
              std_qty_per_purge: Number(d.std_qty_per_purge || 30),
              bottle_price_vnd: Number(d.bottle_price_vnd || 0),
              design_runs: Number(d.design_runs || 140),
            })),
        },
      }),
    onSuccess: () => {
      setEditing(false);
      refresh();
    },
  });

  const bottle = useMutation({
    mutationFn: ({ slot, lot }: { slot: number; lot: string | null }) =>
      api(`/api/factory/assets/${assetId}/slots/${slot}/bottle`, { method: "PUT", json: { lot_id: lot } }),
    onSuccess: refresh,
  });

  const batchUsage = useMutation({
    mutationFn: (kind: "RUN" | "PURGE") =>
      api(`/api/factory/assets/${assetId}/slots/0/usage`, {
        method: "POST",
        idempotent: true,
        json: {
          kind,
          sample_runs: Number(sampleRunsCount || 1),
          notes: batchNote || null,
        },
      }),
    onSuccess: () => {
      setBatchNote("");
      refresh();
    },
  });

  const d = data.data;
  const kpi = useMemo(() => {
    const slots = d?.slots ?? [];
    const activeCount = slots.filter((s) => !!s.current_lot_id).length;
    const totalBottleValue = slots.reduce((sum, s) => sum + Number(s.bottle_price_vnd || 0), 0);
    const totalCostPerSampleRun = slots.reduce((sum, s) => sum + Number(s.cost_per_run || 0), 0);
    const totalDepreciated = slots.reduce((sum, s) => sum + Number(s.depreciated_total_vnd || 0), 0);
    return { activeCount, totalSlots: slots.length, totalBottleValue, totalCostPerSampleRun, totalDepreciated };
  }, [d?.slots]);

  return (
    <Card
      title={
        d
          ? `🧪 Quản lý Sử dụng, Định mức & Khấu hao từng loại Hóa chất HPLC — ${d.asset.code} (${d.asset.name})`
          : "Quản lý Sử dụng & Khấu hao Hóa chất HPLC"
      }
      actions={
        <div className="flex items-center gap-2">
          {canConfigure && !editing && (
            <Button variant="ghost" onClick={() => setEditing(true)}>
              ⚙ Cấu hình kênh & Chọn mã hóa chất kho
            </Button>
          )}
          {onClose && <Button variant="ghost" onClick={onClose}>Đóng</Button>}
        </div>
      }
    >
      <ErrorNote error={data.error ?? bottle.error ?? batchUsage.error} />
      {d && !editing && (
        <div className="flex flex-col gap-3">
          {/* 4 Thẻ KPI Tổng quan Khấu hao & Sử dụng Hóa chất HPLC */}
          {d.slots.length > 0 && (
            <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
              <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50">
                <div className="text-[11px] text-slate-500">Số kênh hóa chất đang lắp</div>
                <div className="text-base font-extrabold text-sky-700 dark:text-sky-400">
                  {kpi.activeCount} / {kpi.totalSlots} kênh
                </div>
                <div className="text-[11px] text-slate-400">Liên kết trực tiếp tồn kho Lô/Chai</div>
              </div>
              <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50">
                <div className="text-[11px] text-slate-500">Tổng giá trị bộ chai đang lắp</div>
                <div className="text-base font-extrabold text-slate-800 dark:text-slate-100">{vnd(kpi.totalBottleValue)}</div>
                <div className="text-[11px] text-slate-400">Pha động A, B, Đệm Ion-Pair & Dung môi rửa</div>
              </div>
              <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50">
                <div className="text-[11px] text-slate-500">Khấu hao hóa chất / 1 lượt chạy mẫu</div>
                <div className="text-base font-extrabold text-emerald-700 dark:text-emerald-400">{vnd(kpi.totalCostPerSampleRun)} / mẫu</div>
                <div className="text-[11px] text-slate-400">Cộng gộp định mức tất cả kênh HPLC</div>
              </div>
              <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50">
                <div className="text-[11px] text-slate-500">Tổng khấu hao hóa chất lũy kế</div>
                <div className="text-base font-extrabold text-amber-700 dark:text-amber-400">{vnd(kpi.totalDepreciated)}</div>
                <div className="text-[11px] text-slate-400">Bao gồm Chạy mẫu + Purge + Hao hụt</div>
              </div>
            </div>
          )}

          {/* Thanh ghi nhận nhanh 1 mẻ chạy mẫu HPLC hoặc Purge đồng loạt */}
          {canOperate && d.slots.some((s) => !!s.current_lot_id) && (
            <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-xl border border-sky-200 dark:border-sky-900/60 bg-sky-50/60 dark:bg-sky-950/20">
              <div className="text-xs text-slate-700 dark:text-slate-300">
                <b>⚡ Ghi nhận vận hành đồng loạt các kênh HPLC:</b> Tự động xuất kho & tính khấu hao trên tất cả kênh đang lắp chai theo định mức chuẩn.
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-slate-500">Số mẫu / lần:</span>
                <input
                  type="number"
                  min="1"
                  max="100"
                  className={`${inputClass} w-16 text-xs font-mono font-bold`}
                  value={sampleRunsCount}
                  onChange={(e) => setSampleRunsCount(e.target.value)}
                />
                <input
                  className={`${inputClass} w-44 text-xs`}
                  placeholder="Ghi chú (VD: Mẻ tinh sạch Probe HBV)"
                  value={batchNote}
                  onChange={(e) => setBatchNote(e.target.value)}
                />
                <Button
                  onClick={() => batchUsage.mutate("RUN")}
                  disabled={batchUsage.isPending}
                  title="Trừ kho & tính khấu hao đồng loạt cho tất cả kênh hóa chất theo định mức chạy mẫu"
                >
                  ▶ Ghi chạy {sampleRunsCount || 1} mẫu HPLC
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => batchUsage.mutate("PURGE")}
                  disabled={batchUsage.isPending}
                  title="Trừ kho & tính khấu hao rửa đường ống / cân bằng hệ thống (Purge/Prime) cho tất cả kênh"
                >
                  🚿 Purge / Cân bằng máy
                </Button>
              </div>
            </div>
          )}

          {d.slots.length === 0 && <Empty>Chưa khai báo kênh hóa chất (ví dụ HPLC: Đệm TEAA A, Acetonitrile B, Đệm HFIP/TEA, Dung môi rửa).</Empty>}
          {d.slots.length > 0 && (
            <Table
              head={[
                "Kênh / Loại hóa chất HPLC",
                "Mã hàng Kho & Lô đang lắp",
                "Mức còn trong chai / Tồn kho",
                "Định mức & Số lượt chạy",
                "Giá chai & Khấu hao / mẫu",
                "Khấu hao (Chai này / Lũy kế)",
                "Lắp / Thay chai",
                "Ghi tiêu hao từng kênh",
              ]}
            >
              {d.slots.map((s) => {
                const bottleVol = Number(s.bottle_volume_base || 2500);
                const remBottle = Number(s.remaining_in_bottle ?? bottleVol);
                const pctRem = Math.max(0, Math.min(100, Math.round((remBottle / bottleVol) * 100)));
                const designRuns = Number(s.design_runs || 140);
                const runsUsed = Number(s.runs_current_bottle || 0);
                const pctRuns = Math.max(0, Math.min(100, Math.round((runsUsed / designRuns) * 100)));
                return (
                  <tr key={s.slot_no}>
                    <td className="py-2 pr-3 text-xs">
                      <div className="font-bold text-slate-800 dark:text-slate-100">
                        <span className="font-mono text-sky-700 dark:text-sky-400">#{s.slot_no}</span> {s.label}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {s.usage.map((u) => `${u.label}: ${fmtQty(u.qty)} ${s.base_uom}`).join(" · ") || "Chưa phát sinh tiêu hao trên chai này"}
                      </div>
                    </td>
                    <td className="py-2 pr-3 text-xs">
                      <div className="font-mono font-bold text-slate-700 dark:text-slate-200">{s.item_code}</div>
                      <div className="text-[11px] text-slate-500 line-clamp-1" title={s.item_name}>{s.item_name}</div>
                      <div className="mt-0.5 font-mono text-[11px]">
                        {s.lot_code ? (
                          <span className="px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 font-bold">
                            Lô: {s.lot_code}
                          </span>
                        ) : (
                          <span className="text-amber-700 dark:text-amber-400 font-bold">Chưa lắp chai</span>
                        )}
                        {s.expiry_date && <span className="ml-1 text-slate-400">HD {fmtDate(s.expiry_date)}</span>}
                      </div>
                    </td>
                    <td className="py-2 pr-3 text-xs whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        <div className="h-2 w-20 rounded bg-slate-200 dark:bg-slate-800 overflow-hidden">
                          <div
                            className={`h-full ${pctRem <= 20 ? "bg-rose-500" : pctRem <= 40 ? "bg-amber-400" : "bg-emerald-500"}`}
                            style={{ width: `${pctRem}%` }}
                          />
                        </div>
                        <span className="font-mono font-bold">
                          {fmtQty(remBottle)} / {fmtQty(bottleVol)} {s.base_uom}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-500 mt-0.5">
                        Tồn sổ kho: <b>{s.available == null ? "—" : `${fmtQty(s.available)} ${s.base_uom}`}</b>
                      </div>
                    </td>
                    <td className="py-2 pr-3 text-xs whitespace-nowrap">
                      <div>
                        Chạy mẫu: <b>{fmtQty(s.std_qty_per_run ?? 15)} {s.base_uom}</b> · Purge: <b>{fmtQty(s.std_qty_per_purge ?? 30)} {s.base_uom}</b>
                      </div>
                      <div className="flex items-center gap-1.5 mt-1">
                        <div className="h-1.5 w-16 rounded bg-slate-200 dark:bg-slate-800 overflow-hidden">
                          <div
                            className={`h-full ${pctRuns >= 100 ? "bg-rose-500" : pctRuns >= 80 ? "bg-amber-400" : "bg-sky-500"}`}
                            style={{ width: `${pctRuns}%` }}
                          />
                        </div>
                        <span className="text-[11px] text-slate-600 dark:text-slate-300">
                          <b>{runsUsed}</b> / {designRuns} lượt (Tổng: {s.runs_total ?? runsUsed})
                        </span>
                      </div>
                    </td>
                    <td className="py-2 pr-3 text-right text-xs whitespace-nowrap">
                      <div className="font-bold">{vnd(s.bottle_price_vnd)} / chai</div>
                      <div className="text-[11px] text-emerald-700 dark:text-emerald-400 font-semibold">
                        {vnd(s.cost_per_run)} / mẫu ({vnd(s.cost_per_ml)}/{s.base_uom})
                      </div>
                    </td>
                    <td className="py-2 pr-3 text-right text-xs whitespace-nowrap">
                      <div className="font-bold text-amber-700 dark:text-amber-400">{vnd(s.depreciated_current_bottle_vnd)}</div>
                      <div className="text-[11px] text-slate-500">Lũy kế: {vnd(s.depreciated_total_vnd)}</div>
                    </td>
                    <td className="py-2 pr-3">
                      {canOperate && (
                        <select
                          className={`${inputClass} w-44 text-xs`}
                          value={s.current_lot_id ?? ""}
                          disabled={bottle.isPending}
                          onChange={(e) => bottle.mutate({ slot: s.slot_no, lot: e.target.value || null })}
                          aria-label={`Chai cho vị trí ${s.label}`}
                        >
                          <option value="">— tháo chai —</option>
                          {s.lots.map((l) => (
                            <option key={l.lot_id} value={l.lot_id}>
                              {l.code} (còn {fmtQty(l.available)} {s.base_uom})
                            </option>
                          ))}
                        </select>
                      )}
                    </td>
                    <td className="py-2 pr-3">{canOperate && s.current_lot_id && <UsageForm assetId={assetId} slot={s} onDone={refresh} />}</td>
                  </tr>
                );
              })}
            </Table>
          )}
          <p className="text-[11px] text-slate-500">
            💡 <b>Cơ chế tính khấu hao hóa chất HPLC:</b> Mỗi kênh hóa chất (Đệm TEAA A, Acetonitrile B, HFIP/TEA, Dung môi rửa) được gắn trực tiếp với <b>Mã hàng & Lô trong Kho</b>. Khi chạy mẫu tinh sạch (tự động từ bước SOP hoặc bấm ghi nhận tại đây) hoặc rửa Purge/Prime hệ thống, lượng hóa chất tiêu hao được trừ trực tiếp vào Lô đang lắp và tính khấu hao = <code>Lượng tiêu hao (mL) × (Đơn giá chai / Dung tích chai)</code>.
          </p>
          {d.events.length > 0 && (
            <div>
              <div className="text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">📜 Nhật ký Lắp chai, Sử dụng & Khấu hao Hóa chất HPLC</div>
              <Table head={["Thời gian", "Kênh", "Loại sự kiện", "Lô hóa chất", "Lượng tiêu hao", "Nguồn / Ghi chú", "Người thực hiện"]}>
                {d.events.map((e, i) => (
                  <tr key={i}>
                    <td className="py-1 pr-3 text-xs whitespace-nowrap">{new Date(e.created_at).toLocaleString("vi-VN")}</td>
                    <td className="py-1 pr-3 text-xs font-bold">Kênh #{e.slot_no}</td>
                    <td className="py-1 pr-3 text-xs">{e.usage_kind ? KINDS[e.usage_kind] : EVENTS[e.event]}</td>
                    <td className="py-1 pr-3 font-mono text-xs">{e.lot_code ?? "—"}</td>
                    <td className="py-1 pr-3 text-right text-xs font-mono font-semibold">{e.qty == null ? "—" : `${fmtQty(e.qty)} mL`}</td>
                    <td className="py-1 pr-3 text-xs">{[e.source_ref, e.notes].filter(Boolean).join(" · ")}</td>
                    <td className="py-1 pr-3 text-xs">{e.by_name ?? "Hệ thống"}</td>
                  </tr>
                ))}
              </Table>
            </div>
          )}
        </div>
      )}
      {d && editing && (
        <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
          <div className="text-xs text-slate-600 dark:text-slate-300 pb-2 border-b border-slate-200 dark:border-slate-800">
            Khai báo các <b>Kênh hóa chất trên máy HPLC</b>, chọn <b>Mã hóa chất / Reagent liên kết trong Kho</b> và thiết lập <b>Dung tích chai, Định mức mL/lượt chạy, Đơn giá chai & Số lượt thiết kế</b> để hệ thống tự động theo dõi khấu hao.
          </div>

          <div className="hidden lg:grid lg:grid-cols-12 gap-2 text-[11px] font-bold text-slate-500 px-1">
            <div className="col-span-1">Kênh #</div>
            <div className="col-span-3">Tên kênh / Loại hóa chất HPLC *</div>
            <div className="col-span-3">Mã hóa chất / Reagent trong Kho *</div>
            <div className="col-span-1">Chai (mL)</div>
            <div className="col-span-1">mL/Mẫu</div>
            <div className="col-span-1">mL/Purge</div>
            <div className="col-span-1">Giá chai (đ)</div>
            <div className="col-span-1 text-right">Số lượt / Xóa</div>
          </div>

          {draft.map((s, i) => (
            <div key={i} className="grid grid-cols-1 lg:grid-cols-12 gap-2 items-center p-2 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 text-xs">
              <div className="lg:col-span-1">
                <input
                  className={`${inputClass} w-full font-mono font-bold`}
                  type="number"
                  min="1"
                  max="50"
                  value={s.slot_no}
                  onChange={(e) => setDraft(draft.map((x, j) => (j === i ? { ...x, slot_no: e.target.value } : x)))}
                  aria-label="Số vị trí"
                />
              </div>
              <div className="lg:col-span-3">
                <input
                  className={`${inputClass} w-full`}
                  placeholder="Tên vị trí (VD: Kênh A — Đệm TEAA 0.1M)"
                  value={s.label}
                  onChange={(e) => setDraft(draft.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
                  required
                />
              </div>
              <div className="lg:col-span-3">
                <ItemPicker
                  value={s.item_id}
                  current={s.item_label}
                  onChange={(id) => setDraft(draft.map((x, j) => (j === i ? { ...x, item_id: id } : x)))}
                />
              </div>
              <div className="lg:col-span-1">
                <input
                  className={`${inputClass} w-full font-mono`}
                  type="number"
                  min="1"
                  placeholder="mL/chai"
                  value={s.bottle_volume_base}
                  onChange={(e) => setDraft(draft.map((x, j) => (j === i ? { ...x, bottle_volume_base: e.target.value } : x)))}
                  title="Dung tích 1 chai chuẩn lắp lên máy (mL)"
                />
              </div>
              <div className="lg:col-span-1">
                <input
                  className={`${inputClass} w-full font-mono`}
                  type="number"
                  step="any"
                  min="0"
                  placeholder="mL/mẫu"
                  value={s.std_qty_per_run}
                  onChange={(e) => setDraft(draft.map((x, j) => (j === i ? { ...x, std_qty_per_run: e.target.value } : x)))}
                  title="Định mức tiêu hao mỗi lượt chạy mẫu (mL/mẫu)"
                />
              </div>
              <div className="lg:col-span-1">
                <input
                  className={`${inputClass} w-full font-mono`}
                  type="number"
                  step="any"
                  min="0"
                  placeholder="mL/Purge"
                  value={s.std_qty_per_purge}
                  onChange={(e) => setDraft(draft.map((x, j) => (j === i ? { ...x, std_qty_per_purge: e.target.value } : x)))}
                  title="Định mức tiêu hao mỗi lần rửa Purge/Prime (mL)"
                />
              </div>
              <div className="lg:col-span-1">
                <input
                  className={`${inputClass} w-full font-mono`}
                  type="number"
                  min="0"
                  placeholder="Giá chai"
                  value={s.bottle_price_vnd}
                  onChange={(e) => setDraft(draft.map((x, j) => (j === i ? { ...x, bottle_price_vnd: e.target.value } : x)))}
                  title="Đơn giá mua 1 chai hóa chất (VNĐ) dùng tính khấu hao"
                />
              </div>
              <div className="lg:col-span-1 flex items-center gap-1">
                <input
                  className={`${inputClass} w-16 font-mono`}
                  type="number"
                  min="1"
                  placeholder="Lượt"
                  value={s.design_runs}
                  onChange={(e) => setDraft(draft.map((x, j) => (j === i ? { ...x, design_runs: e.target.value } : x)))}
                  title="Số lượt chạy mẫu thiết kế mỗi chai"
                />
                <button
                  type="button"
                  className="text-rose-600 hover:underline font-semibold cursor-pointer"
                  onClick={() => setDraft(draft.filter((_, j) => j !== i))}
                >
                  Xóa
                </button>
              </div>
            </div>
          ))}
          <div className="flex flex-wrap gap-2 pt-1">
            <Button
              type="button"
              variant="ghost"
              onClick={() =>
                setDraft([
                  ...draft,
                  {
                    slot_no: String(Math.max(0, ...draft.map((x) => Number(x.slot_no) || 0)) + 1),
                    label: "",
                    item_id: "",
                    bottle_volume_base: "2500",
                    std_qty_per_run: "15",
                    std_qty_per_purge: "30",
                    bottle_price_vnd: "1850000",
                    design_runs: "140",
                  },
                ])
              }
            >
              + Thêm kênh hóa chất HPLC
            </Button>
            <Button type="button" variant="ghost" onClick={() => setEditing(false)}>Hủy</Button>
            <Button type="submit" disabled={save.isPending}>Lưu cấu hình kênh & định mức khấu hao</Button>
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
  const list = useMemo(() => {
    const nonSynth = (assets.data ?? []).filter((a) => a.asset_type !== "SYNTHESIZER");
    // Ưu tiên đưa hệ thống HPLC và thiết bị của phòng Oligo lên đầu
    return [...nonSynth].sort((a, b) => {
      const aHplc = a.asset_type === "HPLC" ? 0 : 1;
      const bHplc = b.asset_type === "HPLC" ? 0 : 1;
      if (aHplc !== bHplc) return aHplc - bHplc;
      return a.code.localeCompare(b.code);
    });
  }, [assets.data]);

  // Tự động mở bảng Quản lý Sử dụng & Khấu hao Hóa chất của máy HPLC ngay khi tải trang
  useEffect(() => {
    if (!open && list.length > 0) {
      const hplc = list.find((a) => a.asset_type === "HPLC") ?? list[0];
      if (hplc) setOpen(hplc.id);
    }
  }, [list, open]);

  return (
    <div className="flex flex-col gap-3">
      {open && <SlotsPanel key={open} assetId={open} canConfigure={canManage} canOperate={canOperate} onClose={() => setOpen(null)} />}
      <Card
        title="Hệ thống HPLC & Thiết bị Kiểm nghiệm / Hậu tổng hợp"
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
          <Table head={["Mã thiết bị", "Tên thiết bị", "Loại", "Phòng", "Model / Serial", "Hạn hiệu chuẩn", "Quản lý Hóa chất & Khấu hao"]}>
            {list.map((a) => (
              <tr key={a.id} className={open === a.id ? "bg-sky-50/70 dark:bg-sky-950/30" : ""}>
                <td className="py-1.5 pr-3 font-mono font-bold text-xs">{a.code}</td>
                <td className="py-1.5 pr-3 font-medium">{a.name}</td>
                <td className="py-1.5 pr-3 text-xs">
                  <span className={`px-1.5 py-0.5 rounded font-bold text-[11px] ${a.asset_type === "HPLC" ? "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300" : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"}`}>
                    {TYPES[a.asset_type] ?? a.asset_type}
                  </span>
                </td>
                <td className="py-1.5 pr-3 text-xs">{a.owner_name}</td>
                <td className="py-1.5 pr-3 text-xs">{[a.model, a.serial_no].filter(Boolean).join(" / ") || "—"}</td>
                <td className="py-1.5 pr-3 text-xs">{fmtDate(a.next_calibration_due)}</td>
                <td className="py-1.5 pr-3 text-right">
                  <Button variant={open === a.id ? "primary" : "ghost"} onClick={() => setOpen(a.id)}>
                    🧪 {a.asset_type === "HPLC" ? "Hóa chất & Khấu hao HPLC" : "Vị trí hóa chất"}
                  </Button>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}

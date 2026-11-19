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
  location?: string | null;
  next_calibration_due: string | null;
  model: string | null;
  serial_no: string | null;
}
interface UsageBreakdown {
  run_qty: number;
  purge_qty: number;
  maintenance_qty: number;
  loss_qty: number;
  total_qty: number;
  run_vnd: number;
  purge_vnd: number;
  maintenance_vnd: number;
  loss_vnd: number;
  total_vnd: number;
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
  current_breakdown?: UsageBreakdown;
  all_time_breakdown?: UsageBreakdown;
  available: number | null;
  lots: { lot_id: string; code: string; available: number; expiry_date: string | null }[];
  usage: { kind: string; label: string; qty: number }[];
}
interface SlotEventRow {
  slot_no: number;
  event: string;
  usage_kind: string | null;
  qty: number | null;
  source_ref: string | null;
  notes: string | null;
  created_at: string;
  lot_code: string | null;
  by_name: string | null;
}
interface SlotsData {
  asset: { id: string; code: string; name: string; asset_type?: string };
  slots: Slot[];
  events: SlotEventRow[];
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
  RUN: "Tiêu hao trực tiếp (Chạy mẫu / Tinh sạch)",
  PURGE: "Hao hụt quy trình — Overhead (Purge / Cân bằng)",
  MAINTENANCE: "Hao hụt rửa / Bảo trì máy",
  LOSS: "Chênh lệch thanh lý / Hao hụt khác (Bay hơi, đổ vỡ)",
};
const KIND_BADGE: Record<string, { label: string; cls: string }> = {
  RUN: { label: "Trực tiếp", cls: "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200" },
  PURGE: { label: "Overhead (Purge)", cls: "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300" },
  MAINTENANCE: { label: "Rửa / Bảo trì", cls: "bg-sky-100 text-sky-800 dark:bg-sky-950/60 dark:text-sky-300" },
  LOSS: { label: "Thanh lý / Loss", cls: "bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300" },
};
const EVENTS: Record<string, string> = { INSTALL: "Lắp chai", REMOVE: "Tháo chai", USAGE: "Tiêu hao" };
const vnd = (v: number | null | undefined) => `${Math.round(Number(v || 0)).toLocaleString("vi-VN", { maximumFractionDigits: 0 })} đ`;
const compactBtnCls = "px-2! py-1! min-h-7! text-[11px]! rounded-lg!";

function emptyBreakdown(): UsageBreakdown {
  return {
    run_qty: 0,
    purge_qty: 0,
    maintenance_qty: 0,
    loss_qty: 0,
    total_qty: 0,
    run_vnd: 0,
    purge_vnd: 0,
    maintenance_vnd: 0,
    loss_vnd: 0,
    total_vnd: 0,
  };
}

function useOligoUnitList() {
  const units = useOligoUnits("asset.manage");
  return useMemo(() => {
    const list = units.data ?? [];
    const oligoOnly = list.filter((u: any) => u.module_key === "OLIGO" || u.code === "P-OLIGO");
    return oligoOnly.length > 0 ? oligoOnly : list;
  }, [units.data]);
}

function NewInstrument({ onCreated }: { onCreated?: (assetId: string) => void }) {
  const qc = useQueryClient();
  const oligoUnits = useOligoUnitList();
  const [f, setF] = useState({ owner_org_unit_id: "", asset_type: "HPLC", name: "", model: "", serial_no: "", next_calibration_due: "" });
  const create = useMutation({
    mutationFn: () =>
      api<{ id: string; code: string }>("/api/factory/assets", {
        method: "POST",
        idempotent: true,
        json: {
          ...f,
          owner_org_unit_id: f.owner_org_unit_id || oligoUnits[0]?.id,
          model: f.model || null,
          serial_no: f.serial_no || null,
          next_calibration_due: f.next_calibration_due || null,
        },
      }),
    onSuccess: (created) => {
      setF({ ...f, name: "", model: "", serial_no: "" });
      qc.invalidateQueries({ queryKey: ["factory", "assets"] });
      if (created?.id) onCreated?.(created.id);
    },
  });
  if (!oligoUnits.length) return null;
  return (
    <form className="grid gap-3 sm:grid-cols-3 lg:grid-cols-7 items-end mb-4 p-3 rounded-xl bg-slate-50 dark:bg-slate-950/50 border border-slate-200 dark:border-slate-800" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
      {oligoUnits.length > 1 && (
        <Field label="Phòng">
          <select className={inputClass} value={f.owner_org_unit_id} onChange={(e) => setF({ ...f, owner_org_unit_id: e.target.value })} required>
            <option value="">Chọn</option>
            {oligoUnits.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
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

function QuickAddHplcForm({
  currentAssetId,
  hplcAssets,
  onCancel,
  onCreated,
}: {
  currentAssetId: string;
  hplcAssets: Asset[];
  onCancel: () => void;
  onCreated: (newAssetId: string) => void;
}) {
  const qc = useQueryClient();
  const oligoUnits = useOligoUnitList();
  const [name, setName] = useState("");
  const [model, setModel] = useState("");
  const [serialNo, setSerialNo] = useState("");
  const [nextCal, setNextCal] = useState("");
  const [cloneFromId, setCloneFromId] = useState(currentAssetId || "");

  const create = useMutation({
    mutationFn: async () => {
      const created = await api<{ id: string; code: string }>("/api/factory/assets", {
        method: "POST",
        idempotent: true,
        json: {
          owner_org_unit_id: oligoUnits[0]?.id,
          asset_type: "HPLC",
          name: name.trim(),
          model: model.trim() || null,
          serial_no: serialNo.trim() || null,
          next_calibration_due: nextCal || null,
        },
      });
      if (cloneFromId) {
        const src = await api<SlotsData>(`/api/factory/assets/${cloneFromId}/slots`);
        if (src.slots.length > 0) {
          await api(`/api/factory/assets/${created.id}/slots`, {
            method: "PUT",
            json: {
              slots: src.slots.map((s) => ({
                slot_no: s.slot_no,
                label: s.label,
                item_id: s.item_id,
                bottle_volume_base: s.bottle_volume_base ?? 2500,
                std_qty_per_run: s.std_qty_per_run ?? 15,
                std_qty_per_purge: s.std_qty_per_purge ?? 30,
                bottle_price_vnd: s.bottle_price_vnd ?? 1850000,
                design_runs: s.design_runs ?? 140,
              })),
            },
          });
        }
      }
      return created;
    },
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: ["factory", "assets"] });
      onCreated(created.id);
    },
  });

  if (!oligoUnits.length) return null;

  return (
    <form
      className="p-3 rounded-xl border border-sky-200 dark:border-sky-800 bg-sky-50/70 dark:bg-sky-950/30 flex flex-col gap-2.5"
      onSubmit={(e) => {
        e.preventDefault();
        create.mutate();
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs font-bold text-sky-900 dark:text-sky-200">
          ➕ Khai báo thêm máy HPLC mới (quản lý kênh hóa chất, lô gắn chai & khấu hao độc lập hoàn toàn với các máy khác)
        </div>
        <Button type="button" variant="ghost" className={compactBtnCls} onClick={onCancel}>
          Đóng
        </Button>
      </div>
      <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-5 items-end">
        <Field label="Tên hệ thống HPLC *">
          <input
            className={inputClass}
            placeholder="VD: Hệ thống HPLC Agilent 1260 - Máy 2"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </Field>
        <Field label="Model / Hãng">
          <input className={inputClass} placeholder="VD: Waters Arc / Shimadzu LC-20" value={model} onChange={(e) => setModel(e.target.value)} />
        </Field>
        <Field label="Số serial">
          <input className={inputClass} placeholder="Serial thiết bị" value={serialNo} onChange={(e) => setSerialNo(e.target.value)} />
        </Field>
        <Field label="Hạn hiệu chuẩn">
          <input className={inputClass} type="date" value={nextCal} onChange={(e) => setNextCal(e.target.value)} />
        </Field>
        <Field label="Khởi tạo danh sách kênh hóa chất">
          <select className={inputClass} value={cloneFromId} onChange={(e) => setCloneFromId(e.target.value)}>
            <option value="">— Để trống (tự khai báo kênh riêng) —</option>
            {hplcAssets.map((a) => (
              <option key={a.id} value={a.id}>
                Sao chép cấu hình kênh từ {a.code} (chưa gắn lô)
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-slate-500">
          Mỗi máy HPLC sau khi tạo sẽ có bộ kênh dung môi, lô chai đang lắp và nhật ký tiêu hao tách biệt 100%.
        </span>
        <div className="flex items-center gap-2">
          <Button type="button" variant="ghost" className={compactBtnCls} onClick={onCancel}>
            Hủy
          </Button>
          <Button type="submit" disabled={create.isPending}>
            {create.isPending ? "Đang tạo máy HPLC..." : "✓ Tạo máy HPLC & Mở quản lý hóa chất"}
          </Button>
        </div>
      </div>
      <ErrorNote error={create.error} />
    </form>
  );
}

function SlotUsageDrawer({
  assetId,
  slot,
  onMountLot,
  mountingLot,
  onDone,
  onClose,
}: {
  assetId: string;
  slot: Slot;
  onMountLot: (lotId: string) => void;
  mountingLot: boolean;
  onDone: () => void;
  onClose: () => void;
}) {
  const stdRun = slot.std_qty_per_run ?? 15;
  const stdPurge = slot.std_qty_per_purge ?? 30;
  const [kind, setKind] = useState<string>("PURGE");
  const [qty, setQty] = useState<string>(String(stdPurge));
  const [sourceRef, setSourceRef] = useState<string>("");
  const [notes, setNotes] = useState<string>("");

  const log = useMutation({
    mutationFn: () =>
      api(`/api/factory/assets/${assetId}/slots/${slot.slot_no}/usage`, {
        method: "POST",
        idempotent: true,
        json: {
          kind,
          qty: Number(qty),
          source_ref: sourceRef.trim() || null,
          notes: notes.trim() || null,
        },
      }),
    onSuccess: () => {
      onDone();
      onClose();
    },
  });

  const handleKindChange = (nextKind: string) => {
    setKind(nextKind);
    if (nextKind === "RUN") setQty(String(stdRun));
    else if (nextKind === "PURGE") setQty(String(stdPurge));
    else if (nextKind === "MAINTENANCE") setQty(String(stdPurge));
    else if (nextKind === "LOSS") setQty("");
  };

  return (
    <div className="p-3 rounded-xl border border-sky-200 dark:border-sky-800 bg-sky-50/50 dark:bg-sky-950/30 flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs font-bold text-slate-800 dark:text-slate-100">
          📝 Cập nhật Tiêu hao & Hao hụt khác — <span className="text-sky-700 dark:text-sky-400">#{slot.slot_no} {slot.label}</span>
        </div>
        <Button type="button" variant="ghost" className={compactBtnCls} onClick={onClose}>
          Đóng
        </Button>
      </div>

      {!slot.current_lot_id ? (
        <div className="flex flex-wrap items-center gap-2 p-2.5 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-xs">
          <span className="font-semibold text-amber-800 dark:text-amber-200">
            Kênh này chưa gắn lô/chai nào. Chọn lô hóa chất để gắn vào máy trước khi ghi nhận tiêu hao:
          </span>
          <select
            className={`${inputClass} w-64 text-xs`}
            value=""
            disabled={mountingLot}
            onChange={(e) => {
              if (e.target.value) onMountLot(e.target.value);
            }}
          >
            <option value="">-- Chọn lô từ kho để gắn chai --</option>
            {slot.lots.map((l) => (
              <option key={l.lot_id} value={l.lot_id}>
                {l.code} (còn {fmtQty(l.available)} {slot.base_uom})
              </option>
            ))}
          </select>
        </div>
      ) : (
        <form
          className="grid gap-2.5 sm:grid-cols-12 items-end"
          onSubmit={(e) => {
            e.preventDefault();
            log.mutate();
          }}
        >
          <div className="sm:col-span-4">
            <Field label="Phân loại tiêu hao / hao hụt *">
              <select className={inputClass} value={kind} onChange={(e) => handleKindChange(e.target.value)}>
                {Object.entries(KINDS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field label={`Lượng (${slot.base_uom}) *`}>
              <input
                className={`${inputClass} font-mono font-bold`}
                type="number"
                step="any"
                min="0.001"
                placeholder={slot.base_uom}
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                required
              />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="Mã mẻ / Tham chiếu">
              <input
                className={inputClass}
                placeholder="VD: Purge đầu ca / Rửa cột"
                value={sourceRef}
                onChange={(e) => setSourceRef(e.target.value)}
              />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="Ghi chú chi tiết">
              <input
                className={inputClass}
                placeholder="Nguyên nhân / Người thực hiện"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </Field>
          </div>
          <div className="sm:col-span-2 flex gap-1.5">
            <Button type="submit" disabled={log.isPending} className="w-full">
              {log.isPending ? "Đang lưu..." : `✓ Ghi (${slot.base_uom})`}
            </Button>
          </div>
          <div className="sm:col-span-12 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
            <span>Gợi ý nhanh:</span>
            <button
              type="button"
              className="px-2 py-0.5 rounded border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              onClick={() => {
                setKind("RUN");
                setQty(String(stdRun));
              }}
            >
              1× Chạy mẫu ({fmtQty(stdRun)} {slot.base_uom})
            </button>
            <button
              type="button"
              className="px-2 py-0.5 rounded border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              onClick={() => {
                setKind("PURGE");
                setQty(String(stdPurge));
              }}
            >
              1× Overhead/Purge ({fmtQty(stdPurge)} {slot.base_uom})
            </button>
            <button
              type="button"
              className="px-2 py-0.5 rounded border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              onClick={() => {
                setKind("MAINTENANCE");
                setQty(String(stdPurge * 2));
              }}
            >
              Rửa/Bảo trì ({fmtQty(stdPurge * 2)} {slot.base_uom})
            </button>
            <button
              type="button"
              className="px-2 py-0.5 rounded border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/40 cursor-pointer"
              onClick={() => {
                setKind("LOSS");
                setQty("10");
              }}
            >
              Hao hụt bay hơi / Loss
            </button>
            <span className="ml-auto">
              Đang gắn lô <b className="font-mono">{slot.lot_code}</b> (Tồn kho còn {fmtQty(slot.available ?? 0)} {slot.base_uom})
            </span>
          </div>
        </form>
      )}
      <ErrorNote error={log.error} />
    </div>
  );
}

function SlotEmptyDrawer({
  assetId,
  slot,
  onDone,
  onClose,
}: {
  assetId: string;
  slot: Slot;
  onDone: () => void;
  onClose: () => void;
}) {
  const bottleVol = Number(slot.bottle_volume_base || 2500);
  const remBottle = Number(slot.remaining_in_bottle ?? 0);
  const lotAvail = Number(slot.available ?? 0);
  const suggestedLoss = Math.max(0, Math.round(Math.min(remBottle, lotAvail) * 100) / 100);
  const [lossQty, setLossQty] = useState<string>(String(suggestedLoss));
  const [notes, setNotes] = useState<string>("Chai đã dùng hết thực tế trên máy HPLC");

  const reportEmpty = useMutation({
    mutationFn: () =>
      api<{ ok: boolean; loss_qty: number }>(`/api/factory/assets/${assetId}/slots/${slot.slot_no}/bottle`, {
        method: "POST",
        idempotent: true,
        json: {
          loss_qty: lossQty === "" ? undefined : Number(lossQty),
          notes: notes.trim() || null,
        },
      }),
    onSuccess: () => {
      onDone();
      onClose();
    },
  });

  return (
    <div className="p-3 rounded-xl border border-rose-200 dark:border-rose-900 bg-rose-50/60 dark:bg-rose-950/30 flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs font-bold text-rose-900 dark:text-rose-200">
          ✓ Báo hết chai hóa chất & Thanh lý phần dư — #{slot.slot_no} {slot.label}
        </div>
        <Button type="button" variant="ghost" className={compactBtnCls} onClick={onClose}>
          Đóng
        </Button>
      </div>
      {!slot.current_lot_id ? (
        <div className="text-xs text-slate-600 dark:text-slate-300">
          Kênh này hiện đang ở trạng thái chưa gắn chai/lô nào.
        </div>
      ) : (
        <form
          className="grid gap-2.5 sm:grid-cols-12 items-end"
          onSubmit={(e) => {
            e.preventDefault();
            reportEmpty.mutate();
          }}
        >
          <div className="sm:col-span-12 text-xs text-slate-700 dark:text-slate-300 flex flex-wrap gap-4">
            <span>Lô đang gắn: <b className="font-mono">{slot.lot_code}</b></span>
            <span>Dung tích chai: <b>{fmtQty(bottleVol)} {slot.base_uom}</b></span>
            <span>Đã tiêu hao trên chai: <b>{fmtQty(slot.used_current_bottle ?? 0)} {slot.base_uom}</b></span>
            <span>Phần dư dự kiến còn lại: <b className="text-rose-700 dark:text-rose-300">{fmtQty(remBottle)} {slot.base_uom}</b></span>
            <span>Tồn sổ kho lô: <b>{fmtQty(lotAvail)} {slot.base_uom}</b></span>
          </div>
          <div className="sm:col-span-3">
            <Field label={`Ghi vào Chênh lệch thanh lý — LOSS (${slot.base_uom})`}>
              <input
                className={`${inputClass} font-mono font-bold`}
                type="number"
                step="any"
                min="0"
                max={lotAvail}
                value={lossQty}
                onChange={(e) => setLossQty(e.target.value)}
              />
            </Field>
          </div>
          <div className="sm:col-span-6">
            <Field label="Ghi chú báo hết / thanh lý">
              <input className={inputClass} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </Field>
          </div>
          <div className="sm:col-span-3 flex gap-1.5">
            <Button type="button" variant="ghost" onClick={onClose}>
              Hủy
            </Button>
            <Button type="submit" variant="danger" disabled={reportEmpty.isPending} className="flex-1">
              {reportEmpty.isPending ? "Đang xử lý..." : "✓ Xác nhận Báo hết & Tháo chai"}
            </Button>
          </div>
        </form>
      )}
      <ErrorNote error={reportEmpty.error} />
    </div>
  );
}

function SlotDetailDrawer({ slot, events, onClose }: { slot: Slot; events: SlotEventRow[]; onClose: () => void }) {
  const slotEvents = useMemo(() => events.filter((e) => e.slot_no === slot.slot_no), [events, slot.slot_no]);
  return (
    <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-900/70 flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs font-bold text-slate-800 dark:text-slate-100">
          ≡ Chi tiết nhật ký Lắp chai & Tiêu hao — #{slot.slot_no} {slot.label} ({slot.item_code})
        </div>
        <Button type="button" variant="ghost" className={compactBtnCls} onClick={onClose}>
          Đóng
        </Button>
      </div>
      {slotEvents.length === 0 ? (
        <div className="text-xs text-slate-400 py-2">Chưa có sự kiện lắp chai hoặc tiêu hao nào cho kênh này.</div>
      ) : (
        <Table head={["Thời gian", "Phân loại", "Lô hóa chất", "Lượng", "Chi phí (~đ)", "Nguồn / Ghi chú", "Người thực hiện"]}>
          {slotEvents.map((e, idx) => {
            const badge = e.usage_kind ? KIND_BADGE[e.usage_kind] : null;
            const costEst = e.qty != null && slot.cost_per_ml != null ? Math.round(e.qty * slot.cost_per_ml) : null;
            return (
              <tr key={idx}>
                <td className="py-1 pr-3 text-xs whitespace-nowrap">{new Date(e.created_at).toLocaleString("vi-VN")}</td>
                <td className="py-1 pr-3 text-xs">
                  {badge ? (
                    <span className={`px-1.5 py-0.5 rounded font-semibold text-[11px] ${badge.cls}`}>{badge.label}</span>
                  ) : (
                    <span>{EVENTS[e.event] ?? e.event}</span>
                  )}
                </td>
                <td className="py-1 pr-3 font-mono text-xs">{e.lot_code ?? "—"}</td>
                <td className="py-1 pr-3 text-right text-xs font-mono font-semibold">
                  {e.qty == null ? "—" : `${fmtQty(e.qty)} ${slot.base_uom}`}
                </td>
                <td className="py-1 pr-3 text-right text-xs font-mono">{costEst == null ? "—" : vnd(costEst)}</td>
                <td className="py-1 pr-3 text-xs">{[e.source_ref, e.notes].filter(Boolean).join(" · ") || "—"}</td>
                <td className="py-1 pr-3 text-xs">{e.by_name ?? "Hệ thống"}</td>
              </tr>
            );
          })}
        </Table>
      )}
    </div>
  );
}

export function SlotsPanel({
  assetId,
  hplcAssets = [],
  onSelectAsset,
  canConfigure,
  canOperate,
  onClose,
}: {
  assetId: string;
  hplcAssets?: Asset[];
  onSelectAsset?: (id: string) => void;
  canConfigure: boolean;
  canOperate: boolean;
  onClose?: () => void;
}) {
  const qc = useQueryClient();
  const data = useQuery({ queryKey: ["factory", "asset-slots", assetId], queryFn: () => api<SlotsData>(`/api/factory/assets/${assetId}/slots`) });
  const [editing, setEditing] = useState(false);
  const [showAddMachine, setShowAddMachine] = useState(false);
  const [confirmRetire, setConfirmRetire] = useState(false);
  const [retireReason, setRetireReason] = useState("Ngừng sử dụng thiết bị HPLC theo yêu cầu quản lý");
  const [cloneSourceId, setCloneSourceId] = useState("");
  const [metricScope, setMetricScope] = useState<"BOTTLE" | "ALL_TIME" | null>(null);
  const [drawer, setDrawer] = useState<{ slotNo: number; mode: "DETAIL" | "USAGE" | "EMPTY" | "DELETE" } | null>(null);
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
    setDrawer(null);
    setConfirmRetire(false);
  }, [assetId]);

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

  const cloneFromExisting = useMutation({
    mutationFn: async (srcId: string) => {
      const src = await api<SlotsData>(`/api/factory/assets/${srcId}/slots`);
      await api(`/api/factory/assets/${assetId}/slots`, {
        method: "PUT",
        json: {
          slots: src.slots.map((s) => ({
            slot_no: s.slot_no,
            label: s.label,
            item_id: s.item_id,
            bottle_volume_base: s.bottle_volume_base ?? 2500,
            std_qty_per_run: s.std_qty_per_run ?? 15,
            std_qty_per_purge: s.std_qty_per_purge ?? 30,
            bottle_price_vnd: s.bottle_price_vnd ?? 1850000,
            design_runs: s.design_runs ?? 140,
          })),
        },
      });
    },
    onSuccess: refresh,
  });

  const bottle = useMutation({
    mutationFn: ({ slot, lot }: { slot: number; lot: string | null }) =>
      api(`/api/factory/assets/${assetId}/slots/${slot}/bottle`, { method: "PUT", json: { lot_id: lot } }),
    onSuccess: refresh,
  });

  const removeSlot = useMutation({
    mutationFn: (slotNo: number) => api(`/api/factory/assets/${assetId}/slots/${slotNo}`, { method: "DELETE" }),
    onSuccess: () => {
      setDrawer(null);
      refresh();
    },
  });

  const retireAsset = useMutation({
    mutationFn: () =>
      api(`/api/factory/assets/${assetId}`, {
        method: "PATCH",
        json: { status: "RETIRED", reason: retireReason.trim() || "Ngừng sử dụng thiết bị HPLC" },
      }),
    onSuccess: () => {
      setConfirmRetire(false);
      qc.invalidateQueries({ queryKey: ["factory", "assets"] });
      const remaining = hplcAssets.filter((a) => a.id !== assetId);
      if (remaining[0] && onSelectAsset) onSelectAsset(remaining[0].id);
      else onClose?.();
    },
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

  const effectiveScope: "BOTTLE" | "ALL_TIME" = metricScope ?? (kpi.activeCount > 0 ? "BOTTLE" : "ALL_TIME");
  const otherInstruments = useMemo(() => hplcAssets.filter((a) => a.id !== assetId), [hplcAssets, assetId]);
  const onlyHplcList = useMemo(() => {
    const hplcs = hplcAssets.filter((a) => a.asset_type === "HPLC");
    return hplcs.length > 0 ? hplcs : hplcAssets;
  }, [hplcAssets]);

  return (
    <Card
      title={
        d
          ? `💧 Theo dõi Hao hụt, Sử dụng & Khấu hao Dung môi HPLC — ${d.asset.code} (${d.asset.name})`
          : "Theo dõi Hao hụt & Tiêu hao Dung môi HPLC"
      }
      actions={
        <div className="flex flex-wrap items-center gap-2">
          {canConfigure && !editing && (
            <Button type="button" variant="ghost" onClick={() => setEditing(true)}>
              ⚙ Cấu hình kênh & Chọn mã hóa chất kho
            </Button>
          )}
          {editing && (
            <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
              ← Quay lại bảng theo dõi tiêu hao
            </Button>
          )}
          {onClose && (
            <Button type="button" variant="ghost" onClick={onClose}>
              Đóng
            </Button>
          )}
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        {/* Thanh chuyển nhanh giữa nhiều máy HPLC + Thêm/Xóa máy độc lập */}
        {(hplcAssets.length > 0 || canConfigure) && (
          <div className="flex flex-wrap items-center justify-between gap-2.5 p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-950/60">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Thiết bị HPLC:</span>
              {hplcAssets.length > 0 && onSelectAsset ? (
                <select
                  className={`${inputClass} w-72 font-semibold text-xs`}
                  value={assetId}
                  onChange={(e) => onSelectAsset(e.target.value)}
                  aria-label="Chọn thiết bị HPLC"
                >
                  {hplcAssets.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({a.code})
                    </option>
                  ))}
                </select>
              ) : (
                <span className="text-xs font-bold text-slate-800 dark:text-slate-100">
                  {d ? `${d.asset.name} (${d.asset.code})` : "Đang tải..."}
                </span>
              )}
              <span className="px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 text-[11px] font-semibold">
                Độc lập kênh, lô chai & tiêu hao từng máy
              </span>
            </div>
            {canConfigure && (
              <div className="flex flex-wrap items-center gap-1.5">
                <Button
                  type="button"
                  onClick={() => {
                    setShowAddMachine((v) => !v);
                    setConfirmRetire(false);
                  }}
                >
                  {showAddMachine ? "Đóng form thêm máy" : "+ Thêm máy HPLC mới"}
                </Button>
                <Button
                  type="button"
                  variant="danger"
                  onClick={() => {
                    setConfirmRetire((v) => !v);
                    setShowAddMachine(false);
                  }}
                >
                  🗑️ Ngừng / Xóa máy này
                </Button>
              </div>
            )}
          </div>
        )}

        {canConfigure && showAddMachine && onSelectAsset && (
          <QuickAddHplcForm
            currentAssetId={assetId}
            hplcAssets={onlyHplcList}
            onCancel={() => setShowAddMachine(false)}
            onCreated={(newId) => {
              setShowAddMachine(false);
              onSelectAsset(newId);
            }}
          />
        )}

        {canConfigure && confirmRetire && (
          <form
            className="p-3 rounded-xl border border-rose-200 dark:border-rose-900 bg-rose-50/70 dark:bg-rose-950/30 flex flex-wrap items-end gap-2.5"
            onSubmit={(e) => {
              e.preventDefault();
              retireAsset.mutate();
            }}
          >
            <div className="flex-1 min-w-56">
              <Field label={`Lý do ngừng sử dụng máy ${d?.asset.code ?? ""} *`}>
                <input
                  className={inputClass}
                  value={retireReason}
                  onChange={(e) => setRetireReason(e.target.value)}
                  minLength={3}
                  required
                />
              </Field>
            </div>
            <Button type="button" variant="ghost" onClick={() => setConfirmRetire(false)}>
              Hủy
            </Button>
            <Button type="submit" variant="danger" disabled={retireAsset.isPending}>
              {retireAsset.isPending ? "Đang ngừng máy..." : "✓ Xác nhận ngừng / xóa máy này"}
            </Button>
          </form>
        )}

        <ErrorNote
          error={data.error ?? bottle.error ?? batchUsage.error ?? removeSlot.error ?? retireAsset.error ?? cloneFromExisting.error}
        />

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
                  <div className="text-[11px] text-slate-400">Riêng cho máy {d.asset.code}</div>
                </div>
                <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50">
                  <div className="text-[11px] text-slate-500">Tổng giá trị bộ chai cấu hình</div>
                  <div className="text-base font-extrabold text-slate-800 dark:text-slate-100">{vnd(kpi.totalBottleValue)}</div>
                  <div className="text-[11px] text-slate-400">Pha động, Đệm Ion-Pair & Dung môi rửa</div>
                </div>
                <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50">
                  <div className="text-[11px] text-slate-500">Khấu hao chuẩn / 1 lượt chạy mẫu</div>
                  <div className="text-base font-extrabold text-emerald-700 dark:text-emerald-400">{vnd(kpi.totalCostPerSampleRun)} / mẫu</div>
                  <div className="text-[11px] text-slate-400">Cộng gộp định mức tất cả kênh</div>
                </div>
                <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50">
                  <div className="text-[11px] text-slate-500">Tổng chi phí tiêu hao & hao hụt lũy kế</div>
                  <div className="text-base font-extrabold text-amber-700 dark:text-amber-400">{vnd(kpi.totalDepreciated)}</div>
                  <div className="text-[11px] text-slate-400">Trực tiếp + Overhead + Rửa/Bảo trì + Loss</div>
                </div>
              </div>
            )}

            {/* Thanh ghi nhận nhanh 1 mẻ chạy mẫu HPLC hoặc Purge đồng loạt */}
            {canOperate && d.slots.some((s) => !!s.current_lot_id) && (
              <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-xl border border-sky-200 dark:border-sky-900/60 bg-sky-50/60 dark:bg-sky-950/20">
                <div className="text-xs text-slate-700 dark:text-slate-300">
                  <b>⚡ Ghi nhận đồng loạt trên {d.asset.code}:</b> Tự động trừ kho & tính khấu hao trên các kênh đang lắp chai. Muốn ghi riêng bảo trì / bay hơi / purge từng kênh, bấm nút <b>📝 Tiêu hao</b> ở dòng tương ứng.
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
                    type="button"
                    onClick={() => batchUsage.mutate("RUN")}
                    disabled={batchUsage.isPending}
                    title="Trừ kho & tính khấu hao trực tiếp cho tất cả kênh đang gắn chai"
                  >
                    ▶ Ghi chạy {sampleRunsCount || 1} mẫu
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => batchUsage.mutate("PURGE")}
                    disabled={batchUsage.isPending}
                    title="Ghi hao hụt quy trình (Overhead / Purge / Prime) đồng loạt cho tất cả kênh"
                  >
                    🚿 Purge / Overhead
                  </Button>
                </div>
              </div>
            )}

            {d.slots.length === 0 && (
              <div className="p-4 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/40 flex flex-col gap-3 items-start">
                <div className="text-xs text-slate-700 dark:text-slate-300">
                  Máy <b>{d.asset.name} ({d.asset.code})</b> hiện chưa khai báo kênh dung môi / hóa chất riêng. Hãy tự khai báo hoặc sao chép cấu hình kênh từ một máy HPLC khác:
                </div>
                {canConfigure && (
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      onClick={() => {
                        setDraft([
                          {
                            slot_no: "1",
                            label: "Kênh A — Pha động A",
                            item_id: "",
                            bottle_volume_base: "2500",
                            std_qty_per_run: "15",
                            std_qty_per_purge: "30",
                            bottle_price_vnd: "1850000",
                            design_runs: "140",
                          },
                        ]);
                        setEditing(true);
                      }}
                    >
                      + Tự khai báo kênh hóa chất riêng
                    </Button>
                    {otherInstruments.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <select
                          className={`${inputClass} w-64 text-xs`}
                          value={cloneSourceId}
                          onChange={(e) => setCloneSourceId(e.target.value)}
                        >
                          <option value="">-- Chọn máy HPLC nguồn để sao chép kênh --</option>
                          {otherInstruments.map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.name} ({a.code})
                            </option>
                          ))}
                        </select>
                        <Button
                          type="button"
                          variant="secondary"
                          disabled={!cloneSourceId || cloneFromExisting.isPending}
                          onClick={() => cloneSourceId && cloneFromExisting.mutate(cloneSourceId)}
                        >
                          📋 Sao chép kênh từ máy này
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {d.slots.length > 0 && (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div className="text-slate-500">
                    Hiển thị 4 cột tiêu hao theo: <b>{effectiveScope === "BOTTLE" ? "Chai đang gắn hiện tại" : `Lũy kế toàn thời gian trên ${d.asset.code}`}</b>
                  </div>
                  <div className="inline-flex rounded-xl border border-slate-200 dark:border-slate-700 p-0.5 bg-slate-100 dark:bg-slate-800">
                    <button
                      type="button"
                      onClick={() => setMetricScope("BOTTLE")}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-bold cursor-pointer transition-colors ${
                        effectiveScope === "BOTTLE"
                          ? "bg-white dark:bg-slate-900 text-sky-700 dark:text-sky-300 shadow-xs"
                          : "text-slate-600 dark:text-slate-300"
                      }`}
                    >
                      Chai đang gắn
                    </button>
                    <button
                      type="button"
                      onClick={() => setMetricScope("ALL_TIME")}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-bold cursor-pointer transition-colors ${
                        effectiveScope === "ALL_TIME"
                          ? "bg-white dark:bg-slate-900 text-sky-700 dark:text-sky-300 shadow-xs"
                          : "text-slate-600 dark:text-slate-300"
                      }`}
                    >
                      Lũy kế trên máy
                    </button>
                  </div>
                </div>

                <Table
                  head={[
                    "Hóa chất / Mã",
                    "Chai / Lô đang gắn (Lot & Stock)",
                    "Tiêu hao trực tiếp",
                    "Hao hụt quy trình (Overhead)",
                    "Hao hụt rửa / Bảo trì máy",
                    "Chênh lệch thanh lý (Loss)",
                    "Tổng chi phí & Còn lại",
                    "Thao tác",
                  ]}
                >
                  {d.slots.map((s) => {
                    const bottleVol = Number(s.bottle_volume_base || 2500);
                    const remBottle = Number(s.remaining_in_bottle ?? 0);
                    const pctRem = s.current_lot_id ? Math.max(0, Math.min(100, Math.round((remBottle / bottleVol) * 100))) : 0;
                    const designRuns = Number(s.design_runs || 140);
                    const runsUsed = Number(s.runs_current_bottle || 0);
                    const bd =
                      (effectiveScope === "BOTTLE" ? s.current_breakdown : s.all_time_breakdown) ?? emptyBreakdown();
                    const isDrawerOpen = drawer?.slotNo === s.slot_no;

                    return (
                      <React.Fragment key={s.slot_no}>
                        <tr className={isDrawerOpen ? "bg-sky-50/40 dark:bg-sky-950/20" : ""}>
                          <td className="py-2 pr-3 text-xs">
                            <div className="font-bold text-slate-800 dark:text-slate-100">
                              <span className="font-mono text-sky-700 dark:text-sky-400">#{s.slot_no}</span> {s.label}
                            </div>
                            <div className="text-[11px] text-amber-700 dark:text-amber-400 font-mono">
                              Mã nguyên liệu: {s.item_code}
                            </div>
                            <div className="text-[11px] text-slate-400">
                              Định mức: {fmtQty(s.std_qty_per_run ?? 15)} {s.base_uom}/mẫu · {fmtQty(s.std_qty_per_purge ?? 30)} {s.base_uom}/purge
                            </div>
                          </td>

                          <td className="py-2 pr-3 text-xs">
                            {canOperate ? (
                              <select
                                className={`${inputClass} w-48 text-xs`}
                                value={s.current_lot_id ?? ""}
                                disabled={bottle.isPending}
                                onChange={(e) => bottle.mutate({ slot: s.slot_no, lot: e.target.value || null })}
                                aria-label={`Chai cho vị trí ${s.label}`}
                              >
                                <option value="">-- Chưa chọn lô --</option>
                                {s.lots.map((l) => (
                                  <option key={l.lot_id} value={l.lot_id}>
                                    {l.code} (còn {fmtQty(l.available)} {s.base_uom})
                                  </option>
                                ))}
                              </select>
                            ) : s.lot_code ? (
                              <span className="px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 font-mono font-bold">
                                {s.lot_code}
                              </span>
                            ) : (
                              <span className="text-slate-400">-- Chưa gắn chai --</span>
                            )}
                            <div className="text-[11px] text-slate-500 mt-1">
                              Giá mua: <b>{vnd(s.bottle_price_vnd)}</b> | Dung lượng: <b>{fmtQty(bottleVol)} {s.base_uom}</b>
                            </div>
                            {s.current_lot_id && (
                              <div className="text-[11px] text-slate-400">
                                Tồn kho lô: <b className="text-slate-600 dark:text-slate-300">{fmtQty(s.available ?? 0)} {s.base_uom}</b>
                                {s.expiry_date ? ` · HSD ${fmtDate(s.expiry_date)}` : ""}
                              </div>
                            )}
                          </td>

                          <td className="py-2 pr-3 text-right text-xs whitespace-nowrap">
                            <div className="font-mono font-bold text-slate-800 dark:text-slate-100">
                              {fmtQty(bd.run_qty)} {s.base_uom}
                            </div>
                            <div className="text-[11px] text-slate-500">{vnd(bd.run_vnd)}</div>
                          </td>

                          <td className="py-2 pr-3 text-right text-xs whitespace-nowrap">
                            <div className="font-mono font-bold text-amber-700 dark:text-amber-400">
                              {fmtQty(bd.purge_qty)} {s.base_uom}
                            </div>
                            <div className="text-[11px] text-slate-500">{vnd(bd.purge_vnd)}</div>
                          </td>

                          <td className="py-2 pr-3 text-right text-xs whitespace-nowrap">
                            <div className="font-mono font-bold text-sky-700 dark:text-sky-400">
                              {fmtQty(bd.maintenance_qty)} {s.base_uom}
                            </div>
                            <div className="text-[11px] text-slate-500">{vnd(bd.maintenance_vnd)}</div>
                          </td>

                          <td className="py-2 pr-3 text-right text-xs whitespace-nowrap">
                            <div className="font-mono font-bold text-rose-700 dark:text-rose-400">
                              {fmtQty(bd.loss_qty)} {s.base_uom}
                            </div>
                            <div className="text-[11px] text-slate-500">{vnd(bd.loss_vnd)}</div>
                          </td>

                          <td className="py-2 pr-3 text-right text-xs whitespace-nowrap">
                            <div className="font-extrabold text-emerald-700 dark:text-emerald-400">{vnd(bd.total_vnd)}</div>
                            {s.current_lot_id ? (
                              <>
                                <div className="text-[11px] text-slate-600 dark:text-slate-300 mt-0.5">
                                  Còn lại: <b>{fmtQty(remBottle)} {s.base_uom}</b>
                                </div>
                                <div className="flex items-center justify-end gap-1 mt-0.5">
                                  <div className="h-1.5 w-16 rounded bg-slate-200 dark:bg-slate-800 overflow-hidden">
                                    <div
                                      className={`h-full ${pctRem <= 20 ? "bg-rose-500" : pctRem <= 40 ? "bg-amber-400" : "bg-emerald-500"}`}
                                      style={{ width: `${pctRem}%` }}
                                    />
                                  </div>
                                  <span className="text-[10px] text-slate-400">
                                    {runsUsed}/{designRuns} lượt
                                  </span>
                                </div>
                              </>
                            ) : (
                              <div className="text-[11px] text-amber-600 dark:text-amber-400 mt-0.5">Chưa gắn chai</div>
                            )}
                          </td>

                          <td className="py-2 pr-3 whitespace-nowrap">
                            <div className="flex flex-nowrap items-center gap-1">
                              <Button
                                type="button"
                                variant={drawer?.slotNo === s.slot_no && drawer.mode === "DETAIL" ? "primary" : "ghost"}
                                className={compactBtnCls}
                                onClick={() =>
                                  setDrawer(
                                    drawer?.slotNo === s.slot_no && drawer.mode === "DETAIL"
                                      ? null
                                      : { slotNo: s.slot_no, mode: "DETAIL" }
                                  )
                                }
                                title="Xem nhật ký lắp chai & tiêu hao riêng của kênh này"
                              >
                                ≡ Chi tiết
                              </Button>
                              {canOperate && (
                                <Button
                                  type="button"
                                  variant={drawer?.slotNo === s.slot_no && drawer.mode === "USAGE" ? "primary" : "secondary"}
                                  className={compactBtnCls}
                                  onClick={() =>
                                    setDrawer(
                                      drawer?.slotNo === s.slot_no && drawer.mode === "USAGE"
                                        ? null
                                        : { slotNo: s.slot_no, mode: "USAGE" }
                                    )
                                  }
                                  title="Cập nhật tiêu hao trực tiếp, hao hụt quy trình (Overhead), rửa/bảo trì máy hoặc hao hụt khác (Loss)"
                                >
                                  📝 Tiêu hao
                                </Button>
                              )}
                              {canOperate && (
                                <Button
                                  type="button"
                                  variant={drawer?.slotNo === s.slot_no && drawer.mode === "EMPTY" ? "danger" : "ghost"}
                                  className={compactBtnCls}
                                  disabled={!s.current_lot_id}
                                  onClick={() =>
                                    setDrawer(
                                      drawer?.slotNo === s.slot_no && drawer.mode === "EMPTY"
                                        ? null
                                        : { slotNo: s.slot_no, mode: "EMPTY" }
                                    )
                                  }
                                  title={
                                    s.current_lot_id
                                      ? "Báo chai đã hết thực tế — tự động đưa phần dư vào Chênh lệch thanh lý (LOSS) và tháo chai"
                                      : "Kênh chưa gắn chai"
                                  }
                                >
                                  ✓ Báo hết
                                </Button>
                              )}
                              {canConfigure && (
                                <Button
                                  type="button"
                                  variant={drawer?.slotNo === s.slot_no && drawer.mode === "DELETE" ? "danger" : "ghost"}
                                  className={`${compactBtnCls} text-rose-600! dark:text-rose-400!`}
                                  onClick={() =>
                                    setDrawer(
                                      drawer?.slotNo === s.slot_no && drawer.mode === "DELETE"
                                        ? null
                                        : { slotNo: s.slot_no, mode: "DELETE" }
                                    )
                                  }
                                  title="Xóa kênh dung môi này khỏi máy HPLC đang chọn"
                                >
                                  🗑️ Xóa
                                </Button>
                              )}
                            </div>
                          </td>
                        </tr>

                        {isDrawerOpen && (
                          <tr>
                            <td colSpan={8} className="pb-3 pt-1 pr-3">
                              {drawer.mode === "DETAIL" && (
                                <SlotDetailDrawer slot={s} events={d.events} onClose={() => setDrawer(null)} />
                              )}
                              {drawer.mode === "USAGE" && (
                                <SlotUsageDrawer
                                  assetId={assetId}
                                  slot={s}
                                  mountingLot={bottle.isPending}
                                  onMountLot={(lotId) => bottle.mutate({ slot: s.slot_no, lot: lotId })}
                                  onDone={refresh}
                                  onClose={() => setDrawer(null)}
                                />
                              )}
                              {drawer.mode === "EMPTY" && (
                                <SlotEmptyDrawer
                                  assetId={assetId}
                                  slot={s}
                                  onDone={refresh}
                                  onClose={() => setDrawer(null)}
                                />
                              )}
                              {drawer.mode === "DELETE" && (
                                <div className="p-3 rounded-xl border border-rose-200 dark:border-rose-900 bg-rose-50/70 dark:bg-rose-950/30 flex flex-wrap items-center justify-between gap-2 text-xs">
                                  <span>
                                    Xác nhận xóa kênh <b>#{s.slot_no} {s.label}</b> khỏi máy <b>{d.asset.code}</b>? (Chỉ xóa trên máy này, lịch sử trước đó vẫn được lưu kiểm toán.)
                                  </span>
                                  <div className="flex items-center gap-2">
                                    <Button type="button" variant="ghost" className={compactBtnCls} onClick={() => setDrawer(null)}>
                                      Hủy
                                    </Button>
                                    <Button
                                      type="button"
                                      variant="danger"
                                      className={compactBtnCls}
                                      disabled={removeSlot.isPending}
                                      onClick={() => removeSlot.mutate(s.slot_no)}
                                    >
                                      {removeSlot.isPending ? "Đang xóa..." : "✓ Xác nhận xóa kênh"}
                                    </Button>
                                  </div>
                                </div>
                              )}
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </Table>
              </>
            )}

            <p className="text-[11px] text-slate-500">
              💡 <b>Cơ chế tách biệt 2+ máy HPLC & Phân loại 4 nhóm tiêu hao:</b> Mỗi máy HPLC quản lý danh sách kênh, lô chai đang gắn và tồn kho riêng. Bấm <b>📝 Tiêu hao</b> để ghi nhận <i>Tiêu hao trực tiếp</i>, <i>Hao hụt quy trình (Overhead/Purge)</i>, <i>Hao hụt rửa/bảo trì máy</i> hoặc <i>Hao hụt bay hơi (Loss)</i>; khi chai thực tế dùng hết, bấm <b>✓ Báo hết</b> để chốt phần dư vào <i>Chênh lệch thanh lý (Loss)</i> và tháo chai.
            </p>
          </div>
        )}

        {d && editing && (
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate();
            }}
          >
            <div className="text-xs text-slate-600 dark:text-slate-300 pb-2 border-b border-slate-200 dark:border-slate-800">
              Khai báo các <b>Kênh hóa chất riêng cho máy {d.asset.code}</b>, chọn <b>Mã hóa chất / Reagent liên kết trong Kho</b> và thiết lập <b>Dung tích chai, Định mức mL/lượt chạy, Đơn giá chai & Số lượt thiết kế</b>.
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
              <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
                Hủy
              </Button>
              <Button type="submit" disabled={save.isPending}>
                Lưu cấu hình kênh & định mức khấu hao
              </Button>
            </div>
            <ErrorNote error={save.error} />
          </form>
        )}
      </div>
    </Card>
  );
}

const ASSET_STATUS_LABELS: Record<string, string> = {
  IN_SERVICE: "Đang dùng",
  UNDER_MAINTENANCE: "Bảo trì",
  OUT_OF_CALIBRATION: "Hết hiệu chuẩn",
  RETIRED: "Ngừng",
};

function EditInstrumentPanel({ asset, onDone }: { asset: Asset; onDone: () => void }) {
  const qc = useQueryClient();
  const [code, setCode] = useState(asset.code);
  const [name, setName] = useState(asset.name);
  const [assetType, setAssetType] = useState(asset.asset_type || "OTHER");
  const [location, setLocation] = useState(asset.location ?? "");
  const [model, setModel] = useState(asset.model ?? "");
  const [serialNo, setSerialNo] = useState(asset.serial_no ?? "");
  const [status, setStatus] = useState(asset.status || "IN_SERVICE");
  const [due, setDue] = useState(asset.next_calibration_due ? asset.next_calibration_due.slice(0, 10) : "");
  const [reason, setReason] = useState("Cập nhật thông số / hạn hiệu chuẩn thiết bị");

  const save = useMutation({
    mutationFn: () =>
      api(`/api/factory/assets/${asset.id}`, {
        method: "PATCH",
        json: {
          code: code.trim(),
          name: name.trim(),
          asset_type: assetType,
          location: location.trim() || null,
          model: model.trim() || null,
          serial_no: serialNo.trim() || null,
          status,
          next_calibration_due: due || null,
          reason: reason.trim() || "Cập nhật cấu hình thiết bị",
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["factory", "assets"] });
      qc.invalidateQueries({ queryKey: ["factory", "asset-slots", asset.id] });
      onDone();
    },
  });

  const remove = useMutation({
    mutationFn: (delReason: string) =>
      api(`/api/factory/assets/${asset.id}`, {
        method: "DELETE",
        json: { reason: delReason },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["factory", "assets"] });
      qc.invalidateQueries({ queryKey: ["factory", "asset-slots", asset.id] });
      onDone();
    },
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
      className="p-3 mb-3 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700"
    >
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs font-bold text-slate-700 dark:text-slate-200">
          ✏️ Sửa / Cài đặt thiết bị: <span className="font-mono">{asset.code}</span>
        </div>
        <button type="button" onClick={onDone} className="text-xs text-slate-500 hover:underline">
          Đóng
        </button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-2">
        <Field label="Mã thiết bị *">
          <input className={`${inputClass} font-mono`} value={code} onChange={(e) => setCode(e.target.value)} required />
        </Field>
        <Field label="Tên thiết bị *">
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} required />
        </Field>
        <Field label="Loại thiết bị">
          <select className={inputClass} value={assetType} onChange={(e) => setAssetType(e.target.value)}>
            {Object.entries(TYPES).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Vị trí phòng">
          <input className={inputClass} value={location} onChange={(e) => setLocation(e.target.value)} placeholder="VD: Phòng hậu tổng hợp" />
        </Field>
        <Field label="Model">
          <input className={inputClass} value={model} onChange={(e) => setModel(e.target.value)} />
        </Field>
        <Field label="Số Serial">
          <input className={inputClass} value={serialNo} onChange={(e) => setSerialNo(e.target.value)} />
        </Field>
        <Field label="Trạng thái">
          <select className={inputClass} value={status} onChange={(e) => setStatus(e.target.value)}>
            {Object.entries(ASSET_STATUS_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Hạn hiệu chuẩn tiếp theo">
          <input className={inputClass} type="date" value={due} onChange={(e) => setDue(e.target.value)} />
        </Field>
        <div className="md:col-span-3 lg:col-span-4">
          <Field label="Lý do chỉnh sửa">
            <input className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} required />
          </Field>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button type="submit" disabled={save.isPending || remove.isPending}>
            {save.isPending ? "Đang lưu..." : "Lưu thông số"}
          </Button>
          <Button type="button" variant="ghost" onClick={onDone}>
            Hủy
          </Button>
        </div>
        <Button
          type="button"
          variant="danger"
          disabled={remove.isPending || save.isPending}
          onClick={() => {
            const delReason = window.prompt(
              `Nhập lý do xóa thiết bị ${asset.code} (${asset.name}):`,
              "Khai báo nhầm / loại bỏ thiết bị chưa phát sinh hồ sơ"
            );
            if (delReason && delReason.trim().length >= 3) remove.mutate(delReason.trim());
          }}
        >
          🗑️ Xóa thiết bị
        </Button>
      </div>
      <ErrorNote error={save.error ?? remove.error} />
    </form>
  );
}

/** Lab instruments other than synthesizers (HPLC, spectrophotometer...) with their reagent / solvent positions. */
export function InstrumentsView({
  canManage,
  canOperate,
  mode = "all",
  onNavigateToRules,
}: {
  canManage: boolean;
  canOperate: boolean;
  mode?: "assets" | "reagents" | "all";
  onNavigateToRules?: () => void;
}) {
  const qc = useQueryClient();
  const assets = useQuery({
    queryKey: ["factory", "assets", "P-OLIGO"],
    queryFn: () => api<Asset[]>("/api/factory/assets?dept=P-OLIGO"),
  });
  const [open, setOpen] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [editAssetId, setEditAssetId] = useState<string | null>(null);
  const removeAsset = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api(`/api/factory/assets/${id}`, { method: "DELETE", json: { reason } }),
    onSuccess: (_res, vars) => {
      if (editAssetId === vars.id) setEditAssetId(null);
      if (open === vars.id) setOpen(null);
      qc.invalidateQueries({ queryKey: ["factory", "assets"] });
      qc.invalidateQueries({ queryKey: ["factory", "asset-slots", vars.id] });
    },
  });
  const list = useMemo(() => {
    const nonSynth = (assets.data ?? []).filter(
      (a) => a.asset_type !== "SYNTHESIZER" && (!a.owner_code || a.owner_code === "P-OLIGO")
    );
    return [...nonSynth].sort((a, b) => {
      const aHplc = a.asset_type === "HPLC" ? 0 : 1;
      const bHplc = b.asset_type === "HPLC" ? 0 : 1;
      if (aHplc !== bHplc) return aHplc - bHplc;
      return a.code.localeCompare(b.code);
    });
  }, [assets.data]);

  const shouldAutoOpenSlots = mode !== "assets";

  useEffect(() => {
    if (!shouldAutoOpenSlots) return;
    if (list.length === 0) {
      if (open !== null && !assets.isFetching) setOpen(null);
      return;
    }
    if (!dismissed && !open) {
      const hplc = list.find((a) => a.asset_type === "HPLC") ?? list[0];
      if (hplc) setOpen(hplc.id);
    } else if (open && !assets.isFetching && !list.some((a) => a.id === open)) {
      const hplc = list.find((a) => a.asset_type === "HPLC") ?? list[0];
      setOpen(hplc?.id ?? null);
    }
  }, [shouldAutoOpenSlots, list, open, dismissed, assets.isFetching]);

  const editAsset = editAssetId ? list.find((a) => a.id === editAssetId) ?? null : null;

  if (mode === "reagents") {
    return (
      <div className="flex flex-col gap-3">
        <ErrorNote error={assets.error} />
        {open ? (
          <SlotsPanel
            key={open}
            assetId={open}
            hplcAssets={list}
            onSelectAsset={(id) => {
              setDismissed(false);
              setOpen(id);
            }}
            canConfigure={canManage}
            canOperate={canOperate}
          />
        ) : (
          assets.data && (
            <Card title="Quản lý Sử dụng, Định mức & Khấu hao Hóa chất HPLC">
              <Empty>Chưa khai báo thiết bị HPLC hoặc thiết bị hậu tổng hợp. Vui lòng thêm máy ở tab Thiết bị.</Empty>
            </Card>
          )
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <Card
        title="Hệ thống HPLC & Thiết bị Kiểm nghiệm / Hậu tổng hợp"
        actions={
          canManage ? (
            <Button type="button" onClick={() => setShowAdd((v) => !v)}>
              {showAdd ? "Đóng form" : "+ Thêm thiết bị"}
            </Button>
          ) : null
        }
      >
      {canManage && showAdd && (
          <NewInstrument
            onCreated={(newId) => {
              setShowAdd(false);
              if (mode === "all") {
                setDismissed(false);
                setOpen(newId);
              }
            }}
          />
        )}
        <ErrorNote error={assets.error ?? removeAsset.error} />
        {assets.data && list.length === 0 && <Empty>Chưa khai báo thiết bị.</Empty>}
        {list.length > 0 && (
          <Table head={["Mã thiết bị", "Tên thiết bị", "Loại", "Trạng thái", "Phòng", "Model / Serial", "Hạn hiệu chuẩn", "Thao tác"]}>
            {list.map((a) => {
              const isRowEditing = canManage && editAssetId === a.id;
              const isSlotsOpen = open === a.id;
              return (
                <React.Fragment key={a.id}>
                  <tr className={isSlotsOpen || isRowEditing ? "bg-sky-50/70 dark:bg-sky-950/30" : ""}>
                    <td className="py-1.5 pr-3 font-mono font-bold text-xs">{a.code}</td>
                    <td className="py-1.5 pr-3 font-medium">{a.name}</td>
                    <td className="py-1.5 pr-3 text-xs">
                      <span className={`px-1.5 py-0.5 rounded font-bold text-[11px] ${a.asset_type === "HPLC" ? "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300" : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"}`}>
                        {TYPES[a.asset_type] ?? a.asset_type}
                      </span>
                    </td>
                    <td className="py-1.5 pr-3 text-xs">{ASSET_STATUS_LABELS[a.status] ?? a.status}</td>
                    <td className="py-1.5 pr-3 text-xs">{a.owner_name}</td>
                    <td className="py-1.5 pr-3 text-xs">{[a.model, a.serial_no].filter(Boolean).join(" / ") || "—"}</td>
                    <td className="py-1.5 pr-3 text-xs">{fmtDate(a.next_calibration_due)}</td>
                    <td className="py-1.5 pr-3 text-right">
                      <div className="flex flex-wrap justify-end gap-1.5">
                        {canManage && (
                          <>
                            <Button
                              type="button"
                              variant={isRowEditing ? "primary" : "ghost"}
                              onClick={() => setEditAssetId(isRowEditing ? null : a.id)}
                            >
                              {isRowEditing ? "Đóng sửa" : "✏️ Sửa / Cài đặt"}
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              className="text-rose-600 dark:text-rose-400"
                              disabled={removeAsset.isPending}
                              onClick={() => {
                                const reason = window.prompt(
                                  `Nhập lý do xóa thiết bị ${a.code} (${a.name}):`,
                                  "Khai báo nhầm / loại bỏ thiết bị chưa phát sinh hồ sơ"
                                );
                                if (reason && reason.trim().length >= 3) {
                                  removeAsset.mutate({ id: a.id, reason: reason.trim() });
                                }
                              }}
                            >
                              🗑️ Xóa
                            </Button>
                          </>
                        )}
                        {onNavigateToRules ? (
                          <Button type="button" variant="ghost" onClick={onNavigateToRules}>
                            🧪 Định mức & Chai hóa chất ↗
                          </Button>
                        ) : (
                          <Button
                            type="button"
                            variant={isSlotsOpen ? "primary" : "ghost"}
                            onClick={() => {
                              if (isSlotsOpen) {
                                setDismissed(true);
                                setOpen(null);
                              } else {
                                setDismissed(false);
                                setOpen(a.id);
                              }
                            }}
                          >
                            {isSlotsOpen ? "Đóng hóa chất" : `🧪 ${a.asset_type === "HPLC" ? "Hóa chất & Khấu hao HPLC" : "Vị trí hóa chất"}`}
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                  {isRowEditing && (
                    <tr className="bg-amber-50/30 dark:bg-amber-950/20">
                      <td colSpan={8} className="p-2.5 border-b-2 border-amber-300 dark:border-amber-700">
                        <EditInstrumentPanel key={a.id} asset={a} onDone={() => setEditAssetId(null)} />
                      </td>
                    </tr>
                  )}
                  {isSlotsOpen && (
                    <tr className="bg-sky-50/30 dark:bg-sky-950/20">
                      <td colSpan={8} className="p-2.5 border-b-2 border-sky-300 dark:border-sky-700">
                        <SlotsPanel
                          key={a.id}
                          assetId={a.id}
                          hplcAssets={list}
                          onSelectAsset={(id) => {
                            setDismissed(false);
                            setOpen(id);
                          }}
                          canConfigure={canManage}
                          canOperate={canOperate}
                          onClose={() => {
                            setDismissed(true);
                            setOpen(null);
                          }}
                        />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </Table>
        )}
      </Card>
    </div>
  );
}

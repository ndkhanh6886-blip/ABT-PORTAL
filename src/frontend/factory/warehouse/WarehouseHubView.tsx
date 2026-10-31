"use client";

import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, AlertTriangle, Boxes, CheckCircle2, Lock, PackagePlus, RefreshCw, ShoppingCart, Truck } from "lucide-react";
import { api, fmtDate, fmtQty } from "../api";
import { Button, Card, Empty, ErrorNote, Field, inputClass, StatusBadge, Table } from "../ui";

interface HubOverview {
  warehouses: {
    id: string;
    code: string;
    name: string;
    purpose: string;
    owner_code: string | null;
    owner_name: string | null;
    owner_module_key: string | null;
    bt_location_id: string | null;
    bt_location_code: string | null;
    a1_location_id: string | null;
    a1_location_code: string | null;
    released_lot_count: number;
    quarantine_lot_count: number;
    ready_putaway_count: number;
    active_item_count: number;
  }[];
  all_locations: {
    id: string;
    code: string;
    name: string;
    is_quarantine: boolean;
    warehouse_id: string;
    warehouse_code: string;
    warehouse_name: string;
  }[];
  central_hub_stock: {
    balance_id: string;
    item_id: string;
    item_code: string;
    item_name: string;
    item_type: string;
    base_uom: string;
    lot_id: string | null;
    lot_code: string | null;
    lot_status: string | null;
    expiry_date: string | null;
    location_id: string;
    location_code: string;
    warehouse_id: string;
    warehouse_code: string;
    qty_on_hand: number;
    qty_reserved: number;
    qty_available: number;
  }[];
  putaway_queue: {
    balance_id: string;
    item_id: string;
    item_code: string;
    item_name: string;
    base_uom: string;
    lot_id: string;
    lot_code: string;
    lot_status: string;
    expiry_date: string | null;
    from_location_id: string;
    from_location_code: string;
    warehouse_id: string;
    warehouse_code: string;
    warehouse_name: string;
    qty_free: number;
    to_location_id: string | null;
    to_location_code: string | null;
  }[];
  expiry_radar: {
    balance_id: string;
    lot_id: string;
    lot_code: string;
    lot_status: string;
    expiry_date: string;
    days_left: number;
    item_id: string;
    item_code: string;
    item_name: string;
    base_uom: string;
    warehouse_id: string;
    warehouse_code: string;
    location_code: string;
    is_quarantine: boolean;
    qty_on_hand: number;
    qty_available: number;
  }[];
  low_stock_radar: {
    item_id: string;
    item_code: string;
    item_name: string;
    item_type: string;
    base_uom: string;
    min_safety_stock: number;
    reorder_qty: number;
    lead_time_days: number;
    hub_available: number;
    branch_available: number;
    quarantine_qty: number;
    open_pr_qty: number;
    open_po_qty: number;
  }[];
  recent_transfers: {
    id: string;
    code: string;
    reason_code: string;
    status: string;
    posted_at: string | null;
    created_at: string;
    notes: string | null;
    source_warehouse_code: string;
    created_by_name: string | null;
    line_summaries: string[];
  }[];
}

const WH_META: Record<string, { badge: string; temp: string; desc: string }> = {
  "KHO-TONG": {
    badge: "🏛️ Kho Trung Tâm (Central Hub)",
    temp: "RT · 2–8°C · -20°C · -80°C",
    desc: "Cửa ngõ tiếp nhận PO từ Nhà cung cấp, lưu trữ nguyên liệu số lượng lớn & thành phẩm chờ giao.",
  },
  "KHO-KIT": {
    badge: "🧪 Kho Nhánh Sản Xuất Kit",
    temp: "2–8°C · -20°C · Phòng sạch",
    desc: "Lưu trữ Bán thành phẩm (MasterMix, IC, Buffer), Mồi/Probe và Bao bì phục vụ Lệnh sản xuất Kit.",
  },
  "KHO-OLIGO": {
    badge: "🧬 Kho Nhánh Tổng Hợp Oligo",
    temp: "Khí trơ Argon · -20°C",
    desc: "Quản lý hóa chất Amidite, ACN, Activator, Cột CPG nạp lên cổng máy tổng hợp DNA/RNA.",
  },
  "KHO-DEVICE": {
    badge: "⚙️ Kho Nhánh Kỹ Thuật – Thiết Bị",
    temp: "Phòng khô ESD (< 50% RH)",
    desc: "Lưu trữ Bo mạch PCB, Khung vỏ CNC, Cảm biến, Nguồn phục vụ lắp ráp 4 trạm & Máy Serial.",
  },
  "KHO-RD": {
    badge: "🔬 Kho Nhánh Nghiên Cứu R&D",
    temp: "-20°C · 2–8°C · RT",
    desc: "Tách biệt hóa chất & vật tư nghiên cứu theo từng Mã Dự Án R&D và Bài thí nghiệm ELN.",
  },
  "KHO-QA": {
    badge: "🛡️ Kho Nhánh QA/QC & Mẫu Lưu",
    temp: "-80°C · -20°C · 2–8°C",
    desc: "Lưu trữ độc lập Bộ Mẫu Chuẩn Đối Chiếu (Reference Standards) và Mẫu Lưu Theo Lô (Retention).",
  },
};

export function WarehouseHubView({ onOpenStock }: { onOpenStock?: (warehouseId: string) => void }) {
  const qc = useQueryClient();
  const [radarTab, setRadarTab] = useState<"dispatch" | "putaway" | "low_stock" | "expiry">("dispatch");
  const [toast, setToast] = useState<string | null>(null);

  const hub = useQuery({
    queryKey: ["factory", "warehouse-hub-ops"],
    queryFn: () => api<HubOverview>("/api/factory/inv/ops"),
  });

  const data = hub.data;
  const warehouses = data?.warehouses ?? [];
  const khoTong = warehouses.find((w) => w.code === "KHO-TONG") ?? warehouses[0];
  const branchWarehouses = warehouses.filter((w) => w.code !== "KHO-TONG");

  const [srcWhId, setSrcWhId] = useState("");
  const [dstWhId, setDstWhId] = useState("");
  const [selectedBalanceId, setSelectedBalanceId] = useState("");
  const [dispatchQty, setDispatchQty] = useState("");
  const [dispatchNote, setDispatchNote] = useState("");

  const effectiveSrcWhId = srcWhId || khoTong?.id || "";
  const effectiveDstWhId = dstWhId || branchWarehouses[0]?.id || "";
  const availableStockInSrc = (data?.central_hub_stock ?? []).filter((s) => s.warehouse_id === effectiveSrcWhId);
  const selectedStock = availableStockInSrc.find((s) => s.balance_id === selectedBalanceId) ?? availableStockInSrc[0];

  const refreshAll = () => {
    qc.invalidateQueries({ queryKey: ["factory", "warehouse-hub-ops"] });
    qc.invalidateQueries({ queryKey: ["factory", "stock"] });
    qc.invalidateQueries({ queryKey: ["factory", "documents"] });
    qc.invalidateQueries({ queryKey: ["factory", "prs"] });
  };

  const dispatchMut = useMutation({
    mutationFn: () => {
      if (!selectedStock) throw new Error("Chọn vật tư/lô cần cấp phát.");
      const qtyNum = Number(dispatchQty.replace(",", ".")) || selectedStock.qty_available;
      return api<{ document: { code: string }; from_warehouse: string; to_warehouse: string }>("/api/factory/inv/ops", {
        method: "POST",
        idempotent: true,
        json: {
          op: "dispatch_inter_warehouse",
          source_warehouse_id: effectiveSrcWhId,
          target_warehouse_id: effectiveDstWhId,
          item_id: selectedStock.item_id,
          lot_id: selectedStock.lot_id,
          qty: qtyNum,
          notes: dispatchNote || undefined,
        },
      });
    },
    onSuccess: (res) => {
      setToast(`✅ Đã lập & ghi sổ phiếu điều chuyển ${res.document.code}: Cấp phát từ ${res.from_warehouse} ➔ ${res.to_warehouse}`);
      setDispatchQty("");
      setDispatchNote("");
      refreshAll();
    },
  });

  const putAwayMut = useMutation({
    mutationFn: (payload: { lot_id?: string; warehouse_id?: string; put_away_all?: boolean }) =>
      api<{ moved_count: number }>("/api/factory/inv/ops", {
        method: "POST",
        idempotent: true,
        json: { op: "put_away_one_click", ...payload },
      }),
    onSuccess: (res) => {
      setToast(`📦 Đã cất ${res.moved_count} lô đã duyệt QC từ khu Biệt trữ (BT) lên Kệ chính (A1)!`);
      refreshAll();
    },
  });

  const createPrMut = useMutation({
    mutationFn: (payload: { item_id: string; qty: number; item_code: string }) =>
      api<{ code: string }>("/api/factory/inv/ops", {
        method: "POST",
        idempotent: true,
        json: {
          op: "create_replenish_pr",
          item_id: payload.item_id,
          qty: payload.qty,
          warehouse_code: "KHO-TONG",
          auto_approve: true,
        },
      }),
    onSuccess: (res, vars) => {
      setToast(`🛒 Đã tạo & duyệt Đề nghị mua hàng ${res.code} (${vars.item_code} — SL: ${vars.qty}) chuyển sang Cung Ứng NVL!`);
      refreshAll();
    },
  });

  const holdLotMut = useMutation({
    mutationFn: (payload: { lot_id: string; reason: string }) =>
      api("/api/factory/inv/ops", {
        method: "POST",
        idempotent: true,
        json: { op: "hold_lot", ...payload },
      }),
    onSuccess: () => {
      setToast("🔒 Đã chuyển trạng thái lô sang Tạm giữ (ON_HOLD), khóa xuất FEFO.");
      refreshAll();
    },
  });

  if (hub.isLoading) return <div className="p-6 text-xs text-slate-400">Đang tải sơ đồ điều phối hệ thống kho…</div>;

  return (
    <div className="flex flex-col gap-3">
      {toast && (
        <div className="flex items-center justify-between gap-2 rounded-xl border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/50 px-4 py-2.5 text-xs font-semibold text-emerald-800 dark:text-emerald-200">
          <span>{toast}</span>
          <button type="button" className="text-emerald-600 hover:underline cursor-pointer" onClick={() => setToast(null)}>
            Đóng
          </button>
        </div>
      )}

      <ErrorNote error={hub.error ?? dispatchMut.error ?? putAwayMut.error ?? createPrMut.error ?? holdLotMut.error} />

      {/* SƠ ĐỒ KIẾN TRÚC HUB & SPOKE: KHO TRUNG TÂM -> 5 KHO BỘ PHẬN */}
      <Card
        title="Sơ đồ Điều phối Hệ thống Kho 2 Cấp (1 Kho Trung Tâm KHO-TONG ➔ 5 Kho Nhánh Bộ Phận)"
        actions={
          <Button variant="ghost" onClick={refreshAll}>
            <RefreshCw className="w-3.5 h-3.5 mr-1 inline" /> Làm mới
          </Button>
        }
      >
        <div className="grid gap-3 lg:grid-cols-12 items-stretch">
          {/* CỘT TRÁI: KHO TRUNG TÂM KHO-TONG */}
          {khoTong && (
            <div className="lg:col-span-4 rounded-2xl border-2 border-sky-600/80 dark:border-sky-500/70 bg-gradient-to-br from-sky-50/90 via-white to-slate-50 dark:from-sky-950/40 dark:via-slate-900 dark:to-slate-900 p-4 flex flex-col justify-between shadow-sm">
              <div>
                <div className="flex items-center justify-between gap-2">
                  <span className="px-2.5 py-0.5 rounded-full text-[11px] font-extrabold bg-sky-700 text-white">
                    {WH_META[khoTong.code]?.badge ?? "Kho Trung Tâm"}
                  </span>
                  <span className="font-mono text-xs font-bold text-sky-700 dark:text-sky-400">{khoTong.code}</span>
                </div>
                <h3 className="text-sm font-extrabold text-slate-900 dark:text-white mt-2">{khoTong.name}</h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                  {WH_META[khoTong.code]?.desc}
                </p>
                <div className="mt-2 text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                  🌡️ Chế độ nhiệt: <span className="font-mono">{WH_META[khoTong.code]?.temp}</span>
                </div>

                <div className="grid grid-cols-3 gap-2 mt-3">
                  <div className="rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 p-2 text-center">
                    <div className="text-[10px] text-emerald-700 dark:text-emerald-300 font-semibold">Kệ Chính ({khoTong.a1_location_code ?? "A1"})</div>
                    <div className="text-base font-extrabold text-emerald-700 dark:text-emerald-300">{khoTong.released_lot_count} lô</div>
                    <div className="text-[10px] text-emerald-600">Sẵn sàng cấp FEFO</div>
                  </div>
                  <div className="rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 p-2 text-center">
                    <div className="text-[10px] text-amber-700 dark:text-amber-300 font-semibold">Biệt Trữ ({khoTong.bt_location_code ?? "BT"})</div>
                    <div className="text-base font-extrabold text-amber-700 dark:text-amber-300">{khoTong.quarantine_lot_count} lô</div>
                    <div className="text-[10px] text-amber-600">Chờ QC / Khóa xuất</div>
                  </div>
                  <div className="rounded-xl bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-900 p-2 text-center">
                    <div className="text-[10px] text-indigo-700 dark:text-indigo-300 font-semibold">Chờ Cất Kệ</div>
                    <div className="text-base font-extrabold text-indigo-700 dark:text-indigo-300">{khoTong.ready_putaway_count} lô</div>
                    <div className="text-[10px] text-indigo-600">BT ➔ A1</div>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 mt-4 pt-3 border-t border-slate-200 dark:border-slate-800">
                <span className="text-[11px] text-slate-500">
                  Đang lưu trữ <b>{khoTong.active_item_count}</b> mã vật tư/thành phẩm
                </span>
                <div className="flex gap-1.5">
                  {khoTong.ready_putaway_count > 0 && (
                    <Button
                      onClick={() => putAwayMut.mutate({ warehouse_id: khoTong.id, put_away_all: true })}
                      disabled={putAwayMut.isPending}
                    >
                      📦 Put-Away ({khoTong.ready_putaway_count})
                    </Button>
                  )}
                  {onOpenStock && (
                    <Button variant="ghost" onClick={() => onOpenStock(khoTong.id)}>
                      Xem tồn KHO-TONG
                    </Button>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* CỘT PHẢI: 5 KHO NHÁNH CHUYÊN BIỆT CỦA CÁC PHÒNG BAN */}
          <div className="lg:col-span-8 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {branchWarehouses.map((w) => {
              const meta = WH_META[w.code] ?? {
                badge: "Kho Nhánh Bộ Phận",
                temp: "RT · 2–8°C",
                desc: "Kho lưu trữ vật tư & bán thành phẩm phục vụ trực tiếp cho bộ phận.",
              };
              return (
                <div
                  key={w.id}
                  className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-3 flex flex-col justify-between hover:border-sky-400 transition-colors"
                >
                  {/* the card body opens this warehouse's stock (lots by location) */}
                  <div
                    role={onOpenStock ? "button" : undefined}
                    tabIndex={onOpenStock ? 0 : undefined}
                    title={onOpenStock ? `Xem tồn kho ${w.code}` : undefined}
                    className={onOpenStock ? "cursor-pointer" : undefined}
                    onClick={() => onOpenStock?.(w.id)}
                    onKeyDown={(e) => { if (onOpenStock && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onOpenStock(w.id); } }}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="font-mono text-xs font-extrabold text-sky-700 dark:text-sky-400">{w.code}</span>
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                        {w.owner_name ?? w.purpose}
                      </span>
                    </div>
                    <div className="text-xs font-bold text-slate-800 dark:text-slate-100 mt-1">{meta.badge}</div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 line-clamp-2">{meta.desc}</p>
                    <div className="text-[10px] text-slate-500 mt-1">🌡️ {meta.temp}</div>

                    <div className="grid grid-cols-2 gap-1.5 mt-2.5 text-xs">
                      <div className="rounded-lg bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200/70 dark:border-emerald-900 px-2 py-1">
                        <span className="text-[10px] text-slate-500 block">Kệ {w.a1_location_code ?? "A1"} (Khả dụng)</span>
                        <b className="text-emerald-700 dark:text-emerald-400">{w.released_lot_count} lô</b>
                      </div>
                      <div className="rounded-lg bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200/70 dark:border-amber-900 px-2 py-1">
                        <span className="text-[10px] text-slate-500 block">Biệt trữ {w.bt_location_code ?? "BT"}</span>
                        <b className="text-amber-700 dark:text-amber-400">{w.quarantine_lot_count} lô</b>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-1.5 mt-3 pt-2 border-t border-slate-100 dark:border-slate-800">
                    <button
                      type="button"
                      onClick={() => {
                        setDstWhId(w.id);
                        setRadarTab("dispatch");
                      }}
                      className="text-[11px] font-bold text-sky-700 dark:text-sky-400 hover:underline cursor-pointer flex items-center gap-1"
                    >
                      <Truck className="w-3 h-3" /> Cấp phát vào {w.code}
                    </button>
                    <div className="flex items-center gap-1">
                      {w.ready_putaway_count > 0 && (
                        <button
                          type="button"
                          onClick={() => putAwayMut.mutate({ warehouse_id: w.id, put_away_all: true })}
                          className="px-2 py-0.5 rounded-lg bg-indigo-600 text-white text-[10px] font-bold cursor-pointer"
                          title="Cất các lô đã duyệt QC từ BT lên kệ A1"
                        >
                          Put-Away ({w.ready_putaway_count})
                        </button>
                      )}
                      {onOpenStock && (
                        <button
                          type="button"
                          onClick={() => onOpenStock(w.id)}
                          className="text-[11px] text-slate-500 hover:text-slate-800 dark:hover:text-white cursor-pointer"
                        >
                          Chi tiết →
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </Card>

      {/* THANH CHỌN NGHIỆP VỤ ĐIỀU PHỐI KHO */}
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => setRadarTab("dispatch")}
          className={`px-3.5 py-2 rounded-xl text-xs font-bold border cursor-pointer transition-colors flex items-center gap-1.5 ${
            radarTab === "dispatch"
              ? "bg-sky-700 text-white border-sky-700"
              : "bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-800"
          }`}
        >
          <Truck className="w-3.5 h-3.5" />
          1. Cấp phát Liên Kho FEFO (KHO-TONG ➔ Kho Bộ Phận)
        </button>
        <button
          type="button"
          onClick={() => setRadarTab("putaway")}
          className={`px-3.5 py-2 rounded-xl text-xs font-bold border cursor-pointer transition-colors flex items-center gap-1.5 ${
            radarTab === "putaway"
              ? "bg-sky-700 text-white border-sky-700"
              : "bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-800"
          }`}
        >
          <PackagePlus className="w-3.5 h-3.5" />
          2. Hàng đợi Cất lên kệ Put-Away (BT ➔ A1) ({data?.putaway_queue.length ?? 0})
        </button>
        <button
          type="button"
          onClick={() => setRadarTab("low_stock")}
          className={`px-3.5 py-2 rounded-xl text-xs font-bold border cursor-pointer transition-colors flex items-center gap-1.5 ${
            radarTab === "low_stock"
              ? "bg-sky-700 text-white border-sky-700"
              : "bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-800"
          }`}
        >
          <ShoppingCart className="w-3.5 h-3.5" />
          3. Radar Tồn Kho Thấp & Báo Mua Bổ Sung (MRP)
        </button>
        <button
          type="button"
          onClick={() => setRadarTab("expiry")}
          className={`px-3.5 py-2 rounded-xl text-xs font-bold border cursor-pointer transition-colors flex items-center gap-1.5 ${
            radarTab === "expiry"
              ? "bg-sky-700 text-white border-sky-700"
              : "bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-800"
          }`}
        >
          <AlertTriangle className="w-3.5 h-3.5" />
          4. Radar Cảnh Báo Hạn Dùng (FEFO / Near-Expiry) ({data?.expiry_radar.length ?? 0})
        </button>
      </div>

      {/* TAB 1: CẤP PHÁT LIÊN KHO FEFO */}
      {radarTab === "dispatch" && (
        <Card title="🚚 Cấp phát / Điều chuyển Vật tư Liên Kho (Từ Kho Trung Tâm KHO-TONG về 5 Kho Bộ Phận theo chuẩn FEFO)">
          <form
            className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5 items-end p-3.5 rounded-2xl border border-sky-200 dark:border-sky-900/70 bg-sky-50/50 dark:bg-sky-950/20 mb-4"
            onSubmit={(e) => {
              e.preventDefault();
              dispatchMut.mutate();
            }}
          >
            <Field label="1. Kho Nguồn Xuất Cấp">
              <select
                className={inputClass}
                value={effectiveSrcWhId}
                onChange={(e) => {
                  setSrcWhId(e.target.value);
                  setSelectedBalanceId("");
                }}
              >
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.code} — {w.name} ({w.released_lot_count} lô khả dụng)
                  </option>
                ))}
              </select>
            </Field>

            <Field label="2. Kho Bộ Phận Nhận Hàng *">
              <select
                className={inputClass}
                value={effectiveDstWhId}
                onChange={(e) => setDstWhId(e.target.value)}
                required
              >
                {warehouses
                  .filter((w) => w.id !== effectiveSrcWhId)
                  .map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.code} — {w.name} (Kệ {w.a1_location_code ?? "A1"})
                    </option>
                  ))}
              </select>
            </Field>

            <Field label="3. Chọn Vật tư / Lô Khả dụng (Ưu tiên FEFO) *">
              <select
                className={inputClass}
                value={selectedStock?.balance_id ?? ""}
                onChange={(e) => setSelectedBalanceId(e.target.value)}
                required
              >
                {availableStockInSrc.length === 0 && <option value="">Không có lô khả dụng tại kho nguồn</option>}
                {availableStockInSrc.map((s) => (
                  <option key={s.balance_id} value={s.balance_id}>
                    {s.item_code} · Lô {s.lot_code ?? "N/A"} (HSD: {fmtDate(s.expiry_date)}) — Tồn: {fmtQty(s.qty_available)} {s.base_uom}
                  </option>
                ))}
              </select>
            </Field>

            <Field
              label={`4. Số lượng cấp (${selectedStock?.base_uom ?? "ĐVT"}) *`}
              hint={selectedStock ? `Tối đa khả dụng: ${fmtQty(selectedStock.qty_available)} ${selectedStock.base_uom}` : ""}
            >
              <input
                className={inputClass}
                inputMode="decimal"
                placeholder={selectedStock ? `VD: ${Math.min(10, selectedStock.qty_available)}` : "Nhập SL"}
                value={dispatchQty}
                onChange={(e) => setDispatchQty(e.target.value)}
                required
              />
            </Field>

            <div className="flex flex-col gap-1.5">
              <input
                className={inputClass}
                placeholder="Ghi chú cấp phát (tùy chọn)…"
                value={dispatchNote}
                onChange={(e) => setDispatchNote(e.target.value)}
              />
              <Button type="submit" disabled={dispatchMut.isPending || !selectedStock}>
                {dispatchMut.isPending ? "Đang ghi sổ…" : "🚚 Cấp phát Liên kho ngay"}
              </Button>
            </div>
          </form>

          <div className="text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">
            Nhật ký Phiếu Điều chuyển & Cấp phát Kho gần đây (`TRANSFER`)
          </div>
          {data?.recent_transfers.length === 0 ? (
            <Empty>Chưa có phiếu điều chuyển kho nào.</Empty>
          ) : (
            <Table head={["Mã phiếu", "Lý do", "Kho xuất", "Chi tiết Vật tư & Luồng dịch chuyển (Từ ➔ Đến)", "Người thực hiện", "Thời gian", "Trạng thái"]}>
              {data?.recent_transfers.map((t) => (
                <tr key={t.id}>
                  <td className="py-2 pr-3 font-mono font-semibold text-sky-700 dark:text-sky-400">{t.code}</td>
                  <td className="py-2 pr-3">
                    <span className="px-2 py-0.5 rounded-md text-[11px] font-semibold bg-slate-100 dark:bg-slate-800">
                      {t.reason_code === "DEPT_SUPPLY"
                        ? "🚚 Cấp phát Kho Bộ Phận"
                        : t.reason_code === "PUTAWAY"
                        ? "📦 Cất lên kệ chính (Put-Away)"
                        : t.reason_code}
                    </span>
                  </td>
                  <td className="py-2 pr-3 font-mono font-bold">{t.source_warehouse_code}</td>
                  <td className="py-2 pr-3 text-xs">
                    <div className="font-mono text-slate-800 dark:text-slate-200">{t.line_summaries.join(" · ")}</div>
                    {t.notes && <div className="text-[11px] text-slate-500">{t.notes}</div>}
                  </td>
                  <td className="py-2 pr-3">{t.created_by_name ?? "Hệ thống"}</td>
                  <td className="py-2 pr-3 whitespace-nowrap">{fmtDate(t.posted_at ?? t.created_at)}</td>
                  <td className="py-2 pr-3">
                    <StatusBadge status="RELEASED" label={t.status === "POSTED" ? "Đã ghi sổ" : t.status} />
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}

      {/* TAB 2: PUT-AWAY QUEUE (BT -> A1) */}
      {radarTab === "putaway" && (
        <Card
          title="📦 Hàng đợi Các Lô Đã Giải Phóng QC (`RELEASED`) Chờ Cất Lên Kệ Chính (`BT ➔ A1`)"
          actions={
            (data?.putaway_queue.length ?? 0) > 0 ? (
              <Button onClick={() => putAwayMut.mutate({ put_away_all: true })} disabled={putAwayMut.isPending}>
                📦 Cất Tất Cả ({data?.putaway_queue.length} lô) lên Kệ A1
              </Button>
            ) : undefined
          }
        >
          <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
            Các lô dưới đây đã được Phòng `QA/QC` ký duyệt **Đạt (`RELEASED`)** nhưng hiện vẫn đang nằm tại vị trí **Biệt trữ (`BT`)**. Bấm **Cất lên kệ A1** để mở khóa cho phép phân bổ tự động theo FEFO.
          </p>
          {data?.putaway_queue.length === 0 ? (
            <Empty>Tất cả các lô đã duyệt QC đều đã được cất lên kệ bảo quản chính (A1).</Empty>
          ) : (
            <Table head={["Kho", "Vật tư", "Số Lô", "Hạn dùng", "Vị trí hiện tại", "Kệ đích", "Số lượng chờ cất", "Thao tác 1-Click"]}>
              {data?.putaway_queue.map((p) => (
                <tr key={p.balance_id}>
                  <td className="py-2 pr-3 font-mono font-bold">{p.warehouse_code}</td>
                  <td className="py-2 pr-3">
                    <div className="font-semibold">{p.item_code}</div>
                    <div className="text-slate-500 text-[11px]">{p.item_name}</div>
                  </td>
                  <td className="py-2 pr-3 font-mono font-semibold text-emerald-700 dark:text-emerald-400">{p.lot_code}</td>
                  <td className="py-2 pr-3 whitespace-nowrap">{fmtDate(p.expiry_date)}</td>
                  <td className="py-2 pr-3 font-mono text-amber-700 dark:text-amber-400">{p.from_location_code} (Biệt trữ)</td>
                  <td className="py-2 pr-3 font-mono text-emerald-700 dark:text-emerald-400">{p.to_location_code ?? "A1"} (Kệ chính)</td>
                  <td className="py-2 pr-3 font-semibold whitespace-nowrap">
                    {fmtQty(p.qty_free)} {p.base_uom}
                  </td>
                  <td className="py-2 pr-3">
                    <Button
                      onClick={() => putAwayMut.mutate({ lot_id: p.lot_id, warehouse_id: p.warehouse_id })}
                      disabled={putAwayMut.isPending}
                    >
                      📦 Cất lên kệ {p.to_location_code ?? "A1"}
                    </Button>
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}

      {/* TAB 3: LOW-STOCK MRP RADAR */}
      {radarTab === "low_stock" && (
        <Card title="🛒 Radar Giám sát Tồn Kho An Toàn & Báo Mua Bổ Sung Tự Động (`MRP Reorder Point`)">
          <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
            Hệ thống tự động đối chiếu **Tổng tồn khả dụng (`Kho Tổng` + `5 Kho Nhánh`)** với **Ngưỡng tồn tối thiểu (`Min Safety Stock`)**. Khi vật tư chạm ngưỡng cảnh báo, Thủ kho bấm **1 nút tạo Đề nghị mua (`PR`)** chuyển thẳng sang bộ phận `Cung Ứng NVL`.
          </p>
          <Table
            head={[
              "Mã & Tên Vật tư",
              "Tồn KHO-TONG (A1)",
              "Tồn 5 Kho Nhánh",
              "Đang Biệt trữ (BT)",
              "Đang mở PR / PO",
              "Ngưỡng Tồn Tối Thiểu",
              "Mức độ An toàn",
              "Đặt mua bổ sung (1-Click)",
            ]}
          >
            {(data?.low_stock_radar ?? []).map((item) => {
              const totalAvail = Number(item.hub_available) + Number(item.branch_available);
              const incoming = Number(item.open_pr_qty) + Number(item.open_po_qty);
              const isShort = totalAvail < Number(item.min_safety_stock);
              const suggestQty = Math.max(Number(item.reorder_qty), Number(item.min_safety_stock) * 2 - totalAvail);
              return (
                <tr key={item.item_id}>
                  <td className="py-2 pr-3">
                    <div className="font-mono font-semibold text-slate-900 dark:text-white">{item.item_code}</div>
                    <div className="text-[11px] text-slate-500">{item.item_name}</div>
                  </td>
                  <td className="py-2 pr-3 font-semibold text-sky-700 dark:text-sky-400 whitespace-nowrap">
                    {fmtQty(item.hub_available)} {item.base_uom}
                  </td>
                  <td className="py-2 pr-3 whitespace-nowrap">
                    {fmtQty(item.branch_available)} {item.base_uom}
                  </td>
                  <td className="py-2 pr-3 text-amber-600 whitespace-nowrap">
                    {item.quarantine_qty > 0 ? `${fmtQty(item.quarantine_qty)} ${item.base_uom}` : "—"}
                  </td>
                  <td className="py-2 pr-3 whitespace-nowrap text-xs">
                    {incoming > 0 ? (
                      <span className="text-indigo-600 dark:text-indigo-400 font-semibold">
                        PR: {fmtQty(item.open_pr_qty)} · PO: {fmtQty(item.open_po_qty)}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="py-2 pr-3 font-mono whitespace-nowrap">
                    {fmtQty(item.min_safety_stock)} {item.base_uom}
                  </td>
                  <td className="py-2 pr-3">
                    {isShort ? (
                      <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-rose-100 text-rose-800 dark:bg-rose-950/70 dark:text-rose-300">
                        ⚠️ Dưới ngưỡng ({fmtQty(totalAvail)}/{fmtQty(item.min_safety_stock)})
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300">
                        ✅ An toàn ({fmtQty(totalAvail)})
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-3 whitespace-nowrap">
                    <Button
                      variant={isShort ? "primary" : "ghost"}
                      disabled={createPrMut.isPending}
                      onClick={() =>
                        createPrMut.mutate({
                          item_id: item.item_id,
                          qty: Math.round(suggestQty),
                          item_code: item.item_code,
                        })
                      }
                    >
                      🛒 Tạo PR ({fmtQty(Math.round(suggestQty))} {item.base_uom})
                    </Button>
                  </td>
                </tr>
              );
            })}
          </Table>
        </Card>
      )}

      {/* TAB 4: EXPIRY / FEFO RADAR */}
      {radarTab === "expiry" && (
        <Card title="⏰ Radar Kiểm Soát Hạn Sử Dụng (`FEFO — First-Expired, First-Out`) & Khóa Lô Cận Hạn">
          <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
            Danh sách các lô có hạn sử dụng ≤ 180 ngày được sắp xếp theo thứ tự ưu tiên xuất trước (`FEFO`). Các lô đã hết hạn hoặc nghi ngờ biến tính có thể bấm **Khóa lô (`ON_HOLD`)** ngay lập tức để ngăn xuất nhầm vào sản xuất.
          </p>
          {data?.expiry_radar.length === 0 ? (
            <Empty>Không có lô hàng nào sắp hết hạn trong vòng 180 ngày tới.</Empty>
          ) : (
            <Table head={["Vật tư", "Số Lô", "Kho · Vị trí", "Hạn sử dụng", "Còn lại", "Tồn khả dụng", "Trạng thái Lô", "Thao tác"]}>
              {data?.expiry_radar.map((r) => {
                const isExpired = r.days_left < 0;
                const isUrgent = r.days_left >= 0 && r.days_left <= 45;
                return (
                  <tr key={r.balance_id}>
                    <td className="py-2 pr-3">
                      <div className="font-semibold">{r.item_code}</div>
                      <div className="text-[11px] text-slate-500">{r.item_name}</div>
                    </td>
                    <td className="py-2 pr-3 font-mono font-semibold">{r.lot_code}</td>
                    <td className="py-2 pr-3 font-mono">
                      {r.warehouse_code} · {r.location_code}
                    </td>
                    <td className="py-2 pr-3 whitespace-nowrap">{fmtDate(r.expiry_date)}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${
                          isExpired
                            ? "bg-rose-100 text-rose-800 dark:bg-rose-950/70 dark:text-rose-300"
                            : isUrgent
                            ? "bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300"
                            : "bg-sky-100 text-sky-800 dark:bg-sky-950/70 dark:text-sky-300"
                        }`}
                      >
                        {isExpired ? `Quá hạn ${Math.abs(r.days_left)} ngày` : `Còn ${r.days_left} ngày`}
                      </span>
                    </td>
                    <td className="py-2 pr-3 font-semibold whitespace-nowrap">
                      {fmtQty(r.qty_available)} {r.base_uom}
                    </td>
                    <td className="py-2 pr-3">
                      <StatusBadge status={r.lot_status} />
                    </td>
                    <td className="py-2 pr-3 whitespace-nowrap">
                      {r.lot_status === "RELEASED" && (
                        <Button
                          variant="ghost"
                          disabled={holdLotMut.isPending}
                          onClick={() =>
                            holdLotMut.mutate({
                              lot_id: r.lot_id,
                              reason: isExpired
                                ? `Khóa lô quá hạn sử dụng (${r.expiry_date})`
                                : `Tạm giữ kiểm tra chất lượng lô cận hạn (còn ${r.days_left} ngày)`,
                            })
                          }
                        >
                          <Lock className="w-3 h-3 mr-1 inline" /> Tạm giữ / Khóa xuất
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </Table>
          )}
        </Card>
      )}
    </div>
  );
}

"use client";

import React, { useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, fmtDate, fmtQty, useDebouncedValue, useFactoryMe } from "../api";
import { Card, Empty, ErrorNote, inputClass, LOT_STATUS_LABEL, Pager, StatusBadge, Table } from "../ui";
import { LotPanel, type LotPanelMode } from "./LotPanel";
import { MaterialWhereUsedPanel } from "./MaterialWhereUsedPanel";

export type StockItemGroup = "" | "RAW" | "SEMI_FINISHED" | "FINISHED";

export const STOCK_ITEM_TYPE_LABEL: Record<string, string> = {
  RAW_MATERIAL: "Nguyên liệu gốc",
  REAGENT: "Hóa chất / Thuốc thử",
  CONSUMABLE: "Vật tư tiêu hao / Bao bì",
  COMPONENT: "Linh kiện / Phụ kiện",
  SEMI_FINISHED: "Bán thành phẩm (BTP)",
  FINISHED_KIT: "Thành phẩm (Bộ Kit)",
  DEVICE: "Thiết bị hoàn chỉnh",
  OLIGO_SERVICE: "Sản phẩm Oligo",
  SPARE_PART: "Phụ tùng thay thế",
};

export function resolveStockItemGroup(itemType?: string | null, itemGroup?: string | null): "RAW" | "SEMI_FINISHED" | "FINISHED" {
  if (itemGroup === "FINISHED" || itemGroup === "SEMI_FINISHED" || itemGroup === "RAW") return itemGroup;
  const t = String(itemType ?? "").toUpperCase();
  if (t === "FINISHED_KIT" || t === "DEVICE" || t === "OLIGO_SERVICE") return "FINISHED";
  if (t === "SEMI_FINISHED") return "SEMI_FINISHED";
  return "RAW";
}

export function StockCategoryBadge({
  itemType,
  itemGroup,
  canEdit,
  onChangeType,
  isUpdating,
}: {
  itemType?: string | null;
  itemGroup?: string | null;
  canEdit?: boolean;
  onChangeType?: (nextType: string) => void;
  isUpdating?: boolean;
}) {
  const grp = resolveStockItemGroup(itemType, itemGroup);
  const subLabel = itemType ? STOCK_ITEM_TYPE_LABEL[itemType] ?? itemType : "";
  const badgeMeta =
    grp === "FINISHED"
      ? {
          icon: "📦",
          groupLabel: "Thành phẩm",
          cls: "bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800",
        }
      : grp === "SEMI_FINISHED"
        ? {
            icon: "⚗️",
            groupLabel: "Bán thành phẩm",
            cls: "bg-violet-50 text-violet-800 border-violet-200 dark:bg-violet-950/50 dark:text-violet-300 dark:border-violet-800",
          }
        : {
            icon: "🧪",
            groupLabel: "Nguyên liệu",
            cls:
              itemType === "CONSUMABLE" || itemType === "COMPONENT"
                ? "bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-800"
                : "bg-sky-50 text-sky-800 border-sky-200 dark:bg-sky-950/50 dark:text-sky-300 dark:border-sky-800",
          };

  return (
    <div className="flex flex-col items-start gap-0.5">
      {canEdit && onChangeType ? (
        <select
          aria-label="Đổi phân loại vật tư"
          disabled={isUpdating}
          value={itemType || "RAW_MATERIAL"}
          onChange={(e) => onChangeType(e.target.value)}
          title="Bấm để đổi phân loại (Nguyên liệu / Bán thành phẩm / Thành phẩm)"
          className={`px-2 py-0.5 rounded-lg text-[11px] font-bold border cursor-pointer transition-colors ${badgeMeta.cls}`}
        >
          <optgroup label="🧪 Nhóm Nguyên liệu">
            <option value="RAW_MATERIAL">🧪 Nguyên liệu · Nguyên liệu gốc</option>
            <option value="REAGENT">🧪 Nguyên liệu · Hóa chất / Thuốc thử</option>
            <option value="CONSUMABLE">🧪 Nguyên liệu · Vật tư tiêu hao / Bao bì</option>
            <option value="COMPONENT">🧪 Nguyên liệu · Linh kiện / Phụ kiện</option>
          </optgroup>
          <optgroup label="⚗️ Nhóm Bán thành phẩm">
            <option value="SEMI_FINISHED">⚗️ Bán thành phẩm (MasterMix / Buffer / BTP)</option>
          </optgroup>
          <optgroup label="📦 Nhóm Thành phẩm">
            <option value="FINISHED_KIT">📦 Thành phẩm (Bộ Kit hoàn chỉnh)</option>
            <option value="DEVICE">📦 Thành phẩm (Thiết bị)</option>
          </optgroup>
        </select>
      ) : (
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] font-bold border whitespace-nowrap ${badgeMeta.cls}`}>
          <span>{badgeMeta.icon}</span>
          <span>{badgeMeta.groupLabel}</span>
        </span>
      )}
      {subLabel && grp === "RAW" && (
        <span className="text-[11px] text-slate-500 dark:text-slate-400 pl-0.5 whitespace-nowrap">
          {subLabel}
        </span>
      )}
    </div>
  );
}

interface StockRow {
  id: string;
  item_id: string;
  lot_id: string | null;
  item_code: string;
  item_name: string;
  item_type?: string;
  item_version?: number;
  item_group?: "RAW" | "SEMI_FINISHED" | "FINISHED";
  base_uom: string;
  lot_code: string | null;
  mfr_lot_no: string | null;
  lot_status: string | null;
  expiry_date: string | null;
  warehouse_code: string;
  location_id?: string;
  location_code: string;
  is_quarantine: boolean;
  qty_on_hand: string;
  qty_reserved: string;
  qty_available: string;
  incubation_until: string | null;
}

interface StockGroupCounts {
  total_lots: number;
  total_items: number;
  raw_lots: number;
  raw_items: number;
  semi_lots: number;
  semi_items: number;
  finished_lots: number;
  finished_items: number;
  chemical_lots: number;
  consumable_lots: number;
}

export function StockView({
  warehouses,
  initialWarehouseId = "",
  initialStatus = "",
}: {
  warehouses: { id: string; code: string; name: string; owner_name?: string; owner_module_key?: string }[];
  initialWarehouseId?: string;
  initialStatus?: string;
}) {
  const me = useFactoryMe();
  const perms = new Set(me.data?.permissions ?? []);
  const canManageItem = perms.has("master.item.manage");
  const qc = useQueryClient();

  const [warehouseId, setWarehouseId] = useState(initialWarehouseId);
  const [itemGroup, setItemGroup] = useState<StockItemGroup>("");
  const [itemTypeFilter, setItemTypeFilter] = useState("");
  const [q, setQ] = useState("");
  const debouncedQ = useDebouncedValue(q, 300);
  const [status, setStatus] = useState(initialStatus);
  const [page, setPage] = useState(1);
  const [lotId, setLotId] = useState<string | null>(null);
  const [lotMode, setLotMode] = useState<LotPanelMode>("VIEW");
  const [whereUsedItemCode, setWhereUsedItemCode] = useState<string | null>(null);

  const params = new URLSearchParams({ page: String(page), page_size: "50" });
  if (warehouseId) params.set("warehouse_id", warehouseId);
  if (itemGroup) params.set("item_group", itemGroup);
  if (itemTypeFilter) params.set("item_type", itemTypeFilter);
  if (debouncedQ.trim()) params.set("q", debouncedQ.trim());
  if (status) params.set("status", status);

  const stock = useQuery({
    queryKey: ["factory", "stock", params.toString()],
    queryFn: () =>
      api<{ rows: StockRow[]; total: number; page: number; page_size: number; group_counts?: StockGroupCounts }>(
        `/api/factory/inv/stock?${params}`
      ),
    placeholderData: keepPreviousData,
  });

  const updateTypeMut = useMutation({
    mutationFn: (payload: { itemId: string; version: number; item_type: string; code: string }) =>
      api(`/api/factory/master/items/${payload.itemId}`, {
        method: "PATCH",
        json: {
          version: payload.version,
          item_type: payload.item_type,
          is_manufacturable: ["SEMI_FINISHED", "FINISHED_KIT", "DEVICE"].includes(payload.item_type),
          reason: `Phân loại lại ${payload.code} sang ${STOCK_ITEM_TYPE_LABEL[payload.item_type] ?? payload.item_type}`,
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["factory", "stock"] });
      qc.invalidateQueries({ queryKey: ["factory", "items"] });
      qc.invalidateQueries({ queryKey: ["factory", "dept-quick-stock"] });
    },
    onError: (e) => window.alert((e as Error).message),
  });

  const reset = (fn: () => void) => {
    fn();
    setPage(1);
  };

  const counts = stock.data?.group_counts;
  const selectedWhCode = warehouses.find((w) => w.id === warehouseId)?.code ?? "";
  const visibleStockRows = React.useMemo(() => {
    const raw = stock.data?.rows ?? [];
    if (!stock.isPlaceholderData) return raw;
    const typeSet = itemTypeFilter ? new Set(itemTypeFilter.split(",").map((s) => s.trim())) : null;
    return raw.filter((r) => {
      if (selectedWhCode && r.warehouse_code !== selectedWhCode) return false;
      if (itemGroup && r.item_group !== itemGroup) return false;
      if (typeSet && (!r.item_type || !typeSet.has(r.item_type))) return false;
      if (status && r.lot_status !== status) return false;
      return true;
    });
  }, [stock.data?.rows, stock.isPlaceholderData, selectedWhCode, itemGroup, itemTypeFilter, status]);

  const handleDropdownTypeChange = (val: string) => {
    reset(() => {
      if (!val) {
        setItemGroup("");
        setItemTypeFilter("");
      } else if (val === "GROUP:RAW") {
        setItemGroup("RAW");
        setItemTypeFilter("");
      } else if (val === "GROUP:SEMI_FINISHED") {
        setItemGroup("SEMI_FINISHED");
        setItemTypeFilter("");
      } else if (val === "GROUP:FINISHED") {
        setItemGroup("FINISHED");
        setItemTypeFilter("");
      } else {
        if (val === "SEMI_FINISHED") setItemGroup("SEMI_FINISHED");
        else if (val === "FINISHED_KIT" || val === "DEVICE") setItemGroup("FINISHED");
        else setItemGroup("RAW");
        setItemTypeFilter(val);
      }
    });
  };

  const dropdownValue = itemTypeFilter
    ? itemTypeFilter
    : itemGroup
      ? `GROUP:${itemGroup}`
      : "";

  return (
    <>
    <MaterialWhereUsedPanel
      externalItemCode={whereUsedItemCode}
      onClearExternal={() => setWhereUsedItemCode(null)}
    />
    <Card title="Tồn kho theo lô và vị trí (Kho Tổng & Kho Nhánh Phòng Ban)">
      {warehouses.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5 mb-2.5">
          <button
            type="button"
            onClick={() => reset(() => setWarehouseId(""))}
            className={`px-3 py-1 rounded-xl text-xs font-bold border transition-colors cursor-pointer ${
              warehouseId === ""
                ? "bg-sky-700 text-white border-sky-700"
                : "bg-slate-50 dark:bg-slate-800/80 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-100"
            }`}
          >
            Tất cả kho ({warehouses.length})
          </button>
          {warehouses.map((w) => {
            const shortLabel =
              w.code === "KHO-TONG"
                ? "KHO-TONG · Kho Trung Tâm"
                : w.code === "KHO-KIT"
                  ? "KHO-KIT · Kho SX Kit"
                  : w.code === "KHO-OLIGO"
                    ? "KHO-OLIGO · Kho Oligo"
                    : w.code === "KHO-DEVICE"
                      ? "KHO-DEVICE · Kho Thiết Bị"
                      : w.code === "KHO-RD"
                        ? "KHO-RD · Kho R&D"
                        : w.code === "KHO-QA"
                          ? "KHO-QA · Kho QA/QC"
                          : `${w.code} · ${w.name}`;
            return (
              <button
                key={w.id}
                type="button"
                title={`${w.code} — ${w.name}${w.owner_name ? ` (${w.owner_name})` : ""}`}
                onClick={() => reset(() => setWarehouseId(w.id))}
                className={`px-2.5 py-1 rounded-xl text-xs font-bold border transition-colors cursor-pointer whitespace-nowrap ${
                  warehouseId === w.id
                    ? "bg-sky-700 text-white border-sky-700"
                    : "bg-slate-50 dark:bg-slate-800/80 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-100"
                }`}
              >
                {shortLabel}
              </button>
            );
          })}
        </div>
      )}

      {/* Bộ lọc Phân loại 3 nhóm: Nguyên liệu / Bán thành phẩm / Thành phẩm */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3 p-2 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 px-1">
            Phân loại tồn kho:
          </span>
          <button
            type="button"
            onClick={() =>
              reset(() => {
                setItemGroup("");
                setItemTypeFilter("");
              })
            }
            className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition-colors cursor-pointer ${
              itemGroup === "" && !itemTypeFilter
                ? "bg-slate-800 text-white border-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:border-slate-100"
                : "bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-100"
            }`}
          >
            Tất cả phân loại
            {counts ? ` (${counts.total_lots} lô · ${counts.total_items} mã)` : ""}
          </button>

          <button
            type="button"
            onClick={() =>
              reset(() => {
                setItemGroup("RAW");
                setItemTypeFilter("");
              })
            }
            className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition-colors cursor-pointer ${
              itemGroup === "RAW" && !itemTypeFilter
                ? "bg-sky-700 text-white border-sky-700"
                : "bg-white dark:bg-slate-800 text-sky-800 dark:text-sky-300 border-sky-200 dark:border-sky-800/70 hover:bg-sky-50"
            }`}
            title="Bao gồm Nguyên liệu gốc, Hóa chất / Thuốc thử, Mồi & Probe, Bao bì & Vật tư tiêu hao"
          >
            🧪 Nguyên liệu
            {counts ? ` (${counts.raw_lots} lô · ${counts.raw_items} mã)` : ""}
          </button>

          <button
            type="button"
            onClick={() =>
              reset(() => {
                setItemGroup("SEMI_FINISHED");
                setItemTypeFilter("");
              })
            }
            className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition-colors cursor-pointer ${
              itemGroup === "SEMI_FINISHED"
                ? "bg-violet-700 text-white border-violet-700"
                : "bg-white dark:bg-slate-800 text-violet-800 dark:text-violet-300 border-violet-200 dark:border-violet-800/70 hover:bg-violet-50"
            }`}
            title="Bao gồm Master Mix, Buffer, Dung dịch pha chế, Chứng dương (PC) & Chứng nội (IC)"
          >
            ⚗️ Bán thành phẩm
            {counts ? ` (${counts.semi_lots} lô · ${counts.semi_items} mã)` : ""}
          </button>

          <button
            type="button"
            onClick={() =>
              reset(() => {
                setItemGroup("FINISHED");
                setItemTypeFilter("");
              })
            }
            className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition-colors cursor-pointer ${
              itemGroup === "FINISHED"
                ? "bg-emerald-700 text-white border-emerald-700"
                : "bg-white dark:bg-slate-800 text-emerald-800 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800/70 hover:bg-emerald-50"
            }`}
            title="Bao gồm Bộ Kit thành phẩm (PCR Kit, Kit tách chiết) và sản phẩm hoàn chỉnh"
          >
            📦 Thành phẩm
            {counts ? ` (${counts.finished_lots} lô · ${counts.finished_items} mã)` : ""}
          </button>
        </div>

        {/* Bộ lọc nhánh con khi đang xem Nguyên liệu */}
        {itemGroup === "RAW" && (
          <div className="flex flex-wrap items-center gap-1 text-[11px]">
            <span className="text-slate-400 mr-0.5">Nhóm con:</span>
            <button
              type="button"
              onClick={() => reset(() => setItemTypeFilter(""))}
              className={`px-2 py-0.5 rounded-md font-semibold border cursor-pointer ${
                !itemTypeFilter
                  ? "bg-sky-100 text-sky-900 border-sky-300 dark:bg-sky-900/60 dark:text-sky-100"
                  : "bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700"
              }`}
            >
              Tất cả NL ({counts?.raw_lots ?? 0})
            </button>
            <button
              type="button"
              onClick={() => reset(() => setItemTypeFilter("RAW_MATERIAL,REAGENT"))}
              className={`px-2 py-0.5 rounded-md font-semibold border cursor-pointer ${
                itemTypeFilter === "RAW_MATERIAL,REAGENT"
                  ? "bg-sky-100 text-sky-900 border-sky-300 dark:bg-sky-900/60 dark:text-sky-100"
                  : "bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700"
              }`}
            >
              Hóa chất / Nguyên liệu / Mồi ({counts?.chemical_lots ?? 0})
            </button>
            <button
              type="button"
              onClick={() => reset(() => setItemTypeFilter("CONSUMABLE,COMPONENT,SPARE_PART"))}
              className={`px-2 py-0.5 rounded-md font-semibold border cursor-pointer ${
                itemTypeFilter === "CONSUMABLE,COMPONENT,SPARE_PART"
                  ? "bg-amber-100 text-amber-900 border-amber-300 dark:bg-amber-900/60 dark:text-amber-100"
                  : "bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700"
              }`}
            >
              Bao bì / Tiêu hao / Phụ kiện ({counts?.consumable_lots ?? 0})
            </button>
          </div>
        )}
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 mb-3">
        <select className={inputClass} value={warehouseId} onChange={(e) => reset(() => setWarehouseId(e.target.value))} aria-label="Kho">
          <option value="">Tất cả kho được xem</option>
          {warehouses.map((w) => (
            <option key={w.id} value={w.id}>
              {w.code} — {w.name}
            </option>
          ))}
        </select>
        <select
          className={inputClass}
          value={dropdownValue}
          onChange={(e) => handleDropdownTypeChange(e.target.value)}
          aria-label="Phân loại vật tư"
        >
          <option value="">Mọi phân loại (Nguyên liệu / BTP / Thành phẩm)</option>
          <optgroup label="3 Nhóm chính trong Kho">
            <option value="GROUP:RAW">🧪 Nhóm Nguyên liệu (Hóa chất, Mồi, Bao bì, Tiêu hao)</option>
            <option value="GROUP:SEMI_FINISHED">⚗️ Nhóm Bán thành phẩm (MasterMix, Buffer, BTP pha chế)</option>
            <option value="GROUP:FINISHED">📦 Nhóm Thành phẩm (Bộ Kit hoàn chỉnh)</option>
          </optgroup>
          <optgroup label="Chi tiết theo loại">
            <option value="REAGENT">• Hóa chất / Thuốc thử / Mồi (REAGENT)</option>
            <option value="RAW_MATERIAL">• Nguyên liệu gốc (RAW_MATERIAL)</option>
            <option value="CONSUMABLE">• Vật tư tiêu hao / Bao bì (CONSUMABLE)</option>
            <option value="COMPONENT">• Linh kiện / Phụ kiện (COMPONENT)</option>
            <option value="SEMI_FINISHED">• Bán thành phẩm (SEMI_FINISHED)</option>
            <option value="FINISHED_KIT">• Kit thành phẩm (FINISHED_KIT)</option>
          </optgroup>
        </select>
        <input className={inputClass} placeholder="Tìm mã, tên vật tư, số lô…" value={q} onChange={(e) => reset(() => setQ(e.target.value))} />
        <select className={inputClass} value={status} onChange={(e) => reset(() => setStatus(e.target.value))} aria-label="Trạng thái lô">
          <option value="">Mọi trạng thái lô</option>
          {Object.entries(LOT_STATUS_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </div>
      <ErrorNote error={stock.error} />
      {stock.isFetching && visibleStockRows.length === 0 && <Empty>⏳ Đang tải tồn kho…</Empty>}
      {!stock.isFetching && stock.data && visibleStockRows.length === 0 && <Empty>Chưa có tồn kho phù hợp bộ lọc.</Empty>}
      {visibleStockRows.length > 0 && (
        <>
          <Table head={["Vật tư", "Phân loại", "Lô / Lô NSX", "Trạng thái", "Hạn dùng", "Kho · Vị trí", "Tồn", "Giữ chỗ", "Khả dụng", "Thao tác"]}>
            {visibleStockRows.map((r) => {
              const isLotOpen = Boolean(r.lot_id && lotId === r.lot_id);
              return (
                <React.Fragment key={r.id}>
                  <tr className={isLotOpen ? "bg-sky-50/70 dark:bg-sky-950/30" : ""}>
                    <td className="py-2 pr-3">
                      <div className="font-semibold">{r.item_code}</div>
                      <div className="text-slate-500 dark:text-slate-400">{r.item_name}</div>
                    </td>
                    <td className="py-2 pr-3">
                      <StockCategoryBadge
                        itemType={r.item_type}
                        itemGroup={r.item_group}
                        canEdit={canManageItem && typeof r.item_version === "number"}
                        isUpdating={updateTypeMut.isPending}
                        onChangeType={(nextType) => {
                          if (typeof r.item_version !== "number" || nextType === r.item_type) return;
                          updateTypeMut.mutate({
                            itemId: r.item_id,
                            version: r.item_version,
                            item_type: nextType,
                            code: r.item_code,
                          });
                        }}
                      />
                    </td>
                    <td className="py-2 pr-3 whitespace-nowrap">
                      {r.lot_id ? (
                        <button
                          className="font-mono font-bold text-sky-700 dark:text-sky-400 underline underline-offset-2 cursor-pointer"
                          onClick={() => setLotId(isLotOpen ? null : r.lot_id)}
                          title="Xem lô, QC và thao tác chất lượng"
                        >
                          {r.lot_code}
                        </button>
                      ) : (
                        <div className="font-mono">—</div>
                      )}
                      <div className="text-slate-500 dark:text-slate-400">{r.mfr_lot_no ?? ""}</div>
                    </td>
                    <td className="py-2 pr-3">
                      {r.lot_status ? <StatusBadge status={r.lot_status} /> : "—"}
                      {r.incubation_until && (
                        <div className="text-[11px] text-amber-700 dark:text-amber-400">
                          Đang ủ đến {fmtDate(r.incubation_until)}
                        </div>
                      )}
                    </td>
                    <td className="py-2 pr-3 whitespace-nowrap">{fmtDate(r.expiry_date)}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">
                      {r.warehouse_code} · {r.location_code}
                      {r.is_quarantine && <span className="ml-1 text-amber-600 dark:text-amber-400">(biệt trữ)</span>}
                    </td>
                    <td className="py-2 pr-3 text-right whitespace-nowrap">
                      {fmtQty(r.qty_on_hand)} {r.base_uom}
                    </td>
                    <td className="py-2 pr-3 text-right whitespace-nowrap">{fmtQty(r.qty_reserved)}</td>
                    <td className="py-2 pr-3 text-right whitespace-nowrap font-semibold">{fmtQty(r.qty_available)}</td>
                    <td className="py-2 pr-3 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => setWhereUsedItemCode(r.item_code)}
                          title={`Xem mã vật tư ${r.item_code} dùng cho những sản phẩm nào và tồn kho hiện tại sản xuất được bao nhiêu thành phẩm`}
                          className="px-2 py-1 rounded-lg text-[11px] font-bold border bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800 hover:bg-emerald-100 transition cursor-pointer"
                        >
                          🔍 SP dùng &amp; SL SX
                        </button>
                      {r.lot_id && (
                        <>
                          <button
                            type="button"
                            onClick={() => {
                              setLotId(r.lot_id);
                              setLotMode("EDIT");
                            }}
                            title="Sửa thông tin cơ bản (Tên vật tư, ĐVT, Mã lô, Lô NSX, Ngày SX, Hạn dùng)"
                            className="px-2 py-1 rounded-lg text-[11px] font-bold border bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border-amber-300 dark:border-amber-800 hover:bg-amber-100 transition cursor-pointer"
                          >
                            ✏️ Sửa
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setLotId(r.lot_id);
                              setLotMode("ISSUE");
                            }}
                            title="Xuất kho trực tiếp từ lô này"
                            className="px-2 py-1 rounded-lg text-[11px] font-bold border bg-rose-50 dark:bg-rose-950/40 text-rose-800 dark:text-rose-300 border-rose-300 dark:border-rose-800 hover:bg-rose-100 transition cursor-pointer"
                          >
                            📤 Xuất
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setLotId(r.lot_id);
                              setLotMode("ADJUST");
                            }}
                            title="Điều chỉnh / Cân đối tồn kho thực tế của lô này"
                            className="px-2 py-1 rounded-lg text-[11px] font-bold border bg-indigo-50 dark:bg-indigo-950/40 text-indigo-800 dark:text-indigo-300 border-indigo-300 dark:border-indigo-800 hover:bg-indigo-100 transition cursor-pointer"
                          >
                            ⚖️ Cân đối
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (isLotOpen && lotMode === "VIEW") {
                                setLotId(null);
                              } else {
                                setLotId(r.lot_id);
                                setLotMode("VIEW");
                              }
                            }}
                            className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition cursor-pointer ${
                              isLotOpen
                                ? "bg-sky-600 text-white border-sky-500"
                                : r.lot_status === "QUARANTINE" || r.lot_status === "PENDING_QC"
                                  ? "bg-amber-500/15 text-amber-800 dark:text-amber-300 border-amber-500/40 hover:bg-amber-500/25"
                                  : "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:bg-slate-200"
                            }`}
                          >
                            {isLotOpen
                              ? "Đóng lô"
                              : r.lot_status === "QUARANTINE" || r.lot_status === "PENDING_QC"
                                ? "🧪 Duyệt QC"
                                : "Chi tiết"}
                          </button>
                        </>
                      )}
                      </div>
                    </td>
                  </tr>
                  {isLotOpen && r.lot_id && (
                    <tr className="bg-sky-50/40 dark:bg-sky-950/20">
                      <td colSpan={10} className="p-3 border-b-2 border-sky-400 dark:border-sky-700">
                        <LotPanel
                          key={r.lot_id}
                          lotId={r.lot_id}
                          initialMode={lotMode}
                          defaultLocationId={r.location_id}
                          onClose={() => setLotId(null)}
                        />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </Table>
          <Pager
            page={stock.data?.page ?? page}
            pageSize={stock.data?.page_size ?? 50}
            total={stock.isPlaceholderData ? visibleStockRows.length : stock.data?.total ?? visibleStockRows.length}
            onPage={setPage}
          />
        </>
      )}
    </Card>
    </>
  );
}

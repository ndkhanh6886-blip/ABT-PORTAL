"use client";

import React, { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, fmtDate, fmtQty, useDebouncedValue } from "../api";
import { Button, Card, Empty, ErrorNote, inputClass, StatusBadge, Table } from "../ui";

export interface WhereUsedResponse {
  selected_item: {
    id: string;
    code: string;
    name: string;
    item_type: string;
    base_uom: string;
    storage_condition?: string | null;
  } | null;
  candidates: {
    id: string;
    code: string;
    name: string;
    item_type: string;
    base_uom: string;
    used_in_bom_count?: number;
  }[];
  stock_summary: {
    total_on_hand: number;
    total_reserved: number;
    available_released_qty: number;
    quarantine_pending_qty: number;
  };
  stock_lots: {
    id: string;
    warehouse_code: string;
    warehouse_name: string;
    location_code: string;
    is_quarantine: boolean;
    lot_id: string | null;
    lot_code: string | null;
    lot_status: string | null;
    expiry_date: string | null;
    qty_on_hand: number;
    qty_reserved: number;
    qty_available: number;
  }[];
  usages: {
    usage_key: string;
    domain: "FINISHED_KIT" | "SEMI_FINISHED" | "DEVICE";
    tier_level: number;
    tier_label: string;
    product_item_id: string;
    product_code: string;
    product_name: string;
    product_uom: string;
    tests_per_kit?: number | null;
    bom_id: string;
    bom_code: string;
    bom_status: string;
    where_in_product: string;
    qty_per_product_unit: number;
    material_uom: string;
    scrap_factor: number;
    max_producible_available: number;
    max_producible_total: number;
    extra_producible_from_semi_stock?: number;
    semi_code?: string;
    semi_available_stock?: number;
    is_optional?: boolean;
  }[];
}

export function MaterialWhereUsedPanel({
  externalItemCode,
  onClearExternal,
  defaultExpanded = false,
}: {
  externalItemCode?: string | null;
  onClearExternal?: () => void;
  defaultExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(Boolean(defaultExpanded || externalItemCode));
  const [searchInput, setSearchInput] = useState(externalItemCode || "");
  const [selectedItemId, setSelectedItemId] = useState<string>("");
  const [plannedAllocations, setPlannedAllocations] = useState<Record<string, string>>({});
  const debouncedSearch = useDebouncedValue(searchInput.trim(), 220);

  useEffect(() => {
    if (externalItemCode) {
      setExpanded(true);
      setSearchInput(externalItemCode);
      setSelectedItemId("");
      setPlannedAllocations({});
    }
  }, [externalItemCode]);

  const queryResult = useQuery({
    queryKey: ["factory", "where-used", selectedItemId, debouncedSearch],
    queryFn: () => {
      const params = new URLSearchParams({ op: "where_used" });
      if (selectedItemId) params.set("item_id", selectedItemId);
      else if (debouncedSearch) params.set("q", debouncedSearch);
      return api<WhereUsedResponse>(`/api/factory/inv/ops?${params.toString()}`);
    },
    enabled: expanded,
  });

  const data = queryResult.data;
  const item = data?.selected_item ?? null;
  const stock = data?.stock_summary ?? {
    total_on_hand: 0,
    total_reserved: 0,
    available_released_qty: 0,
    quarantine_pending_qty: 0,
  };
  const usages = data?.usages ?? [];

  // Tính tổng lượng nguyên liệu tiêu hao nếu người dùng nhập thử kịch bản phân bổ sản xuất nhiều mã thành phẩm cùng lúc
  const totalSimulatedConsumption = usages.reduce((sum, u) => {
    const planned = Number((plannedAllocations[u.usage_key] || "").replace(",", "."));
    if (!Number.isFinite(planned) || planned <= 0) return sum;
    return sum + planned * u.qty_per_product_unit;
  }, 0);
  const remainingAvailAfterSim = stock.available_released_qty - totalSimulatedConsumption;
  const remainingTotalAfterSim = stock.total_on_hand - totalSimulatedConsumption;

  return (
    <Card
      title="🔍 Tra Cứu Ngược Mã Nguyên Liệu (Where-Used BOM) & Tính Năng Lực Sản Xuất Thành Phẩm Theo Tồn Kho"
      actions={
        <div className="flex items-center gap-2">
          {externalItemCode && onClearExternal && (
            <Button
              variant="ghost"
              onClick={() => {
                setSearchInput("");
                setSelectedItemId("");
                onClearExternal();
              }}
            >
              Xóa chọn ({externalItemCode})
            </Button>
          )}
          <Button variant={expanded ? "secondary" : "primary"} onClick={() => setExpanded((v) => !v)}>
            {expanded ? "Thu gọn khung tra cứu ▲" : "🔍 Mở Tra Cứu Ngược Nguyên Liệu → Thành Phẩm ▼"}
          </Button>
        </div>
      }
    >
      {!expanded ? (
        <div className="text-xs text-slate-600 dark:text-slate-300">
          💡 Nhập bất kỳ <b>Mã nguyên liệu / Hóa chất / Vật tư tiêu hao / Linh kiện / Bán thành phẩm</b> (hoặc bấm nút{" "}
          <b>&quot;🔍 SP sử dụng &amp; SL SX&quot;</b> ở từng dòng tồn kho bên dưới) để xem nguyên liệu đó dùng cho những mã sản phẩm nào và lượng tồn kho hiện có sản xuất được bao nhiêu thành phẩm.
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {/* Thanh tìm kiếm & Gợi ý nhanh các nguyên liệu */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
            <input
              type="text"
              value={searchInput}
              onChange={(e) => {
                setSearchInput(e.target.value);
                setSelectedItemId("");
                setPlannedAllocations({});
              }}
              placeholder="🔍 Nhập mã hoặc tên nguyên liệu cần tra cứu (VD: LN024, HC001, T02, Enzyme, MasterMix...)"
              className={`${inputClass} flex-1 font-semibold`}
            />
            {Object.keys(plannedAllocations).length > 0 && (
              <Button variant="ghost" onClick={() => setPlannedAllocations({})}>
                ↺ Đặt lại mô phỏng SL
              </Button>
            )}
          </div>

          {/* Danh sách chip gợi ý khớp từ khóa */}
          {(data?.candidates ?? []).length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] font-bold text-slate-500">Chọn nhanh mã nguyên liệu:</span>
              {(data?.candidates ?? []).slice(0, 12).map((c) => {
                const isSelected = item?.id === c.id;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => {
                      setSelectedItemId(c.id);
                      setSearchInput(c.code);
                      setPlannedAllocations({});
                    }}
                    className={`px-2.5 py-1 rounded-xl text-xs font-mono font-bold border cursor-pointer transition-all ${
                      isSelected
                        ? "bg-sky-700 text-white border-sky-700 shadow-2xs"
                        : "bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:border-sky-400"
                    }`}
                  >
                    {c.code} — <span className="font-sans font-normal">{c.name}</span>
                  </button>
                );
              })}
            </div>
          )}

          <ErrorNote error={queryResult.error} />

          {item ? (
            <>
              {/* Khung Tổng hợp Tồn kho hiện tại của Nguyên liệu */}
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5 p-3 rounded-2xl bg-sky-50/70 dark:bg-sky-950/30 border border-sky-200 dark:border-sky-800/70">
                <div className="sm:col-span-1">
                  <div className="text-[11px] font-bold uppercase text-sky-700 dark:text-sky-300">
                    Nguyên liệu đang tra cứu
                  </div>
                  <div className="font-mono font-extrabold text-base text-slate-900 dark:text-white mt-0.5">
                    {item.code}
                  </div>
                  <div className="text-xs font-semibold text-slate-700 dark:text-slate-200">{item.name}</div>
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    ĐVT gốc: <b className="font-mono">{item.base_uom}</b> · Đang dùng trong{" "}
                    <b>{usages.length} định mức sản phẩm</b>
                  </div>
                </div>

                <div className="p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-emerald-200 dark:border-emerald-800">
                  <div className="text-[11px] font-bold text-emerald-700 dark:text-emerald-300">
                    ✅ Tồn khả dụng (Đã duyệt QC)
                  </div>
                  <div className="text-lg font-extrabold font-mono text-emerald-700 dark:text-emerald-300 mt-0.5">
                    {fmtQty(stock.available_released_qty)} {item.base_uom}
                  </div>
                  <div className="text-[11px] text-slate-500">
                    Sẵn sàng xuất sản xuất ngay (Kệ chính, còn hạn)
                  </div>
                </div>

                <div className="p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-amber-200 dark:border-amber-800">
                  <div className="text-[11px] font-bold text-amber-700 dark:text-amber-300">
                    ⏳ Tồn Biệt trữ / Chờ QC
                  </div>
                  <div className="text-lg font-extrabold font-mono text-amber-700 dark:text-amber-300 mt-0.5">
                    {fmtQty(stock.quarantine_pending_qty)} {item.base_uom}
                  </div>
                  <div className="text-[11px] text-slate-500">
                    Đang giữ chỗ lệnh SX: <b>{fmtQty(stock.total_reserved)} {item.base_uom}</b>
                  </div>
                </div>

                <div className="p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-sky-200 dark:border-sky-800">
                  <div className="text-[11px] font-bold text-sky-700 dark:text-sky-300">
                    📦 Tổng Tồn Vật Lý Toàn Nhà Máy
                  </div>
                  <div className="text-lg font-extrabold font-mono text-sky-800 dark:text-sky-200 mt-0.5">
                    {fmtQty(stock.total_on_hand)} {item.base_uom}
                  </div>
                  <div className="text-[11px] text-slate-500">
                    Gồm {(data?.stock_lots ?? []).length} lô tồn kho tại các kho
                  </div>
                </div>
              </div>

              {/* Thanh kết quả mô phỏng nếu người dùng gõ SL dự kiến sản xuất nhiều mã sản phẩm */}
              {totalSimulatedConsumption > 0 && (
                <div
                  className={`p-3 rounded-xl border text-xs flex flex-wrap items-center justify-between gap-2 ${
                    remainingAvailAfterSim >= 0
                      ? "bg-emerald-50/80 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-800 text-emerald-950 dark:text-emerald-200"
                      : "bg-rose-50/90 dark:bg-rose-950/40 border-rose-300 dark:border-rose-800 text-rose-950 dark:text-rose-200"
                  }`}
                >
                  <div>
                    🧮 <b>Mô phỏng phân bổ sản xuất nhiều thành phẩm cùng lúc:</b> Tổng lượng <b>{item.code}</b> cần dùng ={" "}
                    <b className="font-mono">
                      {fmtQty(totalSimulatedConsumption)} {item.base_uom}
                    </b>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 font-mono font-bold">
                    <span>
                      So với Tồn khả dụng:{" "}
                      {remainingAvailAfterSim >= 0
                        ? `Còn dư +${fmtQty(remainingAvailAfterSim)} ${item.base_uom}`
                        : `Thiếu hụt ${fmtQty(remainingAvailAfterSim)} ${item.base_uom}`}
                    </span>
                    <span>·</span>
                    <span>
                      So với Tổng tồn vật lý:{" "}
                      {remainingTotalAfterSim >= 0
                        ? `Còn dư +${fmtQty(remainingTotalAfterSim)} ${item.base_uom}`
                        : `Thiếu hụt ${fmtQty(remainingTotalAfterSim)} ${item.base_uom}`}
                    </span>
                  </div>
                </div>
              )}

              {/* Bảng Danh sách Sản phẩm sử dụng Nguyên liệu này & Số lượng Thành phẩm tối đa sản xuất được */}
              {usages.length === 0 ? (
                <Empty>
                  Mã nguyên liệu <b>{item.code} ({item.name})</b> hiện chưa được khai báo trong Định mức BOM Kit, Bán thành phẩm hoặc Thiết bị nào.
                </Empty>
              ) : (
                <Table
                  head={[
                    "Mã & Tên Thành phẩm / BTP / Thiết bị",
                    "Cấp sử dụng trong BOM",
                    "Mã BOM & Vị trí / Thành phần",
                    "Định mức tiêu hao / 1 ĐV SP",
                    "SL Thành phẩm SX được (Từ Tồn khả dụng)",
                    "SL Thành phẩm SX được (Từ Tổng tồn kho)",
                    "Mô phỏng đặt SX (Nhập SL thử)",
                  ]}
                >
                  {usages.map((u) => {
                    const simQty = Number((plannedAllocations[u.usage_key] || "").replace(",", "."));
                    const simConsume = Number.isFinite(simQty) && simQty > 0 ? simQty * u.qty_per_product_unit : 0;
                    return (
                      <tr key={u.usage_key}>
                        <td className="py-2 pr-3">
                          <div className="font-mono font-extrabold text-sky-700 dark:text-sky-300">
                            {u.product_code}
                          </div>
                          <div className="font-semibold text-slate-900 dark:text-slate-100 text-xs">
                            {u.product_name}
                          </div>
                          <div className="text-[11px] text-slate-500">
                            ĐVT: <b>{u.product_uom}</b>
                            {u.tests_per_kit ? ` · Quy cách: ${u.tests_per_kit} test/bộ` : ""}
                          </div>
                        </td>
                        <td className="py-2 pr-3">
                          <span
                            className={`inline-block px-2 py-0.5 rounded-lg text-[11px] font-bold border ${
                              u.domain === "FINISHED_KIT"
                                ? u.tier_level === 2
                                  ? "bg-purple-50 text-purple-800 border-purple-200 dark:bg-purple-950/60 dark:text-purple-300 dark:border-purple-800"
                                  : "bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800"
                                : u.domain === "SEMI_FINISHED"
                                  ? "bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800"
                                  : "bg-sky-50 text-sky-800 border-sky-200 dark:bg-sky-950/60 dark:text-sky-300 dark:border-sky-800"
                            }`}
                          >
                            {u.tier_label}
                          </span>
                        </td>
                        <td className="py-2 pr-3 text-xs">
                          <div className="font-mono font-bold text-slate-800 dark:text-slate-200">
                            {u.bom_code}{" "}
                            <span className="text-[10px] font-normal text-slate-500">[{u.bom_status}]</span>
                          </div>
                          <div className="text-[11px] text-slate-600 dark:text-slate-400">{u.where_in_product}</div>
                        </td>
                        <td className="py-2 pr-3 font-mono whitespace-nowrap">
                          <div className="font-bold text-slate-900 dark:text-white">
                            {fmtQty(u.qty_per_product_unit)} {u.material_uom} / 1 {u.product_uom}
                          </div>
                          {u.scrap_factor > 0 && (
                            <div className="text-[10px] text-amber-700 dark:text-amber-400">
                              (Đã gồm +{Math.round(u.scrap_factor * 100)}% hao hụt)
                            </div>
                          )}
                        </td>
                        <td className="py-2 pr-3 whitespace-nowrap">
                          <span
                            className={`inline-flex items-center px-2.5 py-1 rounded-xl font-mono font-extrabold text-xs ${
                              u.max_producible_available > 0
                                ? "bg-emerald-100 dark:bg-emerald-950/70 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800"
                                : "bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300"
                            }`}
                          >
                            {fmtQty(u.max_producible_available)} {u.product_uom}
                          </span>
                          {u.extra_producible_from_semi_stock != null && u.extra_producible_from_semi_stock > 0 && (
                            <div className="text-[11px] font-semibold text-purple-700 dark:text-purple-300 mt-1">
                              + {fmtQty(u.extra_producible_from_semi_stock)} {u.product_uom} từ BTP {u.semi_code} sẵn kho ({fmtQty(u.semi_available_stock ?? 0)} ĐV)
                            </div>
                          )}
                        </td>
                        <td className="py-2 pr-3 font-mono font-bold whitespace-nowrap text-sky-800 dark:text-sky-300">
                          {fmtQty(u.max_producible_total)} {u.product_uom}
                        </td>
                        <td className="py-2 pr-3 whitespace-nowrap">
                          <div className="flex items-center gap-1.5">
                            <input
                              type="number"
                              min="0"
                              step="any"
                              placeholder={`SL (${u.product_uom})`}
                              value={plannedAllocations[u.usage_key] ?? ""}
                              onChange={(e) =>
                                setPlannedAllocations((prev) => ({
                                  ...prev,
                                  [u.usage_key]: e.target.value,
                                }))
                              }
                              className={`${inputClass} !w-24 font-mono text-xs`}
                            />
                            {simConsume > 0 && (
                              <span className="text-[11px] font-mono font-semibold text-indigo-700 dark:text-indigo-300">
                                Cần {fmtQty(simConsume)} {u.material_uom}
                              </span>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </Table>
              )}
            </>
          ) : (
            <Empty>Không tìm thấy mã nguyên liệu nào khớp với từ khóa &quot;{searchInput}&quot;.</Empty>
          )}
        </div>
      )}
    </Card>
  );
}

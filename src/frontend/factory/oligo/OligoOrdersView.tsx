"use client";

import React, { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, fmtDate } from "../api";
import { printOrderCoa } from "../coa";
import { Button, Card, Empty, ErrorNote, Field, inputClass, StatusBadge, Table } from "../ui";
import {
  OligoOrderPanel,
} from "./OligoOrderPanel";
import { ORDER_STATUS } from "./shared";

interface Option {
  id: string;
  code: string;
  name: string;
  internal_orders: { id: string; code: string; kd_po_code: string; committed_date: string | null }[];
}

function NewOrder({ onCreated, onCancel }: { onCreated: (id: string) => void; onCancel: () => void }) {
  const qc = useQueryClient();
  const options = useQuery({
    queryKey: ["factory", "oligo-intake-options"],
    queryFn: () => api<Option[]>("/api/factory/oligo/intake-options"),
  });
  const [f, setF] = useState({
    org_unit_id: "",
    internal_order_id: "",
    customer_label: "",
    due_date: "",
    notes: "",
  });
  const unit =
    options.data?.find((o) => o.id === f.org_unit_id) ??
    (options.data?.length === 1 ? options.data[0] : undefined);
  const selectedIo = unit?.internal_orders.find((io) => io.id === f.internal_order_id);
  const ioCommittedDate = selectedIo?.committed_date ? selectedIo.committed_date.slice(0, 10) : "";
  const isDateDelayedFromIo = Boolean(f.due_date && ioCommittedDate && f.due_date > ioCommittedDate);

  const create = useMutation({
    mutationFn: async () => {
      return api<{ id: string }>("/api/factory/oligo/orders", {
        method: "POST",
        idempotent: true,
        json: {
          ...f,
          org_unit_id: unit?.id,
          internal_order_id: f.internal_order_id || null,
          due_date: f.due_date || null,
          notes: f.notes || null,
        },
      });
    },
    onSuccess: (o) => {
      qc.invalidateQueries({ queryKey: ["factory", "oligo-orders"] });
      qc.invalidateQueries({ queryKey: ["factory", "internal-orders"] });
      onCreated(o.id);
    },
  });

  if (options.data && !options.data.length)
    return (
      <Empty>
        Bạn chưa có quyền lập đơn ở phòng Oligo nào (cần phòng có phân hệ Oligo trong Cơ cấu tổ chức).
      </Empty>
    );
  return (
    <form
      className="flex flex-col gap-3 mb-4 p-4 rounded-xl bg-sky-50/60 dark:bg-slate-950/60 border-2 border-sky-300 dark:border-sky-800 shadow-xs"
      onSubmit={(e) => {
        e.preventDefault();
        if (isDateDelayedFromIo) {
          const ok = window.confirm(
            `⚠️ CẢNH BÁO NGÀY GIAO: Ngày giao bạn chọn (${fmtDate(
              f.due_date
            )}) trễ hơn Ngày cam kết SLA của Đơn nội bộ (${fmtDate(
              ioCommittedDate
            )}).\nBạn có chắc chắn muốn tiếp tục tạo đơn với ngày giao này không?`
          );
          if (!ok) return;
        }
        create.mutate();
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-sky-200 dark:border-slate-800">
        <div>
          <div className="text-xs font-extrabold text-sky-900 dark:text-sky-200 uppercase">
            ➕ Tạo Đơn Oligo Mới
          </div>
          <div className="text-[11px] text-slate-600 dark:text-slate-400">
            Sau khi bấm <b>&ldquo;Tạo đơn &amp; Mở khung nhập trình tự&rdquo;</b>, hệ thống sẽ mở ngay màn hình chi tiết đơn để bạn nhập/lưu danh sách trình tự.
          </div>
        </div>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Đóng
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5 items-end">
        {(options.data?.length ?? 0) > 1 && (
          <Field label="Phòng Oligo">
            <select
              className={inputClass}
              value={f.org_unit_id}
              onChange={(e) => setF({ ...f, org_unit_id: e.target.value, internal_order_id: "" })}
              required
            >
              <option value="">Chọn</option>
              {options.data?.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label="Liên kết Đơn nội bộ (Tự động tạo nếu để trống)">
          <select
            className={inputClass}
            value={f.internal_order_id}
            onChange={(e) => {
              const ioId = e.target.value;
              const ioObj = unit?.internal_orders.find((x) => x.id === ioId);
              setF({
                ...f,
                internal_order_id: ioId,
                due_date: f.due_date || (ioObj?.committed_date ? ioObj.committed_date.slice(0, 10) : ""),
              });
            }}
          >
            <option value="">⚡ Tự động sinh &amp; gắn Đơn nội bộ mới</option>
            {unit?.internal_orders.map((o) => (
              <option key={o.id} value={o.id}>
                {o.code} · PO {o.kd_po_code} (Giao: {fmtDate(o.committed_date)})
              </option>
            ))}
          </select>
        </Field>
        <Field label="Khách hàng / Yêu cầu">
          <input
            className={inputClass}
            placeholder="Tên khách hàng / Bộ Kit..."
            value={f.customer_label}
            onChange={(e) => setF({ ...f, customer_label: e.target.value })}
          />
        </Field>
        <Field label="Hạn giao" hint="Để trống: lấy ngày cam kết của đơn nội bộ">
          <input
            className={inputClass}
            type="date"
            value={f.due_date}
            onChange={(e) => setF({ ...f, due_date: e.target.value })}
          />
        </Field>
        <Field label="Ghi chú đơn hàng">
          <input
            className={inputClass}
            placeholder="Ghi chú tinh sạch, đóng gói, COA..."
            value={f.notes}
            onChange={(e) => setF({ ...f, notes: e.target.value })}
          />
        </Field>
      </div>

      {isDateDelayedFromIo && (
        <div className="px-3 py-2 rounded-lg bg-amber-50 dark:bg-amber-950/50 border border-amber-300 dark:border-amber-800 text-xs font-semibold text-amber-800 dark:text-amber-300">
          ⚠️ Cảnh báo: Hạn giao đang chọn ({fmtDate(f.due_date)}) trễ hơn ngày cam kết trên Đơn nội bộ {selectedIo?.code} ({fmtDate(ioCommittedDate)}).
        </div>
      )}
      <ErrorNote error={create.error ?? options.error} />

      <div className="flex items-center justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Hủy
        </Button>
        <Button type="submit" disabled={create.isPending}>
          {create.isPending ? "Đang tạo đơn…" : "✅ Tạo đơn & Mở khung nhập trình tự →"}
        </Button>
      </div>
    </form>
  );
}

function foldOrderSearch(raw: string | null | undefined): string {
  return String(raw ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase();
}

export function OligoOrdersView({
  canManage,
  canDeliver = false,
}: {
  canManage: boolean;
  canDeliver?: boolean;
}) {
  const [selected, setSelected] = useState<string | null>(() => {
    if (typeof window !== "undefined") {
      const pendingId = window.sessionStorage.getItem("factory_open_oligo_order_id");
      if (pendingId) {
        window.sessionStorage.removeItem("factory_open_oligo_order_id");
        return pendingId;
      }
    }
    return null;
  });
  const [showNewOrder, setShowNewOrder] = useState(false);
  const [status, setStatus] = useState("");
  const [onlyReady, setOnlyReady] = useState(false);
  const [searchQ, setSearchQ] = useState("");
  const [seqTypeFilter, setSeqTypeFilter] = useState<"" | "PRIMER_PROBE" | "AMPLICON">("");
  const [purificationFilter, setPurificationFilter] = useState("");
  const [pricingFilter, setPricingFilter] = useState("");
  const [dueFilter, setDueFilter] = useState<"" | "OVERDUE_TODAY" | "NEXT_7_DAYS" | "DELAYED_SLA" | "RESCHEDULED">("");

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.oligoOrderId) {
        setSelected(detail.oligoOrderId);
      }
    };
    window.addEventListener("factory-open-oligo-order", handler);
    return () => window.removeEventListener("factory-open-oligo-order", handler);
  }, []);

  const list = useQuery({
    queryKey: ["factory", "oligo-orders"],
    queryFn: () =>
      api<
        {
          id: string;
          code: string;
          customer_label: string | null;
          due_date: string | null;
          initial_due_date?: string | null;
          due_date_change_count: number;
          notes: string | null;
          status: string;
          internal_order_id?: string | null;
          internal_order_code?: string | null;
          kd_po_code: string | null;
          requested_date?: string | null;
          internal_order_notes?: string | null;
          sequence_count: number;
          primer_probe_count?: number;
          amplicon_count?: number;
          ready_count?: number;
          delivered_count?: number;
          pricing_type?: string;
          price_percentage?: number;
          vat_rate?: number;
          total_price?: number;
          sequence_search_text?: string | null;
          purifications?: string[];
          scales?: string[];
        }[]
      >("/api/factory/oligo/orders"),
  });

  const allOrders = list.data ?? [];
  const todayYmd = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
  const next7Ymd = new Date(Date.now() + (7 + 7 * 24) * 3600_000).toISOString().slice(0, 10);

  const statusCounts = React.useMemo(() => {
    const counts: Record<string, number> = {
      ALL: allOrders.length,
      PENDING: 0,
      IN_PROGRESS: 0,
      COMPLETED: 0,
      DELIVERED: 0,
      FAILED: 0,
      CANCELLED: 0,
      READY: 0,
      LATE: 0,
    };
    for (const o of allOrders) {
      counts[o.status] = (counts[o.status] ?? 0) + 1;
      if ((o.ready_count ?? 0) > 0) counts.READY += 1;
      const isLate =
        (o.due_date && o.requested_date && o.due_date.slice(0, 10) > o.requested_date.slice(0, 10)) ||
        (o.due_date && o.due_date.slice(0, 10) < todayYmd && !["DELIVERED", "CANCELLED"].includes(o.status));
      if (isLate) counts.LATE += 1;
    }
    return counts;
  }, [allOrders, todayYmd]);

  const readyOrderCount = statusCounts.READY;

  const rows = React.useMemo(() => {
    const needle = foldOrderSearch(searchQ.trim());
    return allOrders.filter((o) => {
      if (status && o.status !== status) return false;
      if (onlyReady && (o.ready_count ?? 0) <= 0) return false;
      if (seqTypeFilter === "PRIMER_PROBE" && (o.primer_probe_count ?? o.sequence_count) <= 0) return false;
      if (seqTypeFilter === "AMPLICON" && (o.amplicon_count ?? 0) <= 0) return false;
      if (purificationFilter && !(o.purifications ?? []).includes(purificationFilter)) return false;
      if (pricingFilter) {
        const pt = o.pricing_type || "auto";
        if (pt !== pricingFilter) return false;
      }
      if (dueFilter) {
        const dueYmd = o.due_date ? o.due_date.slice(0, 10) : "";
        const reqYmd = o.requested_date ? o.requested_date.slice(0, 10) : "";
        if (dueFilter === "OVERDUE_TODAY") {
          if (!dueYmd || dueYmd > todayYmd || ["DELIVERED", "CANCELLED"].includes(o.status)) return false;
        } else if (dueFilter === "NEXT_7_DAYS") {
          if (!dueYmd || dueYmd < todayYmd || dueYmd > next7Ymd) return false;
        } else if (dueFilter === "DELAYED_SLA") {
          if (!(dueYmd && reqYmd && dueYmd > reqYmd)) return false;
        } else if (dueFilter === "RESCHEDULED") {
          if (!(o.due_date_change_count > 0)) return false;
        }
      }
      if (!needle) return true;
      const hay = foldOrderSearch(
        `${o.code} ${o.internal_order_code ?? ""} ${o.kd_po_code ?? ""} ${o.customer_label ?? ""} ${o.notes ?? ""} ${o.internal_order_notes ?? ""} ${o.sequence_search_text ?? ""}`
      );
      return needle.split(/\s+/).every((tok) => hay.includes(tok));
    });
  }, [allOrders, status, onlyReady, seqTypeFilter, purificationFilter, pricingFilter, dueFilter, searchQ, todayYmd, next7Ymd]);

  const hasActiveFilters = Boolean(
    status || onlyReady || searchQ.trim() || seqTypeFilter || purificationFilter || pricingFilter || dueFilter
  );

  const jumpToInternalOrder = (internalOrderId?: string | null) => {
    if (!internalOrderId || typeof window === "undefined") return;
    window.sessionStorage.setItem("factory_open_internal_order_id", internalOrderId);
    window.dispatchEvent(
      new CustomEvent("factory-switch-tab", {
        detail: { tab: "factory-orders", internalOrderId },
      })
    );
  };

  const openOrderDetail = (orderId: string) => {
    setShowNewOrder(false);
    setSelected((prev) => (prev === orderId ? null : orderId));
  };

  const selectedInRows = Boolean(selected && rows.some((r) => r.id === selected));

  return (
    <div className="flex flex-col gap-3">
      {selected && !selectedInRows && (
        <OligoOrderPanel
          key={selected}
          id={selected}
          canDeliver={canDeliver}
          onClose={() => setSelected(null)}
        />
      )}
      <Card
        title="Đơn Oligo (Liên kết 2 chiều Đơn Nội Bộ · Xuất COA Đơn hàng & COA Amplicon)"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {canManage && (
              <Button
                onClick={() =>
                  setShowNewOrder((v) => {
                    const next = !v;
                    if (next) setSelected(null);
                    return next;
                  })
                }
              >
                {showNewOrder ? "Đóng form tạo đơn" : "+ Tạo đơn Oligo mới"}
              </Button>
            )}
            <button
              type="button"
              onClick={() => setOnlyReady(!onlyReady)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-colors cursor-pointer ${
                onlyReady
                  ? "bg-emerald-600 text-white border-emerald-600"
                  : "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800"
              }`}
            >
              Chờ in nhãn &amp; giao hàng ({readyOrderCount})
            </button>
          </div>
        }
      >
        {canManage && showNewOrder && (
          <NewOrder
            onCancel={() => setShowNewOrder(false)}
            onCreated={(id) => {
              setShowNewOrder(false);
              setSelected(id);
            }}
          />
        )}

        {/* Thanh Bộ lọc trạng thái & Tìm kiếm nhanh Đơn Oligo */}
        <div className="flex flex-col gap-2.5 mb-3 p-2.5 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 mr-1">Trạng thái đơn:</span>
            <button
              type="button"
              onClick={() => {
                setStatus("");
                setOnlyReady(false);
              }}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition-colors cursor-pointer ${
                status === "" && !onlyReady
                  ? "bg-slate-800 text-white border-slate-800 dark:bg-slate-100 dark:text-slate-900"
                  : "bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-100"
              }`}
            >
              Tất cả ({statusCounts.ALL})
            </button>
            {Object.entries(ORDER_STATUS).map(([k, [, label]]) => (
              <button
                key={k}
                type="button"
                onClick={() => {
                  setStatus(status === k ? "" : k);
                  setOnlyReady(false);
                }}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition-colors cursor-pointer ${
                  status === k
                    ? "bg-sky-700 text-white border-sky-700"
                    : "bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-100"
                }`}
              >
                {label} ({statusCounts[k] ?? 0})
              </button>
            ))}
          </div>

          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-12 items-center">
            <div className="sm:col-span-2 lg:col-span-5 relative">
              <input
                className={`${inputClass} pr-8`}
                placeholder="🔍 Tìm mã đơn, khách hàng, Đơn nội bộ/PO, tên mồi/probe, chuỗi 5'-3', ghi chú..."
                value={searchQ}
                onChange={(e) => setSearchQ(e.target.value)}
              />
              {searchQ && (
                <button
                  type="button"
                  onClick={() => setSearchQ("")}
                  title="Xóa từ khóa tìm kiếm"
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 text-xs font-bold cursor-pointer"
                >
                  ✕
                </button>
              )}
            </div>

            <div className="lg:col-span-2">
              <select
                className={inputClass}
                value={seqTypeFilter}
                onChange={(e) => setSeqTypeFilter(e.target.value as typeof seqTypeFilter)}
                aria-label="Lọc loại trình tự"
              >
                <option value="">Mọi loại chuỗi (PP / Amplicon)</option>
                <option value="PRIMER_PROBE">🧪 Có Primer / Probe</option>
                <option value="AMPLICON">🧬 Có Amplicon</option>
              </select>
            </div>

            <div className="lg:col-span-2">
              <select
                className={inputClass}
                value={purificationFilter}
                onChange={(e) => setPurificationFilter(e.target.value)}
                aria-label="Lọc phương pháp tinh sạch"
              >
                <option value="">Mọi tinh sạch (OPC/HPLC...)</option>
                <option value="OPC">Tinh sạch OPC</option>
                <option value="HPLC">Tinh sạch HPLC</option>
                <option value="PAGE">Tinh sạch PAGE</option>
                <option value="DESALT">Khử muối (DESALT)</option>
              </select>
            </div>

            <div className="lg:col-span-3 flex items-center gap-1.5">
              <select
                className={inputClass}
                value={dueFilter}
                onChange={(e) => setDueFilter(e.target.value as typeof dueFilter)}
                aria-label="Lọc hạn giao hàng"
              >
                <option value="">Mọi hạn giao hàng</option>
                <option value="OVERDUE_TODAY">🚨 Quá hạn / Giao hôm nay</option>
                <option value="NEXT_7_DAYS">📅 Giao trong 7 ngày tới</option>
                <option value="DELAYED_SLA">⚠️ Trễ hơn ngày KD yêu cầu</option>
                <option value="RESCHEDULED">🔄 Đã từng dời lịch giao</option>
              </select>
              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={() => {
                    setStatus("");
                    setOnlyReady(false);
                    setSearchQ("");
                    setSeqTypeFilter("");
                    setPurificationFilter("");
                    setPricingFilter("");
                    setDueFilter("");
                  }}
                  className="text-xs font-bold text-rose-600 hover:underline cursor-pointer whitespace-nowrap px-1"
                  title="Xóa toàn bộ bộ lọc"
                >
                  Đặt lại
                </button>
              )}
            </div>
          </div>
        </div>

        <ErrorNote error={list.error} />
        {rows.length === 0 && (
          <Empty>
            {onlyReady
              ? "Không có đơn nào đang có trình tự đạt QC chờ in nhãn / giao hàng."
              : hasActiveFilters
                ? "Không có đơn Oligo nào khớp từ khóa hoặc bộ lọc đang chọn."
                : "Chưa có đơn Oligo."}
          </Empty>
        )}
        {rows.length > 0 && (
          <Table
            head={[
              "Mã Đơn Oligo",
              "Đơn Nội Bộ & PO KD",
              "Khách / Yêu cầu",
              "Ghi chú đơn hàng",
              "Số trình tự (PP / Amplicon)",
              "Hạn giao & Cảnh báo",
              "Trạng thái",
              "Thao tác & Xuất COA",
            ]}
          >
            {rows.map((o) => {
              const displayNote = o.notes || o.internal_order_notes;
              const ppCount = o.primer_probe_count ?? o.sequence_count;
              const ampCount = o.amplicon_count ?? 0;
              const isLate =
                o.due_date &&
                o.requested_date &&
                o.due_date.slice(0, 10) > o.requested_date.slice(0, 10);
              const isSelectedRow = selected === o.id;

              return (
                <React.Fragment key={o.id}>
                  <tr
                    className={`cursor-pointer transition-colors ${
                      isSelectedRow
                        ? "bg-purple-50/90 dark:bg-purple-950/35 ring-1 ring-inset ring-purple-300 dark:ring-purple-700"
                        : "hover:bg-slate-50 dark:hover:bg-slate-800/50"
                    }`}
                    onClick={() => openOrderDetail(o.id)}
                  >
                    <td className="py-2 pr-3 font-mono font-bold text-sky-700 dark:text-sky-400 whitespace-nowrap">
                      <div>{o.code}</div>
                      {isSelectedRow && (
                        <span className="inline-block mt-0.5 px-1.5 py-0.5 rounded bg-purple-600 text-white font-sans text-[10px] font-bold">
                          Đang mở bên dưới ▼
                        </span>
                      )}
                    </td>
                    <td
                      className="py-2 pr-3 whitespace-nowrap"
                      onClick={(e) => {
                        if (o.internal_order_id) {
                          e.stopPropagation();
                          jumpToInternalOrder(o.internal_order_id);
                        }
                      }}
                    >
                      {o.internal_order_code || o.kd_po_code ? (
                        <div className="flex flex-col gap-0.5">
                          {o.internal_order_code && (
                            <span
                              title="Nhấp để mở Đơn Nội Bộ liên kết"
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200 dark:border-indigo-800 font-mono text-[11px] font-bold text-indigo-700 dark:text-indigo-300 hover:underline w-fit"
                            >
                              🔗 {o.internal_order_code} ↗
                            </span>
                          )}
                          {o.kd_po_code && (
                            <span className="font-mono text-[11px] text-slate-600 dark:text-slate-400">
                              PO: <b>{o.kd_po_code}</b>
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="py-2 pr-3 max-w-52">
                      <div className="font-semibold text-slate-900 dark:text-white line-clamp-2">
                        {o.customer_label ?? "—"}
                      </div>
                    </td>
                    <td className="py-2 pr-3 max-w-64">
                      {displayNote ? (
                        <div
                          title={displayNote}
                          className="px-2 py-1 rounded-lg bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200/70 dark:border-amber-800/60 text-[11px] text-slate-700 dark:text-slate-200 line-clamp-2"
                        >
                          📝 {displayNote}
                        </div>
                      ) : (
                        <span className="text-slate-400 italic text-[11px]">Chưa có ghi chú</span>
                      )}
                    </td>
                    <td className="py-2 pr-3 whitespace-nowrap text-xs">
                      <div className="font-bold text-slate-900 dark:text-white">
                        Tổng: {o.sequence_count} chuỗi
                      </div>
                      <div className="text-[11px] text-slate-500">
                        🧪 {ppCount} Primer/Probe · 🧬 {ampCount} Amplicon
                      </div>
                      <div className="text-[10px] text-emerald-600 dark:text-emerald-400 font-semibold">
                        Đã giao: {o.delivered_count ?? 0}/{o.sequence_count}
                      </div>
                    </td>
                    <td className="py-2 pr-3 whitespace-nowrap">
                      <div className="font-semibold">{fmtDate(o.due_date)}</div>
                      {o.due_date_change_count > 0 && (
                        <span
                          title={`Đơn hàng này đã bị thay đổi ngày giao ${o.due_date_change_count} lần (Ngày giao ban đầu: ${fmtDate(
                            o.initial_due_date ?? null
                          )})`}
                          className="inline-block mt-0.5 px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-950/80 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-700 text-[10px] font-bold"
                        >
                          ⚠️ Đã dời lịch {o.due_date_change_count} lần
                        </span>
                      )}
                      {isLate && (
                        <div className="text-[10px] font-bold text-rose-600 dark:text-rose-400 mt-0.5">
                          🚨 Trễ hơn KD yêu cầu ({fmtDate(o.requested_date ?? null)})
                        </div>
                      )}
                    </td>
                    <td className="py-2 pr-3 whitespace-nowrap">
                      <StatusBadge
                        status={ORDER_STATUS[o.status][0]}
                        label={ORDER_STATUS[o.status][1]}
                      />
                    </td>
                    <td
                      className="py-2 pr-3 whitespace-nowrap"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="inline-flex flex-wrap items-center gap-1">
                        <button
                          type="button"
                          onClick={() => openOrderDetail(o.id)}
                          className={`px-2.5 py-1 rounded-lg font-bold text-[11px] cursor-pointer shadow-2xs ${
                            isSelectedRow
                              ? "bg-slate-700 hover:bg-slate-800 text-white"
                              : "bg-emerald-600 hover:bg-emerald-700 text-white"
                          }`}
                          title="Mở chi tiết đơn hàng này ngay tại dòng để nhập hoặc sửa danh sách trình tự"
                        >
                          {isSelectedRow
                            ? "Đóng chi tiết ▲"
                            : o.sequence_count === 0
                              ? "🧬 Nhập trình tự"
                              : "✏️ Xem / Sửa trình tự"}
                        </button>
                        {o.sequence_count > 0 && (
                          <button
                            type="button"
                            onClick={() =>
                              printOrderCoa(o.id, "PRIMER_PROBE_ONLY").catch((err) =>
                                window.alert(err.message)
                              )
                            }
                            title="Xuất COA Đơn hàng (chỉ gồm các trình tự Primer & Probe)"
                            className="px-2 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-[11px] cursor-pointer"
                          >
                            📜 COA Đơn hàng
                          </button>
                        )}
                        {ampCount > 0 && (
                          <button
                            type="button"
                            onClick={() =>
                              printOrderCoa(o.id, "AMPLICONS_ONLY").catch((err) =>
                                window.alert(err.message)
                              )
                            }
                            title="Xuất COA cho trình tự Amplicon"
                            className="px-2 py-1 rounded-lg border border-purple-300 dark:border-purple-800 bg-purple-50 dark:bg-purple-950/50 hover:bg-purple-100 text-purple-800 dark:text-purple-300 font-bold text-[11px] cursor-pointer"
                          >
                            🧬 COA Amplicon ({ampCount})
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                  {isSelectedRow && (
                    <tr>
                      <td colSpan={8} className="py-2.5 pr-3">
                        <OligoOrderPanel
                          key={o.id}
                          id={o.id}
                          canDeliver={canDeliver}
                          onClose={() => setSelected(null)}
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

"use client";

import React, { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, fmtDate } from "../api";
import { printOrderCoa } from "../coa";
import { Button, Card, Empty, ErrorNote, Field, inputClass, StatusBadge, Table } from "../ui";
import {
  downloadOligoSequenceExcelTemplate,
  OligoOrderPanel,
  parseOligoSequenceExcelFile,
} from "./OligoOrderPanel";
import { ORDER_STATUS } from "./shared";

interface Option {
  id: string;
  code: string;
  name: string;
  internal_orders: { id: string; code: string; kd_po_code: string; committed_date: string | null }[];
}

function NewOrder({ onCreated }: { onCreated: (id: string) => void }) {
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
  const [seqText, setSeqText] = useState("");
  const [excelNotice, setExcelNotice] = useState<string | null>(null);
  const unit =
    options.data?.find((o) => o.id === f.org_unit_id) ??
    (options.data?.length === 1 ? options.data[0] : undefined);
  const selectedIo = unit?.internal_orders.find((io) => io.id === f.internal_order_id);
  const ioCommittedDate = selectedIo?.committed_date ? selectedIo.committed_date.slice(0, 10) : "";
  const isDateDelayedFromIo = Boolean(f.due_date && ioCommittedDate && f.due_date > ioCommittedDate);

  const create = useMutation({
    mutationFn: async () => {
      const o = await api<{ id: string }>("/api/factory/oligo/orders", {
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
      if (seqText.trim()) {
        await api(`/api/factory/oligo/orders/${o.id}/sequences`, {
          method: "POST",
          idempotent: true,
          json: {
            text: seqText.trim(),
            defaults: { scale_code: "200NMOL", purification: "OPC", format: "LYOPHILIZED" },
          },
        });
      }
      return o;
    },
    onSuccess: (o) => {
      qc.invalidateQueries({ queryKey: ["factory", "oligo-orders"] });
      qc.invalidateQueries({ queryKey: ["factory", "internal-orders"] });
      onCreated(o.id);
    },
  });

  const handleExcelUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const parsed = await parseOligoSequenceExcelFile(file, {
        scale_code: "200NMOL",
        purification: "OPC",
        format: "LYOPHILIZED",
      });
      if (parsed.rows.length === 0) {
        window.alert("Không tìm thấy trình tự hợp lệ nào trong file Excel.");
        return;
      }
      setSeqText((prev) => (prev.trim() ? `${prev.trim()}\n${parsed.text}` : parsed.text));
      setExcelNotice(`✅ Đã đọc ${parsed.rows.length} trình tự từ file "${file.name}"`);
    } catch (err: any) {
      window.alert(`Lỗi đọc file Excel: ${err?.message || "Định dạng không hợp lệ"}`);
    }
  };

  if (options.data && !options.data.length)
    return (
      <Empty>
        Bạn chưa có quyền lập đơn ở phòng Oligo nào (cần phòng có phân hệ Oligo trong Cơ cấu tổ chức).
      </Empty>
    );
  return (
    <form
      className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6 items-end mb-4 p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950/50 border border-slate-200 dark:border-slate-800"
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
      <Button type="submit" disabled={create.isPending}>
        {create.isPending ? "Đang tạo đơn…" : "+ Tạo đơn Oligo"}
      </Button>

      <div className="sm:col-span-2 lg:col-span-6 p-3 rounded-xl bg-purple-50/60 dark:bg-purple-950/20 border border-purple-200 dark:border-purple-800/70 flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs font-bold text-purple-950 dark:text-purple-200">
            🧬 Nhập trình tự ngay khi tạo đơn (Tùy chọn — có thể tải mẫu Excel &amp; nhập từ file Excel):
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => downloadOligoSequenceExcelTemplate()}
              className="px-2.5 py-1 rounded-lg border border-emerald-400 dark:border-emerald-700 bg-white dark:bg-slate-900 hover:bg-emerald-50 text-emerald-800 dark:text-emerald-300 font-bold text-xs cursor-pointer"
            >
              📥 Tải file Excel mẫu (.xlsx)
            </button>
            <label className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs cursor-pointer inline-flex items-center gap-1">
              <span>📤 Nhập trình tự từ file Excel (.xlsx / .csv)</span>
              <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleExcelUpload} />
            </label>
          </div>
        </div>
        {excelNotice && (
          <div className="text-xs font-semibold text-emerald-700 dark:text-emerald-300">{excelNotice}</div>
        )}
        <textarea
          rows={3}
          className={`${inputClass} font-mono text-xs`}
          value={seqText}
          onChange={(e) => setSeqText(e.target.value)}
          placeholder={
            "Mỗi dòng: Tên; Trình tự 5'-3'; Thang; Tinh sạch; Định dạng\nVD: HBV-F2; GAGTGTGGATTCGCACTCCT; 200NMOL; OPC; LYOPHILIZED"
          }
          spellCheck={false}
        />
      </div>

      {isDateDelayedFromIo && (
        <div className="sm:col-span-2 lg:col-span-6 px-3 py-2 rounded-lg bg-amber-50 dark:bg-amber-950/50 border border-amber-300 dark:border-amber-800 text-xs font-semibold text-amber-800 dark:text-amber-300">
          ⚠️ Cảnh báo: Hạn giao đang chọn ({fmtDate(f.due_date)}) trễ hơn ngày cam kết trên Đơn nội bộ {selectedIo?.code} ({fmtDate(ioCommittedDate)}).
        </div>
      )}
      <div className="sm:col-span-2 lg:col-span-6">
        <ErrorNote error={create.error ?? options.error} />
      </div>
    </form>
  );
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
    queryKey: ["factory", "oligo-orders", status],
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
        }[]
      >(`/api/factory/oligo/orders${status ? `?status=${status}` : ""}`),
  });
  const rows = (list.data ?? []).filter((o) => !onlyReady || (o.ready_count ?? 0) > 0);
  const readyOrderCount = (list.data ?? []).filter((o) => (o.ready_count ?? 0) > 0).length;

  const jumpToInternalOrder = (internalOrderId?: string | null) => {
    if (!internalOrderId || typeof window === "undefined") return;
    window.sessionStorage.setItem("factory_open_internal_order_id", internalOrderId);
    window.dispatchEvent(
      new CustomEvent("factory-switch-tab", {
        detail: { tab: "factory-orders", internalOrderId },
      })
    );
  };

  return (
    <div className="flex flex-col gap-3">
      {selected && (
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
              <Button onClick={() => setShowNewOrder((v) => !v)}>
                {showNewOrder ? "Đóng form tạo đơn" : "+ Tạo đơn Oligo"}
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
            <select
              className={`${inputClass} w-44`}
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              aria-label="Trạng thái"
            >
              <option value="">Mọi trạng thái</option>
              {Object.entries(ORDER_STATUS).map(([k, [, v]]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </div>
        }
      >
        {canManage && showNewOrder && (
          <NewOrder
            onCreated={(id) => {
              setShowNewOrder(false);
              setSelected(id);
            }}
          />
        )}
        <ErrorNote error={list.error} />
        {rows.length === 0 && (
          <Empty>
            {onlyReady
              ? "Không có đơn nào đang có trình tự đạt QC chờ in nhãn / giao hàng."
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
              "Thành tiền (VNĐ)",
              "Hạn giao & Cảnh báo",
              "Trạng thái",
              "Xuất COA Đơn Hàng",
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

              return (
                <tr
                  key={o.id}
                  className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50"
                  onClick={() => setSelected(o.id)}
                >
                  <td className="py-2 pr-3 font-mono font-bold text-sky-700 dark:text-sky-400 whitespace-nowrap">
                    {o.code}
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
                  <td className="py-2 pr-3 whitespace-nowrap text-right">
                    <div className="font-mono font-bold text-emerald-700 dark:text-emerald-400 text-xs">
                      {Number(o.total_price ?? 0).toLocaleString("vi-VN")} đ
                    </div>
                    <div className="text-[10px] text-slate-500">
                      {o.pricing_type === "percentage"
                        ? `Dealer ${o.price_percentage ?? 100}%`
                        : o.pricing_type === "custom"
                        ? "Giá tự do"
                        : o.pricing_type === "demo"
                        ? "Demo 0đ"
                        : "Giá End 100%"}
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
                    <div className="inline-flex items-center gap-1">
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
              );
            })}
          </Table>
        )}
      </Card>
    </div>
  );
}

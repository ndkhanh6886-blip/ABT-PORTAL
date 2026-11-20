"use client";

import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ActionBar, type AllowedAction } from "../actions";
import { api, fmtDate, fmtDateTime, fmtQty, useFactoryMe, vnToday } from "../api";
import { Button, Card, Empty, ErrorNote, inputClass, StatusBadge, Table } from "../ui";

const PO_STATUS: Record<string, [string, string]> = {
  DRAFT: ["PENDING_QC", "Nháp"],
  ISSUED: ["QUARANTINE", "Đã phát hành"],
  PARTIALLY_RECEIVED: ["ON_HOLD", "Nhận một phần"],
  RECEIVED: ["RELEASED", "Đã nhận đủ"],
  CLOSED: ["EXPIRED", "Đã đóng"],
  CANCELLED: ["EXPIRED", "Đã hủy"],
};
const ACTION_LABEL = { issue: "Phát hành đơn", cancel: "Hủy đơn", close: "Đóng đơn", short_close: "Đóng đơn (thiếu hàng)" };

const DOC_TYPE_LABELS: Record<string, string> = {
  RECEIPT: "📥 Nhập kho (NK)",
  TRANSFER: "🔄 Điều chuyển / Cấp phát",
  ISSUE: "⚙️ Xuất kho sử dụng (XK)",
  RETURN: "↩️ Nhập hoàn kho",
  ADJUSTMENT: "⚖️ Điều chỉnh tồn",
  COUNT_ADJUST: "📋 Kiểm kê",
};

const REASON_LABELS: Record<string, string> = {
  PURCHASE: "Nhập mua từ Nhà cung cấp",
  PUTAWAY: "Đưa từ Biệt trữ lên Kệ chính (Sau giải phóng IQC)",
  RELOCATE: "Chuyển vị trí kệ trong kho",
  DEPT_SUPPLY: "Cấp phát từ Kho Tổng sang Kho Phòng",
  INTER_WAREHOUSE: "Điều chuyển liên kho",
  REPLENISHMENT: "Bổ sung định mức kho nhánh",
  PRODUCTION: "Xuất vào Lệnh sản xuất / Lắp ráp",
  RND: "Xuất nghiên cứu R&D",
  QC_SAMPLE: "Xuất lấy mẫu kiểm định QC",
  SCRAP: "Xuất hủy",
  RETURN_TO_SUPPLIER: "Xuất trả Nhà cung cấp",
};

interface PoLine {
  id: string;
  line_no: number;
  item_code: string;
  item_name: string;
  tracking: string;
  uom: string;
  qty_ordered: string;
  qty_received: string;
  unit_price: string;
  vat_rate: string;
  warehouse_code: string;
  warehouse_name?: string;
  pr_code: string;
}

interface PoReceiptLine {
  id: string;
  gr_code: string;
  received_at: string;
  delivery_note_no: string | null;
  received_by_name: string | null;
  stock_doc_id: string | null;
  stock_doc_code: string | null;
  warehouse_code: string | null;
  warehouse_name: string | null;
  intake_location_code: string | null;
  intake_location_name: string | null;
  intake_is_quarantine: boolean | null;
  item_code: string;
  item_name: string;
  qty: number;
  uom: string;
  lot_id: string | null;
  lot_code: string | null;
  lot_status: string | null;
  mfr_lot_no: string | null;
  mfg_date: string | null;
  expiry_date: string | null;
}

interface PoLotBalance {
  lot_id: string;
  lot_code: string;
  lot_status: string;
  item_code: string;
  item_name: string;
  uom: string;
  warehouse_code: string;
  warehouse_name: string;
  location_code: string;
  location_name: string;
  is_quarantine: boolean;
  qty_on_hand: number;
  qty_reserved: number;
  available: number;
}

interface PoLotMovement {
  line_id: string;
  line_no: number;
  document_id: string;
  document_code: string;
  doc_type: string;
  reason_code: string;
  notes: string | null;
  occurred_at: string;
  doc_warehouse_code: string;
  performed_by_name: string | null;
  item_code: string;
  item_name: string;
  lot_code: string | null;
  lot_status: string | null;
  from_wh_code: string | null;
  from_loc_code: string | null;
  to_wh_code: string | null;
  to_loc_code: string | null;
  qty: number;
  uom: string;
}

interface PoDetail {
  id: string;
  code: string;
  status: string;
  version: number;
  supplier_code: string;
  supplier_name: string;
  order_date: string;
  expected_date: string | null;
  total_amount: string;
  payment_terms: string | null;
  lines: PoLine[];
  receipts: {
    id: string;
    code: string;
    received_at: string;
    delivery_note_no: string | null;
    received_by_name: string | null;
    stock_doc_codes?: string[];
  }[];
  receipt_lines?: PoReceiptLine[];
  current_balances?: PoLotBalance[];
  lot_movements?: PoLotMovement[];
  actions: AllowedAction[];
}

interface PoListRow {
  id: string;
  code: string;
  status: string;
  order_date: string;
  expected_date: string | null;
  total_amount: string;
  supplier_name: string;
  line_count: number;
  warehouse_codes?: string[];
  items_summary?: {
    item_code: string;
    item_name: string;
    qty_ordered: number;
    qty_received: number;
    uom: string;
    warehouse_code: string;
    pr_code: string;
  }[];
  receipt_docs?: {
    gr_code: string;
    stock_doc_code: string | null;
    warehouse_code: string | null;
    location_code: string | null;
    lot_id: string | null;
    lot_code: string | null;
    lot_status: string | null;
    qty: number;
    uom: string;
    received_at: string;
  }[];
  downstream_moves?: {
    doc_code: string;
    doc_type: string;
    reason_code: string;
    from_wh_code: string | null;
    from_loc_code: string | null;
    to_wh_code: string | null;
    to_loc_code: string | null;
    qty: number;
    uom: string;
    occurred_at: string;
  }[];
  current_stock_places?: {
    warehouse_code: string;
    location_code: string;
    is_quarantine: boolean;
    lot_code: string;
    lot_status: string;
    qty_on_hand: number;
    qty_reserved: number;
    uom: string;
  }[];
}

interface RecvLine {
  qty: string;
  mfr_lot_no: string;
  mfg_date: string;
  expiry_date: string;
  serials: string;
}

function ReceiveForm({ po, onDone }: { po: PoDetail; onDone: () => void }) {
  const [rows, setRows] = useState<Record<string, RecvLine>>({});
  const [noteNo, setNoteNo] = useState("");
  const recv = useMutation({
    mutationFn: () =>
      api<{ code: string; lots: { code: string; qc_required: boolean }[] }>("/api/factory/purchase/receipts", {
        method: "POST",
        idempotent: true,
        json: {
          po_id: po.id,
          delivery_note_no: noteNo || null,
          lines: Object.entries(rows)
            .filter(([, r]) => r.qty)
            .map(([po_line_id, r]) => ({
              po_line_id,
              qty: Number(r.qty.replace(",", ".")),
              mfr_lot_no: r.mfr_lot_no || null,
              mfg_date: r.mfg_date || null,
              expiry_date: r.expiry_date || null,
              serials: r.serials ? r.serials.split(/[\s,;]+/).filter(Boolean) : undefined,
            })),
        },
      }),
    onSuccess: () => {
      setRows({});
      onDone();
    },
  });
  const set = (id: string, p: Partial<RecvLine>) =>
    setRows({ ...rows, [id]: { ...{ qty: "", mfr_lot_no: "", mfg_date: "", expiry_date: "", serials: "" }, ...rows[id], ...p } });
  const open = po.lines.filter((l) => Number(l.qty_received) < Number(l.qty_ordered));
  const fillAllQuick = () => {
    const today = vnToday();
    const next: Record<string, RecvLine> = {};
    for (const l of open) {
      const rem = Math.max(0, Number(l.qty_ordered) - Number(l.qty_received));
      const existing = rows[l.id];
      next[l.id] = {
        qty: String(rem),
        mfr_lot_no: existing?.mfr_lot_no ?? "",
        mfg_date: existing?.mfg_date || today,
        expiry_date: existing?.expiry_date ?? "",
        serials: existing?.serials ?? "",
      };
    }
    setRows(next);
  };

  return (
    <form
      className="flex flex-col gap-2 p-3 rounded-xl border border-sky-200 dark:border-sky-900 bg-sky-50/60 dark:bg-sky-950/30"
      onSubmit={(e) => {
        e.preventDefault();
        recv.mutate();
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs font-bold">
          Nhận hàng vào kho (vị trí biệt trữ BT). Lô mới ở trạng thái Biệt trữ (QUARANTINE), tự động đẩy sang Hàng đợi Một Cửa của QA/QC.
        </div>
        <Button
          type="button"
          variant="ghost"
          title="Điền nhanh số lượng còn chờ nhận từ PO; vui lòng đối chiếu và nhập Số Lô / Serial thực tế trên bao bì của Nhà cung cấp"
          onClick={fillAllQuick}
        >
          ⚡ Điền nhanh SL còn chờ nhận
        </Button>
      </div>
      <input
        className={`${inputClass} sm:w-72`}
        placeholder="Số phiếu giao hàng của NCC"
        value={noteNo}
        onChange={(e) => setNoteNo(e.target.value)}
      />
      <Table head={["Vật tư", "Kho nhận", "Còn chờ", "SL nhận", "Lô NSX", "Ngày SX", "Hạn dùng", "Serial (cách nhau dấu phẩy)"]}>
        {open.map((l) => {
          const r = rows[l.id];
          return (
            <tr key={l.id}>
              <td className="py-2 pr-3">
                {l.item_code} — {l.item_name}
              </td>
              <td className="py-2 pr-3 font-mono font-bold text-sky-700 dark:text-sky-400">{l.warehouse_code}</td>
              <td className="py-2 pr-3 whitespace-nowrap">
                {fmtQty(Number(l.qty_ordered) - Number(l.qty_received))} {l.uom}
              </td>
              <td className="py-2 pr-3 w-24">
                <input className={inputClass} inputMode="decimal" value={r?.qty ?? ""} onChange={(e) => set(l.id, { qty: e.target.value })} />
              </td>
              <td className="py-2 pr-3 w-32">
                <input
                  className={inputClass}
                  disabled={l.tracking !== "LOT"}
                  value={r?.mfr_lot_no ?? ""}
                  onChange={(e) => set(l.id, { mfr_lot_no: e.target.value })}
                />
              </td>
              <td className="py-2 pr-3 w-36">
                <input
                  className={inputClass}
                  type="date"
                  value={r?.mfg_date ?? ""}
                  onChange={(e) => set(l.id, { mfg_date: e.target.value })}
                />
              </td>
              <td className="py-2 pr-3 w-36">
                <input
                  className={inputClass}
                  type="date"
                  value={r?.expiry_date ?? ""}
                  onChange={(e) => set(l.id, { expiry_date: e.target.value })}
                />
              </td>
              <td className="py-2 pr-3 min-w-40">
                <input
                  className={inputClass}
                  disabled={l.tracking !== "SERIAL"}
                  value={r?.serials ?? ""}
                  onChange={(e) => set(l.id, { serials: e.target.value })}
                />
              </td>
            </tr>
          );
        })}
      </Table>
      <ErrorNote error={recv.error} />
      {recv.data && (
        <p className="text-xs text-emerald-700 dark:text-emerald-400">
          Đã nhận {recv.data.code}: lô {recv.data.lots.map((l) => l.code).join(", ")}.
        </p>
      )}
      <div>
        <Button type="submit" disabled={recv.isPending || !Object.values(rows).some((r) => r.qty)}>
          {recv.isPending ? "Đang ghi…" : "Ghi nhận hàng"}
        </Button>
      </div>
    </form>
  );
}

export function OrderDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();
  const me = useFactoryMe();
  const [receiving, setReceiving] = useState(false);
  const po = useQuery({ queryKey: ["factory", "po", id], queryFn: () => api<PoDetail>(`/api/factory/purchase/orders/${id}`) });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["factory", "po", id] });
    qc.invalidateQueries({ queryKey: ["factory", "pos"] });
    qc.invalidateQueries({ queryKey: ["factory", "stock"] });
  };
  const p = po.data;
  const canReceive = me.data?.permissions.includes("purchase.receipt.post") && p && ["ISSUED", "PARTIALLY_RECEIVED"].includes(p.status);
  const receiptLines = p?.receipt_lines ?? [];
  const currentBalances = p?.current_balances ?? [];
  const lotMovements = p?.lot_movements ?? [];

  return (
    <Card title={p ? `Chi tiết Đơn mua ${p.code} — ${p.supplier_name}` : "Đơn mua"} actions={<Button variant="ghost" onClick={onClose}>Đóng</Button>}>
      <ErrorNote error={po.error} />
      {p && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600 dark:text-slate-300">
            <div>
              <StatusBadge status={PO_STATUS[p.status][0]} label={PO_STATUS[p.status][1]} /> · Ngày đặt <b>{fmtDate(p.order_date)}</b> · Giao dự kiến{" "}
              <b>{fmtDate(p.expected_date)}</b> · Tổng <b>{fmtQty(p.total_amount)} đ</b> (gồm VAT)
              {p.payment_terms && <> · {p.payment_terms}</>}
            </div>
          </div>

          {/* 1. Danh mục vật tư đặt mua & Kho nhận */}
          <div>
            <div className="text-xs font-extrabold text-slate-800 dark:text-slate-100 mb-1.5">
              1. Danh mục Vật tư Đặt mua &amp; Kho Nhận Đích
            </div>
            <Table head={["#", "Vật tư", "Đề nghị (PR)", "Kho nhận đích", "SL Đặt", "SL Đã nhận", "Đơn giá", "VAT"]}>
              {p.lines.map((l) => (
                <tr key={l.id}>
                  <td className="py-2 pr-3">{l.line_no}</td>
                  <td className="py-2 pr-3">
                    <span className="font-mono font-bold">{l.item_code}</span> — {l.item_name}
                  </td>
                  <td className="py-2 pr-3 font-mono font-semibold text-indigo-700 dark:text-indigo-300">{l.pr_code}</td>
                  <td className="py-2 pr-3">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-sky-100 dark:bg-sky-950/60 text-sky-800 dark:text-sky-300 font-mono font-bold text-[11px]">
                      🏢 {l.warehouse_code}
                    </span>
                    {l.warehouse_name && <span className="ml-1 text-[11px] text-slate-500">({l.warehouse_name})</span>}
                  </td>
                  <td className="py-2 pr-3 whitespace-nowrap">
                    {fmtQty(l.qty_ordered)} {l.uom}
                  </td>
                  <td className="py-2 pr-3 font-bold text-emerald-700 dark:text-emerald-400">
                    {fmtQty(l.qty_received)} {l.uom}
                  </td>
                  <td className="py-2 pr-3 text-right">{fmtQty(l.unit_price)} đ</td>
                  <td className="py-2 pr-3">{Number(l.vat_rate)}%</td>
                </tr>
              ))}
            </Table>
          </div>

          <ActionBar endpoint={`/api/factory/purchase/orders/${p.id}/actions`} version={p.version} actions={p.actions} labels={ACTION_LABEL} onDone={refresh} />
          {canReceive &&
            (receiving ? (
              <ReceiveForm
                po={p}
                onDone={() => {
                  setReceiving(false);
                  refresh();
                }}
              />
            ) : (
              <div>
                <Button onClick={() => setReceiving(true)}>📥 Nhận hàng vào kho</Button>
              </div>
            ))}

          {/* 2. Chi tiết Phiếu Nhập Kho, Mã Lô & Vị trí Tồn Kho Hiện Tại */}
          {receiptLines.length > 0 && (
            <div className="rounded-xl border border-emerald-200 dark:border-emerald-900/70 bg-emerald-50/40 dark:bg-emerald-950/20 p-3 space-y-2.5">
              <div className="text-xs font-extrabold text-emerald-900 dark:text-emerald-200">
                📥 2. Chứng Từ Nhập Kho, Mã Lô Đã Nhận &amp; Vị Trí Tồn Kho Hiện Tại
              </div>
              <Table
                head={[
                  "Số Phiếu Nhập Kho (NK)",
                  "Phiếu nhận (GR)",
                  "Kho & Vị trí lúc nhập",
                  "Vật tư & SL nhập",
                  "Mã Lô & Trạng thái IQC",
                  "📍 Vị trí đang tồn hiện tại",
                ]}
              >
                {receiptLines.map((rl) => {
                  const lotBals = currentBalances.filter((b) => b.lot_id === rl.lot_id);
                  return (
                    <tr key={rl.id}>
                      <td className="py-2 pr-3 whitespace-nowrap">
                        {rl.stock_doc_code ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-emerald-600 text-white font-mono font-bold text-[11px]">
                            📥 {rl.stock_doc_code}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="py-2 pr-3 text-xs whitespace-nowrap">
                        <div className="font-mono font-bold text-slate-800 dark:text-slate-100">{rl.gr_code}</div>
                        <div className="text-[11px] text-slate-500">
                          {fmtDateTime(rl.received_at)}
                          {rl.received_by_name ? ` · ${rl.received_by_name}` : ""}
                        </div>
                      </td>
                      <td className="py-2 pr-3 text-xs whitespace-nowrap">
                        <span className="font-mono font-bold text-sky-700 dark:text-sky-300">🏢 {rl.warehouse_code}</span>
                        {rl.intake_location_code && (
                          <span className="ml-1 px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 font-mono text-[11px]">
                            [{rl.intake_location_code}]
                          </span>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-xs">
                        <div className="font-semibold">
                          <span className="font-mono">{rl.item_code}</span> — {rl.item_name}
                        </div>
                        <div className="font-mono font-bold text-emerald-700 dark:text-emerald-400">
                          +{fmtQty(rl.qty)} {rl.uom}
                        </div>
                      </td>
                      <td className="py-2 pr-3 text-xs whitespace-nowrap">
                        {rl.lot_code ? (
                          <div className="space-y-0.5">
                            <div className="flex items-center gap-1.5">
                              <span className="font-mono font-bold text-slate-900 dark:text-slate-100">{rl.lot_code}</span>
                              {rl.lot_status && <StatusBadge status={rl.lot_status} />}
                            </div>
                            {rl.mfr_lot_no && <div className="text-[11px] text-slate-500">Lô NSX: {rl.mfr_lot_no}</div>}
                            {rl.expiry_date && <div className="text-[11px] text-slate-500">HSD: {fmtDate(rl.expiry_date)}</div>}
                          </div>
                        ) : (
                          "Không quản lý lô"
                        )}
                      </td>
                      <td className="py-2 pr-3 text-xs">
                        {lotBals.length === 0 ? (
                          <span className="text-[11px] text-slate-500 italic">Đã xuất dùng hết (Tồn = 0)</span>
                        ) : (
                          <div className="space-y-1">
                            {lotBals.map((b, idx) => (
                              <div
                                key={`${b.warehouse_code}-${b.location_code}-${idx}`}
                                className="inline-flex flex-wrap items-center gap-1 px-2 py-0.5 rounded-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-[11px] mr-1"
                              >
                                <b className="font-mono text-sky-700 dark:text-sky-300">🏢 {b.warehouse_code}</b>
                                <span className="font-mono text-slate-600 dark:text-slate-300">[{b.location_code}]</span>
                                <span>:</span>
                                <b className="font-mono text-emerald-700 dark:text-emerald-400">
                                  {fmtQty(b.qty_on_hand)} {b.uom}
                                </b>
                                {b.is_quarantine && (
                                  <span className="px-1 rounded bg-amber-100 text-amber-800 text-[10px] font-bold">Biệt trữ</span>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </Table>
            </div>
          )}

          {/* 3. Sổ cái Hành trình Luân chuyển & Cấp phát sau khi Nhập kho */}
          {lotMovements.length > 0 && (
            <div className="rounded-xl border border-sky-200 dark:border-sky-900/70 bg-sky-50/40 dark:bg-sky-950/20 p-3 space-y-2.5">
              <div className="text-xs font-extrabold text-sky-900 dark:text-sky-200">
                🔄 3. Hành Trình Luân Chuyển &amp; Cấp Phát Sau Khi Nhập Kho ({lotMovements.length} bước giao dịch kho)
              </div>
              <Table
                head={[
                  "Thời gian",
                  "Số Phiếu Kho",
                  "Loại nghiệp vụ & Lý do",
                  "Vật tư & Mã Lô",
                  "Từ Kho / Vị trí ➔ Đến Kho / Vị trí",
                  "Số lượng",
                  "Người thực hiện",
                ]}
              >
                {lotMovements.map((m) => (
                  <tr key={m.line_id}>
                    <td className="py-2 pr-3 text-[11px] whitespace-nowrap">{fmtDateTime(m.occurred_at)}</td>
                    <td className="py-2 pr-3 font-mono font-bold text-sky-700 dark:text-sky-400 whitespace-nowrap">
                      {m.document_code}
                    </td>
                    <td className="py-2 pr-3 text-xs">
                      <div className="font-bold">{DOC_TYPE_LABELS[m.doc_type] ?? m.doc_type}</div>
                      <div className="text-[11px] text-slate-500">
                        {REASON_LABELS[m.reason_code] ?? m.reason_code}
                        {m.notes ? ` — ${m.notes}` : ""}
                      </div>
                    </td>
                    <td className="py-2 pr-3 text-xs">
                      <div className="font-semibold">{m.item_code}</div>
                      {m.lot_code && <div className="font-mono text-[11px] text-slate-500">Lô: {m.lot_code}</div>}
                    </td>
                    <td className="py-2 pr-3 text-xs whitespace-nowrap">
                      {m.from_wh_code ? (
                        <span className="font-mono">
                          <b>{m.from_wh_code}</b> [{m.from_loc_code}]
                        </span>
                      ) : (
                        <span className="text-slate-400">Nhà cung cấp</span>
                      )}
                      <span className="mx-1.5 font-bold text-sky-600">➔</span>
                      {m.to_wh_code ? (
                        <span className="font-mono text-emerald-700 dark:text-emerald-400">
                          <b>{m.to_wh_code}</b> [{m.to_loc_code}]
                        </span>
                      ) : (
                        <span className="font-semibold text-amber-700 dark:text-amber-300">Xuất tiêu hao / Sản xuất</span>
                      )}
                    </td>
                    <td className="py-2 pr-3 font-mono font-bold whitespace-nowrap">
                      {fmtQty(m.qty)} {m.uom}
                    </td>
                    <td className="py-2 pr-3 text-xs">{m.performed_by_name ?? "—"}</td>
                  </tr>
                ))}
              </Table>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

export function OrdersView({ openId, onOpen }: { openId: string | null; onOpen: (id: string | null) => void }) {
  const [status, setStatus] = useState("");
  const list = useQuery({
    queryKey: ["factory", "pos", status],
    queryFn: () => api<PoListRow[]>(`/api/factory/purchase/orders${status ? `?status=${status}` : ""}`),
  });
  return (
    <div className="flex flex-col gap-3">
      {openId && <OrderDetail key={openId} id={openId} onClose={() => onOpen(null)} />}
      <Card
        title="Đơn mua NVL — Theo dõi Nhập Kho, Số Phiếu Nhập & Hành Trình Luân Chuyển"
        actions={
          <select className={`${inputClass} w-48`} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Trạng thái">
            <option value="">Mọi trạng thái</option>
            {Object.entries(PO_STATUS).map(([k, [, v]]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        }
      >
        <ErrorNote error={list.error} />
        {list.data?.length === 0 && <Empty>Chưa có đơn mua.</Empty>}
        {list.data && list.data.length > 0 && (
          <Table
            head={[
              "Mã đơn",
              "Nhà cung cấp & Vật tư",
              "Kho nhận",
              "Số Phiếu Nhập Kho & Mã Lô",
              "Luân chuyển sau nhập & Vị trí tồn hiện tại",
              "Ngày đặt / Giao",
              "Tổng (VND)",
              "Trạng thái & Chi tiết",
            ]}
          >
            {list.data.map((r) => {
              const whCodes = r.warehouse_codes ?? [];
              const receiptDocs = r.receipt_docs ?? [];
              const stockDocCodes = Array.from(new Set(receiptDocs.map((d) => d.stock_doc_code).filter(Boolean)));
              const grCodes = Array.from(new Set(receiptDocs.map((d) => d.gr_code).filter(Boolean)));
              const lotCodes = Array.from(new Set(receiptDocs.map((d) => d.lot_code).filter(Boolean)));
              const moves = r.downstream_moves ?? [];
              const stockPlaces = r.current_stock_places ?? [];
              const itemsSummary = r.items_summary ?? [];

              return (
                <tr key={r.id} className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50 align-top" onClick={() => onOpen(r.id)}>
                  <td className="py-2.5 pr-3 font-mono font-bold text-sky-700 dark:text-sky-400 whitespace-nowrap">{r.code}</td>
                  <td className="py-2.5 pr-3">
                    <div className="font-semibold text-slate-900 dark:text-slate-100">{r.supplier_name}</div>
                    {itemsSummary.length > 0 && (
                      <div className="text-[11px] text-slate-500 mt-0.5 space-y-0.5">
                        {itemsSummary.map((it, idx) => (
                          <div key={idx}>
                            <span className="font-mono font-semibold text-slate-700 dark:text-slate-300">{it.item_code}</span> — {it.item_name} (
                            <b>
                              {fmtQty(it.qty_received)}/{fmtQty(it.qty_ordered)} {it.uom}
                            </b>{" "}
                            · PR: <span className="font-mono">{it.pr_code}</span>)
                          </div>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="py-2.5 pr-3 whitespace-nowrap">
                    {whCodes.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {whCodes.map((wh) => (
                          <span
                            key={wh}
                            className="inline-flex items-center px-2 py-0.5 rounded-md bg-sky-100 dark:bg-sky-950/60 text-sky-800 dark:text-sky-300 font-mono font-bold text-[11px]"
                          >
                            🏢 {wh}
                          </span>
                        ))}
                      </div>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="py-2.5 pr-3">
                    {receiptDocs.length === 0 ? (
                      <span className="text-[11px] text-slate-400">Chưa nhập kho</span>
                    ) : (
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-1">
                          {stockDocCodes.map((sc) => (
                            <span
                              key={sc}
                              title="Số Phiếu Nhập Kho (bấm vào dòng để xem chi tiết hoặc tra cứu tại Phân hệ Kho -> 3. Phiếu Nhập / Xuất / Chuyển)"
                              className="inline-flex items-center px-2 py-0.5 rounded-md bg-emerald-600 text-white font-mono font-bold text-[11px]"
                            >
                              📥 {sc}
                            </span>
                          ))}
                          {grCodes.map((gc) => (
                            <span
                              key={gc}
                              className="inline-flex items-center px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-mono text-[10px]"
                            >
                              GR: {gc}
                            </span>
                          ))}
                        </div>
                        {lotCodes.length > 0 && (
                          <div className="text-[11px] text-slate-600 dark:text-slate-300">
                            Lô: <b className="font-mono">{lotCodes.join(", ")}</b>
                          </div>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="py-2.5 pr-3">
                    {receiptDocs.length === 0 ? (
                      <span className="text-[11px] text-slate-400">—</span>
                    ) : (
                      <div className="space-y-1 text-[11px]">
                        {moves.length > 0 ? (
                          <div className="space-y-0.5">
                            {moves.map((mv, idx) => (
                              <div key={idx} className="text-sky-800 dark:text-sky-300">
                                <span className="font-mono font-bold">{mv.doc_code}</span>:{" "}
                                {mv.from_wh_code ? `${mv.from_wh_code}[${mv.from_loc_code}]` : ""} ➔{" "}
                                <b>{mv.to_wh_code ? `${mv.to_wh_code}[${mv.to_loc_code}]` : "Xuất sử dụng"}</b> ({fmtQty(mv.qty)} {mv.uom})
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="text-slate-500">Chưa điều chuyển đi kho khác</div>
                        )}
                        {stockPlaces.length > 0 && (
                          <div className="flex flex-wrap gap-1 pt-0.5">
                            {stockPlaces.map((sp, idx) => (
                              <span
                                key={idx}
                                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 font-mono text-[10px]"
                              >
                                📍 Đang tồn: <b>{sp.warehouse_code}</b> [{sp.location_code}] ({fmtQty(sp.qty_on_hand)} {sp.uom}
                                {sp.is_quarantine ? " · Biệt trữ" : ""})
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="py-2.5 pr-3 whitespace-nowrap text-[11px]">
                    <div>Đặt: {fmtDate(r.order_date)}</div>
                    <div className="text-slate-500">Giao: {fmtDate(r.expected_date)}</div>
                  </td>
                  <td className="py-2.5 pr-3 text-right font-mono whitespace-nowrap">{fmtQty(r.total_amount)}</td>
                  <td className="py-2.5 pr-3 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                    <div className="inline-flex items-center gap-1.5">
                      <StatusBadge status={PO_STATUS[r.status][0]} label={PO_STATUS[r.status][1]} />
                      <Button
                        variant="ghost"
                        className="!px-2 !py-0.5 !text-[11px]"
                        onClick={() => onOpen(openId === r.id ? null : r.id)}
                      >
                        {openId === r.id ? "Đóng" : "🔎 Hành trình"}
                      </Button>
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

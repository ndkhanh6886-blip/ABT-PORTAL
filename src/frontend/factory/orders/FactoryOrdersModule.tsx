"use client";

import React, { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Cpu, Dna, FlaskConical, Plus, Rocket, Truck } from "lucide-react";
import { ActionBar, type AllowedAction } from "../actions";
import { api, fmtDate, fmtQty, useFactoryMe, vnToday } from "../api";
import { printOrderCoa } from "../coa";
import {
  downloadOligoSequenceExcelTemplate,
  OligoOrderPanel,
  parseOligoSequenceExcelFile,
} from "../oligo/OligoOrderPanel";
import { Button, Card, Empty, ErrorNote, Field, inputClass, StatusBadge, Table } from "../ui";
import { ShipmentForm, type OrderLine } from "./ShipmentForm";

const STATUS: Record<string, [string, string]> = {
  RECEIVED: ["QUARANTINE", "Chờ nhận đơn"],
  ACCEPTED: ["PENDING_QC", "Đã nhận đơn"],
  IN_PRODUCTION: ["PENDING_QC", "Đang sản xuất"],
  READY: ["RELEASED", "Sẵn sàng giao"],
  PARTIALLY_DELIVERED: ["ON_HOLD", "Giao một phần"],
  DELIVERED: ["RELEASED", "Đã giao đủ"],
  CLOSED: ["EXPIRED", "Đã đóng"],
  REJECTED: ["REJECTED", "Từ chối"],
  CANCELLED: ["EXPIRED", "KD đã hủy"],
};
const SHIP_STATUS: Record<string, string> = {
  POSTED: "Đã xuất",
  DELIVERED: "Đã giao khách",
  ACKNOWLEDGED: "KD đã xác nhận",
};
const ACTIONS = {
  reject: "Từ chối đơn",
  start_production: "Bắt đầu sản xuất",
  mark_ready: "Sẵn sàng giao",
};

const MODULE_META: Record<
  string,
  { badge: string; color: string; actionLabel: string; targetTab: string; desc: string }
> = {
  KIT: {
    badge: "🧪 Phòng Sản xuất Kit",
    color: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300",
    actionLabel: "🚀 Phát Lệnh Sản Xuất Kit (EBR)",
    targetTab: "factory-kit",
    desc: "Nổ BOM Kit ➔ Pha chế MasterMix ➔ Chiết rót ➔ Đóng gói ➔ FQC ➔ Nhập KHO-KIT",
  },
  OLIGO: {
    badge: "🧬 Phòng Tổng hợp Oligo",
    color: "bg-purple-100 text-purple-800 dark:bg-purple-950/70 dark:text-purple-300",
    actionLabel: "🧬 Phát Đơn Tổng Hợp Oligo",
    targetTab: "factory-oligo",
    desc: "Tiếp nhận trình tự (5'➔3') ➔ Ghép mẻ máy tổng hợp ➔ Tinh sạch OPC/HPLC ➔ Đo OD260 ➔ QC",
  },
  DEVICE: {
    badge: "⚙️ Phòng Kỹ thuật – Thiết bị",
    color: "bg-sky-100 text-sky-800 dark:bg-sky-950/70 dark:text-sky-300",
    actionLabel: "📋 Đồng Bộ PO Sản Xuất & Nổ BOM (MRP)",
    targetTab: "factory-device",
    desc: "Đồng bộ PO Sản xuất (Tab 3) ➔ Nổ BOM & Tách PR mua hàng / Gia công ngoài ➔ Phát Lệnh lắp ráp WO & DHR",
  },
};

interface OrderDetail {
  id: string;
  code: string;
  kd_po_code: string;
  kd_so_code: string | null;
  org_unit_id: string;
  org_unit_code?: string;
  org_unit_name: string;
  module_key?: string;
  ship_mode: string;
  ship_to: { name?: string; address?: string; receiver?: string; phone?: string } | null;
  requested_date: string | null;
  committed_date: string | null;
  initial_committed_date?: string | null;
  due_date_change_count: number;
  status: string;
  version: number;
  notes: string | null;
  linked_oligo_orders?: {
    id: string;
    code: string;
    status: string;
    due_date: string | null;
    notes: string | null;
    sequence_count: number;
  }[];
  device_po_summary?: {
    po_code: string;
    pr_codes: string[];
    subcontract_codes: string[];
    wo_codes: string[];
  } | null;
  lines: (OrderLine & {
    item_name: string | null;
    transfer_price: string;
    available_fg_qty?: number;
    kit_order_lots?: string[];
    oligo_order_codes?: string[];
    device_order_serials?: string[];
    device_po_sync_badges?: string[];
    device_model_id?: string | null;
    device_model_code?: string | null;
    device_model_revision?: string | null;
    device_bom_count?: number;
  })[];
  shipments: {
    id: string;
    code: string;
    status: string;
    ship_mode: string;
    created_at: string;
    kd_inbound_code: string | null;
    warehouse_code: string;
  }[];
  actions: AllowedAction[];
}

function AcceptForm({ order, onDone }: { order: OrderDetail; onDone: () => void }) {
  const [date, setDate] = useState(order.requested_date?.slice(0, 10) ?? vnToday());
  const [method, setMethod] = useState<"PIN" | "PASSWORD">("PIN");
  const [pin, setPin] = useState("");
  const accept = useMutation({
    mutationFn: () =>
      api(`/api/factory/intake/orders/${order.id}/actions`, {
        method: "POST",
        json: {
          action: "accept",
          expectedVersion: order.version,
          payload: { committed_date: date },
          credential: { method, secret: pin },
        },
      }),
    onSuccess: onDone,
  });
  return (
    <form
      className="grid gap-2 sm:grid-cols-4 items-end p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/50"
      onSubmit={(e) => {
        e.preventDefault();
        accept.mutate();
      }}
    >
      <Field label="Ngày giao cam kết *">
        <input className={inputClass} type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
      </Field>
      <Field label="Xác thực chữ ký điện tử (PIN / Mật khẩu) *">
        <div className="flex gap-1">
          <select
            className={`${inputClass} w-28`}
            value={method}
            onChange={(e) => {
              const m = e.target.value as "PIN" | "PASSWORD";
              setMethod(m);
              setPin("");
            }}
          >
            <option value="PIN">PIN</option>
            <option value="PASSWORD">Mật khẩu</option>
          </select>
          <input
            className={inputClass}
            type="password"
            placeholder={method === "PIN" ? "Nhập mã PIN ký số..." : "Nhập mật khẩu..."}
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            required
          />
        </div>
      </Field>
      <Button type="submit" disabled={accept.isPending}>
        Ký Nhận Đơn & Cam Kết SLA ✍
      </Button>
      <div className="sm:col-span-4">
        <ErrorNote error={accept.error} />
      </div>
    </form>
  );
}

function ProofUpload({ shipmentId, onDone }: { shipmentId: string; onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const upload = useMutation({
    mutationFn: async () => {
      const fd = new FormData();
      fd.append("file", file!);
      const res = await fetch(`/api/factory/intake/shipments/${shipmentId}/proof`, {
        method: "POST",
        body: fd,
        credentials: "same-origin",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Lỗi ${res.status}`);
    },
    onSuccess: onDone,
  });
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <input
        type="file"
        accept="application/pdf,image/png,image/jpeg"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        className="text-xs"
      />
      <Button variant="ghost" disabled={!file || upload.isPending} onClick={() => upload.mutate()}>
        Tải biên bản & xác nhận đã giao
      </Button>
      {upload.error && <span className="text-rose-600">{(upload.error as Error).message}</span>}
    </span>
  );
}

function NewInternalOrderForm({ onDone }: { onDone: (createdId: string) => void }) {
  const qc = useQueryClient();
  const catalog = useQuery({
    queryKey: ["factory", "internal-order-catalog"],
    queryFn: () =>
      api<{
        departments: { id: string; code: string; name: string; module_key: string }[];
        items: { id: string; code: string; name: string; base_uom: string; domain_key: string; kd_item_code?: string | null }[];
        sales_orders?: {
          id: number;
          order_code: string;
          customer_name: string;
          order_date: string;
          delivery_address?: string;
          order_notes?: string;
          status?: string;
          items?: any;
        }[];
      }>("/api/factory/intake/ops"),
  });

  const [targetModule, setTargetModule] = useState<"KIT" | "OLIGO" | "DEVICE">("KIT");
  const [kdPoCode, setKdPoCode] = useState("");
  const [kdSoCode, setKdSoCode] = useState("");
  const [shipMode, setShipMode] = useState<"TO_KD" | "DROP_SHIP">("TO_KD");
  const [customerName, setCustomerName] = useState("Kho Thương Mại Kinh Doanh ABT");
  const [requestedDate, setRequestedDate] = useState(() =>
    new Date(Date.now() + 7 * 86400 * 1000).toISOString().slice(0, 10)
  );
  const [notes, setNotes] = useState("");

  // Multi-line items state
  const [lines, setLines] = useState<{ itemId: string; qty: string; price: string }[]>([
    { itemId: "", qty: "20", price: "2500000" },
  ]);

  // Multi-SO selector state
  const [showSoPicker, setShowSoPicker] = useState(false);
  const [selectedSoCodes, setSelectedSoCodes] = useState<string[]>([]);

  // Oligo Primer/Probe Sequence Builder state
  const [oligoMode, setOligoMode] = useState<"TABLE" | "BULK">("TABLE");
  const [oligoRows, setOligoRows] = useState<
    {
      name: string;
      sequence: string;
      scale_code: "25NMOL" | "50NMOL" | "100NMOL" | "200NMOL" | "1000NMOL";
      purification: "DESALT" | "OPC" | "HPLC" | "PAGE";
      format: "LYOPHILIZED" | "LIQUID_100UM" | "LIQUID_10UM";
    }[]
  >([
    {
      name: "HBV-F",
      sequence: "GAGTGTGGATTCGCACTCCT",
      scale_code: "200NMOL",
      purification: "OPC",
      format: "LYOPHILIZED",
    },
    {
      name: "HBV-R",
      sequence: "GAGGAGTTGGGGGAGGAGATT",
      scale_code: "200NMOL",
      purification: "OPC",
      format: "LYOPHILIZED",
    },
    {
      name: "HBV-PRB",
      sequence: "[FAM]CCAYTCRTCCBGCRGGBTR[BHQ1]",
      scale_code: "200NMOL",
      purification: "HPLC",
      format: "LYOPHILIZED",
    },
  ]);
  const [oligoBulkText, setOligoBulkText] = useState(
    [
      "HBV-F; GAGTGTGGATTCGCACTCCT; 200NMOL; OPC; LYOPHILIZED",
      "HBV-R; GAGGAGTTGGGGGAGGAGATT; 200NMOL; OPC; LYOPHILIZED",
      "HBV-PRB; [FAM]CCAYTCRTCCBGCRGGBTR[BHQ1]; 200NMOL; HPLC; LYOPHILIZED",
    ].join("\n")
  );

  const domainItems = (catalog.data?.items ?? []).filter((i) => i.domain_key === targetModule);
  const defaultItemId = domainItems[0]?.id ?? "";

  const resolvedLines = lines
    .map((l) => ({
      item_id: l.itemId && domainItems.some((i) => i.id === l.itemId) ? l.itemId : defaultItemId,
      qty: Math.max(1, Number(String(l.qty).replace(",", ".")) || 1),
      transfer_price: Math.max(0, Number(String(l.price).replace(/\D/g, "")) || 1500000),
    }))
    .filter((l) => Boolean(l.item_id));

  const builtOligoSequencesText =
    targetModule === "OLIGO"
      ? oligoMode === "BULK"
        ? oligoBulkText.trim()
        : oligoRows
            .filter((r) => r.name.trim() && r.sequence.trim())
            .map((r) => `${r.name.trim()}; ${r.sequence.trim()}; ${r.scale_code}; ${r.purification}; ${r.format}`)
            .join("\n")
      : undefined;

  const handleMergeSelectedSalesOrders = () => {
    const allSos = catalog.data?.sales_orders ?? [];
    const chosen = allSos.filter((so) => selectedSoCodes.includes(so.order_code));
    if (chosen.length === 0) return;

    const mergedMap = new Map<string, { itemId: string; qty: number; price: number }>();
    const allCatalogItems = catalog.data?.items ?? [];

    for (const so of chosen) {
      let soItems = so.items;
      if (typeof soItems === "string") {
        try {
          soItems = JSON.parse(soItems);
        } catch {
          soItems = [];
        }
      }
      if (!Array.isArray(soItems)) continue;

      for (const rawIt of soItems) {
        const code = String(rawIt?.product_code || rawIt?.code || "").trim().toUpperCase();
        const qtyNum = Math.max(1, Number(rawIt?.quantity ?? rawIt?.qty) || 1);
        const priceNum = Math.max(0, Number(rawIt?.unit_price ?? rawIt?.price) || 1500000);
        const matchedItem =
          domainItems.find(
            (i) => i.code.toUpperCase() === code || (i.kd_item_code && i.kd_item_code.toUpperCase() === code)
          ) ||
          allCatalogItems.find(
            (i) => i.code.toUpperCase() === code || (i.kd_item_code && i.kd_item_code.toUpperCase() === code)
          ) ||
          domainItems[0];

        if (!matchedItem) continue;
        const prev = mergedMap.get(matchedItem.id);
        if (prev) {
          prev.qty += qtyNum;
        } else {
          mergedMap.set(matchedItem.id, { itemId: matchedItem.id, qty: qtyNum, price: priceNum });
        }
      }
    }

    if (mergedMap.size > 0) {
      setLines(
        Array.from(mergedMap.values()).map((x) => ({
          itemId: x.itemId,
          qty: String(x.qty),
          price: String(x.price),
        }))
      );
    }

    const joinedSoCodes = chosen.map((s) => s.order_code).join(", ");
    setKdSoCode(joinedSoCodes);
    if (!kdPoCode) {
      setKdPoCode(`PO-GOP-${chosen[0].order_code}`);
    }
    const custNames = Array.from(new Set(chosen.map((s) => s.customer_name).filter(Boolean))).join(" + ");
    if (custNames) {
      setCustomerName(custNames);
    }
    setNotes(`Gộp từ ${chosen.length} đơn SO Kinh doanh (${joinedSoCodes}) — ${custNames}`);
    setShowSoPicker(false);
  };

  const createMut = useMutation({
    mutationFn: () =>
      api<{ id: string; code: string }>("/api/factory/intake/ops", {
        method: "POST",
        idempotent: true,
        json: {
          op: "create_internal_order",
          target_module: targetModule,
          kd_po_code: kdPoCode || undefined,
          kd_so_code: kdSoCode || undefined,
          ship_mode: shipMode,
          customer_name: customerName,
          requested_date: requestedDate,
          notes: notes || undefined,
          oligo_sequences_text: builtOligoSequencesText || undefined,
          auto_accept: true,
          lines: resolvedLines,
        },
      }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["factory", "internal-orders"] });
      onDone(res.id);
    },
  });

  return (
    <Card title="Tạo Đơn Đặt Hàng Nội Bộ Mới (Hỗ trợ nhiều mặt hàng, gộp nhiều đơn SO & khai báo trình tự Primer/Probe)">
      <form
        className="flex flex-col gap-3.5"
        onSubmit={(e) => {
          e.preventDefault();
          createMut.mutate();
        }}
      >
        {/* Thanh công cụ Gộp từ nhiều Đơn hàng Kinh doanh (SO) */}
        <div className="p-3 rounded-xl bg-sky-50/70 dark:bg-sky-950/30 border border-sky-200 dark:border-sky-800/70 flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs">
              <span className="font-extrabold text-sky-900 dark:text-sky-200">
                📦 Tạo đơn từ 1 hoặc nhiều Đơn hàng Kinh doanh (SO):
              </span>{" "}
              <span className="text-slate-600 dark:text-slate-400">
                Chọn nhiều đơn SO để hệ thống tự động cộng dồn số lượng theo từng mã hàng hoặc thêm nhiều dòng mặt hàng bên dưới.
              </span>
            </div>
            <button
              type="button"
              onClick={() => setShowSoPicker((v) => !v)}
              className="px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold cursor-pointer"
            >
              {showSoPicker ? "Ẩn danh sách đơn SO ▲" : "📥 Chọn & Gộp từ nhiều đơn SO Kinh doanh ▼"}
            </button>
          </div>

          {showSoPicker && (
            <div className="mt-1 p-2.5 rounded-lg bg-white dark:bg-slate-900 border border-sky-200 dark:border-sky-800 flex flex-col gap-2">
              <div className="max-h-44 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                {(catalog.data?.sales_orders ?? []).length === 0 ? (
                  <div className="py-2 text-slate-400 italic">Chưa có đơn hàng SO nào trong hệ thống Kinh doanh.</div>
                ) : (
                  (catalog.data?.sales_orders ?? []).map((so) => {
                    const checked = selectedSoCodes.includes(so.order_code);
                    return (
                      <label
                        key={so.order_code}
                        className="flex items-center justify-between gap-2 py-1.5 px-2 hover:bg-slate-50 dark:hover:bg-slate-800/60 cursor-pointer rounded"
                      >
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              setSelectedSoCodes((prev) =>
                                e.target.checked ? [...prev, so.order_code] : prev.filter((c) => c !== so.order_code)
                              );
                            }}
                          />
                          <span className="font-mono font-bold text-sky-700 dark:text-sky-300">{so.order_code}</span>
                          <span className="font-semibold text-slate-800 dark:text-slate-200">— {so.customer_name}</span>
                        </div>
                        <span className="text-[11px] text-slate-500">{fmtDate(so.order_date)}</span>
                      </label>
                    );
                  })
                )}
              </div>
              <div className="flex items-center justify-between pt-1 border-t border-slate-100 dark:border-slate-800">
                <span className="text-[11px] text-slate-500">
                  Đã chọn <b>{selectedSoCodes.length}</b> đơn SO: <b className="font-mono">{selectedSoCodes.join(", ") || "—"}</b>
                </span>
                <Button
                  type="button"
                  disabled={selectedSoCodes.length === 0}
                  onClick={handleMergeSelectedSalesOrders}
                >
                  📥 Nạp & Gộp mặt hàng từ {selectedSoCodes.length} SO đã chọn
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Thông tin chung của Đơn nội bộ */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="1. Phân luồng về Phòng Sản Xuất *">
            <select
              className={inputClass}
              value={targetModule}
              onChange={(e) => {
                const m = e.target.value as "KIT" | "OLIGO" | "DEVICE";
                setTargetModule(m);
                const nextDefaultQty = m === "DEVICE" ? "2" : m === "OLIGO" ? "10" : "25";
                const nextDefaultPrice = m === "DEVICE" ? "65000000" : m === "OLIGO" ? "850000" : "2800000";
                setLines([{ itemId: "", qty: nextDefaultQty, price: nextDefaultPrice }]);
              }}
            >
              <option value="KIT">🧪 Phòng Sản xuất Kit Chẩn đoán (P-KIT)</option>
              <option value="OLIGO">🧬 Phòng Tổng hợp Oligo (P-OLIGO)</option>
              <option value="DEVICE">⚙️ Phòng Kỹ thuật – Thiết bị (P-DEVICE)</option>
            </select>
          </Field>

          <Field label="Mã PO Kinh doanh" hint="Để trống: tự động sinh mã PO-KD-...">
            <input
              className={inputClass}
              placeholder={`VD: PO-KD-${targetModule}-2605`}
              value={kdPoCode}
              onChange={(e) => setKdPoCode(e.target.value)}
            />
          </Field>

          <Field label="Mã SO Kinh doanh liên kết (1 hoặc nhiều SO)">
            <input
              className={inputClass}
              placeholder="VD: SO26-CR-1001, SO26-BV-1002"
              value={kdSoCode}
              onChange={(e) => setKdSoCode(e.target.value)}
            />
          </Field>

          <Field label="Hình thức giao hàng">
            <select
              className={inputClass}
              value={shipMode}
              onChange={(e) => setShipMode(e.target.value as "TO_KD" | "DROP_SHIP")}
            >
              <option value="TO_KD">🏢 Giao về Kho Kinh doanh (TO_KD)</option>
              <option value="DROP_SHIP">🚚 Giao thẳng Khách hàng / Bệnh viện (DROP_SHIP)</option>
            </select>
          </Field>

          <Field label="Ngày yêu cầu giao *">
            <input
              className={inputClass}
              type="date"
              value={requestedDate}
              onChange={(e) => setRequestedDate(e.target.value)}
              required
            />
          </Field>

          <Field label="Đơn vị nhận / Ghi chú">
            <input
              className={inputClass}
              value={notes || customerName}
              onChange={(e) => {
                setCustomerName(e.target.value);
                setNotes(e.target.value);
              }}
            />
          </Field>
        </div>

        {/* Danh sách các dòng mặt hàng đặt sản xuất (Multi-line items) */}
        <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800 flex flex-col gap-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-extrabold text-slate-800 dark:text-slate-100">
              📋 2. Danh sách Mặt hàng đặt sản xuất ({lines.length} dòng sản phẩm):
            </span>
            <button
              type="button"
              onClick={() =>
                setLines((prev) => [
                  ...prev,
                  {
                    itemId: domainItems[Math.min(prev.length, Math.max(0, domainItems.length - 1))]?.id ?? "",
                    qty: targetModule === "DEVICE" ? "1" : targetModule === "OLIGO" ? "10" : "20",
                    price: targetModule === "DEVICE" ? "65000000" : targetModule === "OLIGO" ? "850000" : "2500000",
                  },
                ])
              }
              className="px-3 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer"
            >
              + Thêm mặt hàng vào đơn
            </button>
          </div>

          <div className="flex flex-col gap-2">
            {lines.map((ln, idx) => {
              const currentItemId =
                ln.itemId && domainItems.some((i) => i.id === ln.itemId) ? ln.itemId : defaultItemId;
              return (
                <div
                  key={idx}
                  className="grid gap-2 sm:grid-cols-12 items-end p-2 rounded-lg bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800"
                >
                  <div className="sm:col-span-6">
                    <Field label={`Dòng #${idx + 1} — Sản phẩm / Thiết bị / Bộ Oligo *`}>
                      <select
                        className={inputClass}
                        value={currentItemId}
                        onChange={(e) => {
                          const v = e.target.value;
                          setLines((prev) => prev.map((r, i) => (i === idx ? { ...r, itemId: v } : r)));
                        }}
                        required
                      >
                        {domainItems.map((it) => (
                          <option key={it.id} value={it.id}>
                            {it.code} — {it.name} ({it.base_uom})
                          </option>
                        ))}
                      </select>
                    </Field>
                  </div>
                  <div className="sm:col-span-2">
                    <Field label="Số lượng đặt *">
                      <input
                        className={inputClass}
                        inputMode="decimal"
                        value={ln.qty}
                        onChange={(e) => {
                          const v = e.target.value;
                          setLines((prev) => prev.map((r, i) => (i === idx ? { ...r, qty: v } : r)));
                        }}
                        required
                      />
                    </Field>
                  </div>
                  <div className="sm:col-span-3">
                    <Field label="Giá chuyển giao (VND)">
                      <input
                        className={inputClass}
                        inputMode="numeric"
                        value={ln.price}
                        onChange={(e) => {
                          const v = e.target.value;
                          setLines((prev) => prev.map((r, i) => (i === idx ? { ...r, price: v } : r)));
                        }}
                      />
                    </Field>
                  </div>
                  <div className="sm:col-span-1 flex justify-end pb-1">
                    {lines.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setLines((prev) => prev.filter((_, i) => i !== idx))}
                        className="px-2.5 py-1.5 rounded-lg border border-rose-300 dark:border-rose-800 text-rose-600 dark:text-rose-400 hover:bg-rose-50 text-xs font-bold cursor-pointer"
                        title="Xóa dòng mặt hàng này"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Bảng khai báo danh sách Trình tự Primer / Probe / Amplicon khi chọn P-OLIGO */}
        {targetModule === "OLIGO" && (
          <div className="p-3.5 rounded-xl bg-purple-50/70 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-800/80 flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-xs font-extrabold text-purple-950 dark:text-purple-200">
                  🧬 3. Khai báo Danh sách Trình tự Primer / Probe / Amplicon (5&apos; → 3&apos;) cần tổng hợp:
                </div>
                <div className="text-[11px] text-purple-800/80 dark:text-purple-300/80">
                  Nhập từng dòng, dán văn bản hoặc tải lên từ file Excel (.xlsx / .csv) để hệ thống tự động tính chiều dài (nt), MW, Tm và gắn vào Đơn Tổng Hợp Oligo.
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => downloadOligoSequenceExcelTemplate()}
                  className="px-2.5 py-1 rounded-lg border border-emerald-400 dark:border-emerald-700 bg-white dark:bg-slate-900 hover:bg-emerald-50 text-emerald-800 dark:text-emerald-300 text-xs font-bold cursor-pointer"
                >
                  📥 Tải file Excel mẫu (.xlsx)
                </button>
                <label className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer inline-flex items-center gap-1">
                  <span>📤 Nhập trình tự từ file Excel (.xlsx)</span>
                  <input
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    className="hidden"
                    onChange={async (e) => {
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
                          window.alert("Không tìm thấy trình tự hợp lệ trong file Excel.");
                          return;
                        }
                        setOligoRows(
                          parsed.rows.map((r) => ({
                            name: r.name,
                            sequence: r.sequence,
                            scale_code: (["25NMOL", "50NMOL", "100NMOL", "200NMOL", "1000NMOL"].includes(r.scale_code)
                              ? r.scale_code
                              : "200NMOL") as any,
                            purification: (["DESALT", "OPC", "HPLC", "PAGE"].includes(r.purification)
                              ? r.purification
                              : "OPC") as any,
                            format: (r.format === "LIQUID" ? "LIQUID_100UM" : "LYOPHILIZED") as any,
                          }))
                        );
                        setOligoBulkText(parsed.text);
                      } catch (err: any) {
                        window.alert(`Lỗi đọc file Excel: ${err?.message || "Định dạng không hợp lệ"}`);
                      }
                    }}
                  />
                </label>
                <button
                  type="button"
                  onClick={() => setOligoMode("TABLE")}
                  className={`px-2.5 py-1 rounded-lg text-xs font-bold cursor-pointer ${
                    oligoMode === "TABLE"
                      ? "bg-purple-700 text-white"
                      : "bg-white dark:bg-slate-900 border border-purple-300 dark:border-purple-700 text-purple-800 dark:text-purple-200"
                  }`}
                >
                  📑 Nhập từng dòng trình tự ({oligoRows.length})
                </button>
                <button
                  type="button"
                  onClick={() => setOligoMode("BULK")}
                  className={`px-2.5 py-1 rounded-lg text-xs font-bold cursor-pointer ${
                    oligoMode === "BULK"
                      ? "bg-purple-700 text-white"
                      : "bg-white dark:bg-slate-900 border border-purple-300 dark:border-purple-700 text-purple-800 dark:text-purple-200"
                  }`}
                >
                  📋 Dán nhanh từ Excel / Text
                </button>
              </div>
            </div>

            {oligoMode === "TABLE" ? (
              <div className="flex flex-col gap-2">
                {oligoRows.map((row, idx) => {
                  const cleanBases = row.sequence.replace(/\[[^\]]+\]/g, "").replace(/[^ACGTRYMKSWHBVDNUacgtrymkswhbvdnu]/g, "");
                  return (
                    <div
                      key={idx}
                      className="grid gap-2 sm:grid-cols-12 items-end p-2 rounded-lg bg-white dark:bg-slate-900 border border-purple-200 dark:border-purple-800/70"
                    >
                      <div className="sm:col-span-2">
                        <Field label={`#${idx + 1} Tên Primer/Probe`}>
                          <input
                            className={inputClass}
                            placeholder="VD: HBV-F / HBV-PRB"
                            value={row.name}
                            onChange={(e) => {
                              const v = e.target.value;
                              setOligoRows((prev) => prev.map((r, i) => (i === idx ? { ...r, name: v } : r)));
                            }}
                          />
                        </Field>
                      </div>
                      <div className="sm:col-span-5">
                        <Field label={`Trình tự 5' → 3' (${cleanBases.length} nt)`} hint="Hỗ trợ đánh dấu huỳnh quang [FAM]...[BHQ1], [HEX], [CY5]">
                          <input
                            className={`${inputClass} font-mono`}
                            placeholder="VD: GAGTGTGGATTCGCACTCCT hoặc [FAM]CCAYTCRTCCBGCRGGBTR[BHQ1]"
                            value={row.sequence}
                            onChange={(e) => {
                              const v = e.target.value;
                              setOligoRows((prev) => prev.map((r, i) => (i === idx ? { ...r, sequence: v } : r)));
                            }}
                          />
                        </Field>
                      </div>
                      <div className="sm:col-span-2">
                        <Field label="Scale tổng hợp">
                          <select
                            className={inputClass}
                            value={row.scale_code}
                            onChange={(e) => {
                              const v = e.target.value as any;
                              setOligoRows((prev) => prev.map((r, i) => (i === idx ? { ...r, scale_code: v } : r)));
                            }}
                          >
                            <option value="25NMOL">25 nmol</option>
                            <option value="50NMOL">50 nmol</option>
                            <option value="100NMOL">100 nmol</option>
                            <option value="200NMOL">200 nmol</option>
                            <option value="1000NMOL">1000 nmol</option>
                          </select>
                        </Field>
                      </div>
                      <div className="sm:col-span-2">
                        <Field label="Tinh sạch & Định dạng">
                          <div className="flex gap-1">
                            <select
                              className={inputClass}
                              value={row.purification}
                              onChange={(e) => {
                                const v = e.target.value as any;
                                setOligoRows((prev) => prev.map((r, i) => (i === idx ? { ...r, purification: v } : r)));
                              }}
                            >
                              <option value="DESALT">DESALT</option>
                              <option value="OPC">OPC</option>
                              <option value="HPLC">HPLC</option>
                              <option value="PAGE">PAGE</option>
                            </select>
                            <select
                              className={inputClass}
                              value={row.format}
                              onChange={(e) => {
                                const v = e.target.value as any;
                                setOligoRows((prev) => prev.map((r, i) => (i === idx ? { ...r, format: v } : r)));
                              }}
                            >
                              <option value="LYOPHILIZED">Đông khô</option>
                              <option value="LIQUID_100UM">100 µM</option>
                              <option value="LIQUID_10UM">10 µM</option>
                            </select>
                          </div>
                        </Field>
                      </div>
                      <div className="sm:col-span-1 flex justify-end pb-1">
                        {oligoRows.length > 1 && (
                          <button
                            type="button"
                            onClick={() => setOligoRows((prev) => prev.filter((_, i) => i !== idx))}
                            className="px-2 py-1.5 rounded-lg border border-rose-300 text-rose-600 hover:bg-rose-50 text-xs font-bold cursor-pointer"
                            title="Xóa trình tự này"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}

                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() =>
                      setOligoRows((prev) => [
                        ...prev,
                        {
                          name: `PRIMER-${prev.length + 1}`,
                          sequence: "",
                          scale_code: "200NMOL",
                          purification: "OPC",
                          format: "LYOPHILIZED",
                        },
                      ])
                    }
                    className="px-3 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold cursor-pointer"
                  >
                    + Thêm trình tự Primer (Mồi)
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setOligoRows((prev) => [
                        ...prev,
                        {
                          name: `PROBE-${prev.length + 1}`,
                          sequence: "[FAM]CCAYTCRTCCBGCRGGBTR[BHQ1]",
                          scale_code: "200NMOL",
                          purification: "HPLC",
                          format: "LYOPHILIZED",
                        },
                      ])
                    }
                    className="px-3 py-1.5 rounded-lg border border-purple-400 dark:border-purple-700 bg-white dark:bg-slate-900 text-purple-800 dark:text-purple-200 text-xs font-bold hover:bg-purple-100 cursor-pointer"
                  >
                    + Thêm Probe TaqMan ([FAM]...[BHQ1])
                  </button>
                </div>
              </div>
            ) : (
              <Field
                label="Dán danh sách trình tự (Mỗi dòng 1 chuỗi: Tên; Trình tự 5'→3'; Scale; Tinh sạch; Định dạng)"
                hint="Ví dụ: DEN1-F; GAGTGTGGATTCGCACTCCT; 200NMOL; OPC; LYOPHILIZED"
              >
                <textarea
                  rows={5}
                  className={`${inputClass} font-mono text-xs`}
                  value={oligoBulkText}
                  onChange={(e) => setOligoBulkText(e.target.value)}
                />
              </Field>
            )}
          </div>
        )}

        <ErrorNote error={createMut.error ?? catalog.error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => onDone("")}>
            Hủy
          </Button>
          <Button type="submit" disabled={createMut.isPending || resolvedLines.length === 0}>
            {createMut.isPending
              ? "Đang phân luồng đơn…"
              : `Gửi & Phân luồng Đơn Nội Bộ (${resolvedLines.length} dòng mặt hàng)`}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function OrderPanel({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();
  const me = useFactoryMe();
  const [shipping, setShipping] = useState(false);
  const [toast, setToast] = useState<{
    msg: string;
    targetTab?: string;
    oligoOrderId?: string;
    devicePoId?: string;
  } | null>(null);
  const [editingNotes, setEditingNotes] = useState(false);
  const [notesDraft, setNotesDraft] = useState("");
  const [editingDate, setEditingDate] = useState(false);
  const [newCommitDate, setNewCommitDate] = useState("");
  const [dateChangeReason, setDateChangeReason] = useState("");
  const [confirmDateWarning, setConfirmDateWarning] = useState(false);
  const [addingOligoSeq, setAddingOligoSeq] = useState(false);
  const [newSeqText, setNewSeqText] = useState(
    "PRIMER-NEW-F; GAGTGTGGATTCGCACTCCT; 200NMOL; OPC; LYOPHILIZED\nPRIMER-NEW-R; GAGGAGTTGGGGGAGGAGATT; 200NMOL; OPC; LYOPHILIZED"
  );

  const order = useQuery({
    queryKey: ["factory", "internal-order", id],
    queryFn: () => api<OrderDetail>(`/api/factory/intake/orders/${id}`),
  });

  const refresh = () => {
    setShipping(false);
    setEditingNotes(false);
    setEditingDate(false);
    setDateChangeReason("");
    setConfirmDateWarning(false);
    qc.invalidateQueries({ queryKey: ["factory", "internal-order", id] });
    qc.invalidateQueries({ queryKey: ["factory", "internal-orders"] });
    qc.invalidateQueries({ queryKey: ["factory", "stock"] });
    qc.invalidateQueries({ queryKey: ["factory", "kit"] });
    qc.invalidateQueries({ queryKey: ["factory", "oligo"] });
    qc.invalidateQueries({ queryKey: ["factory", "oligo-orders"] });
    qc.invalidateQueries({ queryKey: ["factory", "device"] });
  };

  const moveDate = useMutation({
    mutationFn: ({ date, reason }: { date: string; reason: string }) =>
      api(`/api/factory/intake/orders/${id}/date`, {
        method: "POST",
        json: { committed_date: date, reason, version: order.data!.version },
      }),
    onSuccess: refresh,
  });

  const saveNotesMut = useMutation({
    mutationFn: (notes: string) =>
      api(`/api/factory/intake/orders/${id}`, {
        method: "PATCH",
        json: { notes },
      }),
    onSuccess: refresh,
  });

  const addOligoSeqMut = useMutation({
    mutationFn: () =>
      api<{ oligo_order_id: string; oligo_order_code: string; added_count: number; message: string }>(
        "/api/factory/intake/ops",
        {
          method: "POST",
          json: {
            op: "add_oligo_sequences_to_order",
            order_id: id,
            sequences_text: newSeqText,
          },
        }
      ),
    onSuccess: (res) => {
      setAddingOligoSeq(false);
      setToast({
        msg: `✅ ${res.message}`,
        targetTab: "factory-oligo",
        oligoOrderId: res.oligo_order_id,
      });
      refresh();
    },
  });

  const dispatchProdMut = useMutation({
    mutationFn: ({ lineId, forceNew }: { lineId: string; forceNew?: boolean }) =>
      api<{
        domain: string;
        order_code: string;
        order_id?: string;
        target_tab: string;
        already_existed?: boolean;
        message: string;
      }>("/api/factory/intake/ops", {
        method: "POST",
        idempotent: true,
        json: { op: "dispatch_to_production", order_id: id, line_id: lineId, force_new: forceNew },
      }),
    onSuccess: (res) => {
      setToast({
        msg: `✅ ${res.message}`,
        targetTab: res.target_tab,
        oligoOrderId: res.domain === "OLIGO" ? res.order_id : undefined,
        devicePoId: res.domain === "DEVICE" ? (res.order_id || id) : undefined,
      });
      refresh();
    },
  });

  const o = order.data;
  const modMeta = MODULE_META[o?.module_key ?? "KIT"] ?? MODULE_META.KIT;
  const canShip =
    me.data?.permissions.includes("intake.shipment.post") &&
    o &&
    ["ACCEPTED", "IN_PRODUCTION", "READY", "PARTIALLY_DELIVERED"].includes(o.status);

  const navigateToModule = (tabKey: string, oligoOrderId?: string, devicePoId?: string) => {
    if (typeof window !== "undefined") {
      if (oligoOrderId) {
        window.sessionStorage.setItem("factory_open_oligo_order_id", oligoOrderId);
      }
      if (devicePoId) {
        window.sessionStorage.setItem("factory_open_device_po_id", devicePoId);
      }
      window.dispatchEvent(new CustomEvent("factory-switch-tab", { detail: { tab: tabKey, oligoOrderId, devicePoId } }));
      if (oligoOrderId) {
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent("factory-open-oligo-order", { detail: { oligoOrderId } }));
        }, 120);
      }
      if (devicePoId) {
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent("factory-open-device-po", { detail: { poId: devicePoId } }));
        }, 120);
      }
    }
  };

  const primaryOligoOrder = o?.linked_oligo_orders?.[0];
  if (o && o.module_key === "OLIGO" && primaryOligoOrder?.id) {
    return (
      <OligoOrderPanel
        key={primaryOligoOrder.id}
        id={primaryOligoOrder.id}
        canDeliver={Boolean(canShip)}
        onClose={onClose}
        titleOverride={`Chi tiết Đơn Oligo ${primaryOligoOrder.code} (Đơn nội bộ: ${o.code}) — PO Kinh doanh: ${o.kd_po_code}`}
        headerBanner={
          <div className="p-2.5 rounded-xl bg-purple-50/70 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-800 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold ${modMeta.color}`}>
                {modMeta.badge} ({o.org_unit_name})
              </span>
              <span className="text-slate-600 dark:text-slate-300">
                Trạng thái Đơn nội bộ <b>{o.code}</b>:
              </span>
              <StatusBadge status={STATUS[o.status][0]} label={STATUS[o.status][1]} />
              <span className="text-slate-600 dark:text-slate-300">
                · Hình thức: <b>{o.ship_mode === "DROP_SHIP" ? "🚚 Giao thẳng khách" : "🏢 Về kho Kinh doanh"}</b>
              </span>
            </div>
            <button
              type="button"
              onClick={() => navigateToModule("factory-oligo", primaryOligoOrder.id)}
              className="px-2.5 py-1 rounded-lg bg-purple-700 hover:bg-purple-800 text-white font-bold text-[11px] cursor-pointer"
            >
              🧬 Mở tại Phòng Tổng hợp Oligo ({primaryOligoOrder.code}) ↗
            </button>
          </div>
        }
        footerSlot={
          <div className="pt-2 border-t border-slate-200 dark:border-slate-800 flex flex-col gap-2">
            {o.actions.some((a) => a.action === "accept") && <AcceptForm order={o} onDone={refresh} />}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <ActionBar
                endpoint={`/api/factory/intake/orders/${o.id}/actions`}
                version={o.version}
                actions={o.actions.filter((a) => a.action !== "accept")}
                labels={ACTIONS}
                onDone={refresh}
              />
              {canShip && !shipping && (
                <Button onClick={() => setShipping(true)}>🚚 Lập Phiếu Xuất Giao Hàng (Kho KD)</Button>
              )}
            </div>
            {canShip && shipping && (
              <ShipmentForm orderId={o.id} orgUnitId={o.org_unit_id} lines={o.lines} onDone={refresh} />
            )}
          </div>
        }
      />
    );
  }

  return (
    <Card
      title={o ? `Chi tiết Đơn nội bộ ${o.code} — PO Kinh doanh: ${o.kd_po_code}` : "Đơn nội bộ"}
      actions={
        <Button variant="ghost" onClick={onClose}>
          Đóng
        </Button>
      }
    >
      <ErrorNote error={order.error ?? moveDate.error ?? saveNotesMut.error ?? dispatchProdMut.error} />
      {toast && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/50 px-3.5 py-2 text-xs font-semibold text-emerald-800 dark:text-emerald-200">
          <span>{toast.msg}</span>
          <div className="flex items-center gap-2">
            {toast.targetTab && (
              <Button onClick={() => navigateToModule(toast.targetTab!, toast.oligoOrderId, toast.devicePoId)}>
                Mở phân hệ sản xuất tương ứng →
              </Button>
            )}
            <button type="button" className="text-emerald-600 hover:underline cursor-pointer" onClick={() => setToast(null)}>
              Đóng
            </button>
          </div>
        </div>
      )}

      {o && (
        <div className="flex flex-col gap-3 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={STATUS[o.status][0]} label={STATUS[o.status][1]} />
              <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold ${modMeta.color}`}>
                {modMeta.badge} ({o.org_unit_name})
              </span>
              <span>
                · KD yêu cầu: <b>{fmtDate(o.requested_date)}</b> · Cam kết: <b>{fmtDate(o.committed_date)}</b>
                {o.due_date_change_count > 0 && (
                  <span className="ml-1 px-2 py-0.5 rounded bg-amber-100 dark:bg-amber-950/80 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-700 text-[10px] font-bold">
                    ⚠️ Đã dời lịch {o.due_date_change_count} lần
                  </span>
                )}
              </span>
              <span>
                · Hình thức: <b>{o.ship_mode === "DROP_SHIP" ? "🚚 Giao thẳng khách" : "🏢 Về kho Kinh doanh"}</b>
              </span>
            </div>
            <div className="text-[11px] text-slate-500">{modMeta.desc}</div>
          </div>

          {/* Khung Ghi chú đơn hàng (Hiển thị rõ ràng & cho phép sửa) */}
          <div className="p-3 rounded-xl bg-amber-50/70 dark:bg-amber-950/25 border border-amber-200 dark:border-amber-800/70 flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <span className="font-bold text-amber-900 dark:text-amber-200">
                📝 Ghi chú đối với Đơn hàng ({o.code}):
              </span>
              {!editingNotes && (
                <button
                  type="button"
                  onClick={() => {
                    setNotesDraft(o.notes || "");
                    setEditingNotes(true);
                  }}
                  className="px-2.5 py-1 rounded-lg bg-white dark:bg-slate-900 border border-amber-300 dark:border-amber-700 text-[11px] font-bold text-amber-800 dark:text-amber-300 hover:bg-amber-100 cursor-pointer"
                >
                  ✏️ Sửa ghi chú
                </button>
              )}
            </div>
            {editingNotes ? (
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="text"
                  className={`${inputClass} flex-1`}
                  value={notesDraft}
                  onChange={(e) => setNotesDraft(e.target.value)}
                  placeholder="Nhập ghi chú đơn hàng, yêu cầu đóng gói, hạn dùng, COA..."
                />
                <div className="flex items-center gap-1.5 shrink-0">
                  <Button
                    disabled={saveNotesMut.isPending}
                    onClick={() => saveNotesMut.mutate(notesDraft)}
                  >
                    💾 Lưu ghi chú
                  </Button>
                  <Button variant="ghost" onClick={() => setEditingNotes(false)}>
                    Hủy
                  </Button>
                </div>
              </div>
            ) : (
              <div className="text-slate-800 dark:text-slate-200 whitespace-pre-line">
                {o.notes || <span className="italic text-slate-400">Chưa có ghi chú đơn hàng.</span>}
              </div>
            )}
          </div>

          {/* Liên kết trực tiếp với Đơn Oligo & Nút Xuất COA / Thêm Trình Tự Primer-Probe ngay trên Đơn Nội Bộ */}
          {(o.module_key === "OLIGO" || (o.linked_oligo_orders && o.linked_oligo_orders.length > 0)) && (
            <div className="p-3 rounded-xl bg-purple-50/70 dark:bg-purple-950/25 border border-purple-200 dark:border-purple-800/70 flex flex-col gap-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="space-y-0.5">
                  <div className="font-extrabold text-purple-950 dark:text-purple-200">
                    🧬 Đơn Tổng Hợp Oligo Đang Liên Kết ({o.linked_oligo_orders?.length ?? 0} đơn):
                  </div>
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    {(o.linked_oligo_orders ?? []).map((oo) => (
                      <div
                        key={oo.id}
                        className="flex flex-wrap items-center gap-1.5 px-2.5 py-1 rounded-xl bg-white dark:bg-slate-900 border border-purple-200 dark:border-purple-800"
                      >
                        <button
                          type="button"
                          onClick={() => navigateToModule("factory-oligo", oo.id)}
                          className="font-mono font-extrabold text-purple-700 dark:text-purple-300 hover:underline cursor-pointer"
                        >
                          🔗 {oo.code} ({oo.sequence_count} trình tự) ↗
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            printOrderCoa(oo.id, "PRIMER_PROBE_ONLY").catch((e) => window.alert(e.message))
                          }
                          className="px-2 py-0.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-[10px] cursor-pointer"
                          title="Xuất COA Đơn hàng (chỉ gồm Primer & Probe)"
                        >
                          📜 COA Đơn hàng
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            printOrderCoa(oo.id, "AMPLICONS_ONLY").catch((e) => window.alert(e.message))
                          }
                          className="px-2 py-0.5 rounded-lg border border-purple-300 dark:border-purple-700 bg-purple-50 dark:bg-purple-950/50 text-purple-800 dark:text-purple-300 font-bold text-[10px] cursor-pointer"
                          title="Xuất COA Amplicon"
                        >
                          🧬 COA Amplicon
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setAddingOligoSeq((v) => !v)}
                  className="px-3 py-1.5 rounded-lg bg-purple-700 hover:bg-purple-800 text-white font-bold text-xs cursor-pointer"
                >
                  {addingOligoSeq ? "Đóng khung thêm trình tự ▲" : "🧬 + Thêm trình tự Primer / Probe"}
                </button>
              </div>

              {addingOligoSeq && (
                <div className="p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-purple-200 dark:border-purple-800 flex flex-col gap-2">
                  <Field
                    label="Nhập hoặc dán danh sách trình tự Primer / Probe / Amplicon (Mỗi dòng: Tên; Trình tự 5'→3'; Scale; Tinh sạch; Định dạng)"
                    hint="Ví dụ: HBV-F2; GAGTGTGGATTCGCACTCCT; 200NMOL; OPC; LYOPHILIZED | HBV-PRB2; [FAM]CCAYTCRTCCBGCRGGBTR[BHQ1]; 200NMOL; HPLC; LYOPHILIZED"
                  >
                    <textarea
                      rows={4}
                      className={`${inputClass} font-mono text-xs`}
                      value={newSeqText}
                      onChange={(e) => setNewSeqText(e.target.value)}
                    />
                  </Field>
                  <ErrorNote error={addOligoSeqMut.error} />
                  <div className="flex justify-end gap-2">
                    <Button variant="ghost" onClick={() => setAddingOligoSeq(false)}>
                      Hủy
                    </Button>
                    <Button
                      disabled={addOligoSeqMut.isPending || !newSeqText.trim()}
                      onClick={() => addOligoSeqMut.mutate()}
                    >
                      {addOligoSeqMut.isPending ? "Đang nạp trình tự…" : "💾 Lưu & Thêm Trình Tự vào Đơn Oligo"}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Liên kết đồng bộ trực tiếp với Đơn PO Sản Xuất Thiết Bị & Nổ BOM (MRP) tại Phòng Kỹ thuật – Công nghệ */}
          {o.module_key === "DEVICE" && (
            <div className="p-3 rounded-xl bg-sky-50/70 dark:bg-sky-950/25 border border-sky-200 dark:border-sky-800/70 flex flex-wrap items-center justify-between gap-2">
              <div className="space-y-1">
                <div className="font-extrabold text-sky-950 dark:text-sky-200">
                  ⚙️ Đơn PO Sản Xuất Thiết Bị Đang Đồng Bộ (Phòng Kỹ thuật – Công nghệ):
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="px-2.5 py-1 rounded-xl bg-white dark:bg-slate-900 border border-sky-200 dark:border-sky-800 font-mono font-bold text-sky-700 dark:text-sky-300">
                    📋 PO Sản xuất: {o.kd_po_code} (Đơn nội bộ: {o.code})
                  </span>
                  {o.device_po_summary && o.device_po_summary.pr_codes.length > 0 && (
                    <span className="px-2 py-0.5 rounded-lg bg-amber-100 dark:bg-amber-950/70 text-amber-800 dark:text-amber-300 font-mono font-bold text-[11px]">
                      🛒 Đề nghị mua PR: {o.device_po_summary.pr_codes.join(", ")}
                    </span>
                  )}
                  {o.device_po_summary && o.device_po_summary.subcontract_codes.length > 0 && (
                    <span className="px-2 py-0.5 rounded-lg bg-purple-100 dark:bg-purple-950/70 text-purple-800 dark:text-purple-300 font-mono font-bold text-[11px]">
                      🔨 Đơn gia công: {o.device_po_summary.subcontract_codes.join(", ")}
                    </span>
                  )}
                  {o.device_po_summary && o.device_po_summary.wo_codes.length > 0 && (
                    <span className="px-2 py-0.5 rounded-lg bg-emerald-100 dark:bg-emerald-950/70 text-emerald-800 dark:text-emerald-300 font-mono font-bold text-[11px]">
                      🔧 Lệnh lắp ráp WO: {o.device_po_summary.wo_codes.join(", ")}
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-slate-600 dark:text-slate-400">
                  Luồng chuẩn Kỹ thuật – Công nghệ: <b>Đồng bộ PO Sản xuất (Tab 3)</b> ➔ <b>Nổ định mức BOM (MRP)</b> ➔{" "}
                  <b>Đề nghị mua hàng (PR) / Tách đơn gia công ngoài</b> ➔ <b>Phát Lệnh lắp ráp (WO) & Cấp Serial (Tab 4)</b>.
                </div>
              </div>
              <button
                type="button"
                onClick={() => navigateToModule("factory-device", undefined, o.id)}
                className="px-3 py-1.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-bold text-xs cursor-pointer shadow-xs"
              >
                📋 Mở PO Sản Xuất & Nổ BOM / Tách PR / Gia công (Tab 3) ↗
              </button>
            </div>
          )}

          {o.ship_to && (
            <p className="text-slate-600 dark:text-slate-300">
              📍 Địa chỉ giao nhận: <b>{o.ship_to.name}</b> — {o.ship_to.address}{" "}
              {o.ship_to.receiver && `· Người nhận: ${o.ship_to.receiver}`} {o.ship_to.phone}
            </p>
          )}

          {dispatchProdMut.error && <ErrorNote error={dispatchProdMut.error} />}
          {toast && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/60 px-3.5 py-2.5 text-xs font-semibold text-emerald-800 dark:text-emerald-200 shadow-xs">
              <span>{toast.msg}</span>
              <div className="flex items-center gap-2">
                {toast.targetTab && (
                  <Button onClick={() => navigateToModule(toast.targetTab!, toast.oligoOrderId, toast.devicePoId)}>
                    Mở phân hệ sản xuất xử lý ngay →
                  </Button>
                )}
                <button
                  type="button"
                  className="text-emerald-600 dark:text-emerald-400 hover:underline cursor-pointer"
                  onClick={() => setToast(null)}
                >
                  Đóng
                </button>
              </div>
            </div>
          )}

          <Table
            head={[
              "#",
              "Mã & Tên Sản phẩm Đặt hàng",
              "Số lượng Đặt / Đã giao",
              "Tồn Thành phẩm Khả dụng",
              o.module_key === "DEVICE"
                ? "PO Sản Xuất Thiết Bị (MRP / PR / Gia công / WO) Đã Đồng Bộ"
                : "Lệnh Sản Xuất / Đơn Tổng Hợp Oligo Đã Gắn",
              "Chuyển tiếp Sản xuất (1-Click)",
            ]}
          >
            {o.lines.map((l) => {
              const isDeviceOrder = o.module_key === "DEVICE" || Boolean(l.device_model_id);
              const tracked = isDeviceOrder
                ? l.device_po_sync_badges ?? [
                    `PO SX: ${o.kd_po_code} [${o.status === "RECEIVED" ? "Chờ xác nhận PO" : "Đã đồng bộ PO & MRP"}]`,
                    ...(l.device_order_serials ?? []),
                  ]
                : [...(l.kit_order_lots ?? []), ...(l.oligo_order_codes ?? []), ...(l.device_order_serials ?? [])];
              const remainingQty = Math.max(0, Number(l.qty) - Number(l.qty_delivered));
              const availFg = Number(l.available_fg_qty ?? 0);
              const hasEnoughStock = availFg >= remainingQty && remainingQty > 0;
              return (
                <tr key={l.id}>
                  <td className="py-2 pr-3">{l.line_no}</td>
                  <td className="py-2 pr-3">
                    <div className="font-mono font-bold text-slate-900 dark:text-white">
                      {l.kd_item_code} {l.kd_item_name && `— ${l.kd_item_name}`}
                    </div>
                    <div className="text-[11px] text-slate-500">
                      {l.item_code ? (
                        `Mã nhà máy: ${l.item_code} · Giá chuyển giao: ${fmtQty(l.transfer_price)} đ/${l.kd_unit ?? l.base_uom}`
                      ) : (
                        <span className="text-rose-600 font-semibold">Chưa gắn mã nhà máy</span>
                      )}
                    </div>
                  </td>
                  <td className="py-2 pr-3 whitespace-nowrap">
                    <div className="font-bold">
                      {fmtQty(l.qty)} {l.kd_unit}
                    </div>
                    <div className="text-[11px] text-slate-500">Đã giao: {fmtQty(l.qty_delivered)}</div>
                  </td>
                  <td className="py-2 pr-3 whitespace-nowrap">
                    {hasEnoughStock ? (
                      <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300">
                        ✅ Sẵn kho: {fmtQty(availFg)} {l.base_uom}
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300">
                        ⚠️ Tồn TP: {fmtQty(availFg)} {l.base_uom} (Cần SX)
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-3">
                    {tracked.length > 0 ? (
                      <div className="flex flex-col gap-1">
                        {tracked.map((t, idx) => (
                          <span
                            key={idx}
                            className="inline-block px-2 py-0.5 rounded-md bg-sky-50 dark:bg-sky-950/60 border border-sky-200 dark:border-sky-800 font-mono text-[11px] text-sky-700 dark:text-sky-300"
                          >
                            {t}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-slate-400 italic">Chưa phát lệnh sản xuất</span>
                    )}
                  </td>
                  <td className="py-2 pr-3 whitespace-nowrap">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {(() => {
                        if (remainingQty <= 0) {
                          return (
                            <span className="px-2.5 py-1 rounded-lg bg-emerald-100 dark:bg-emerald-950/70 text-emerald-800 dark:text-emerald-300 font-bold text-[11px]">
                              ✅ Đã giao đủ hàng
                            </span>
                          );
                        }

                        // Luồng riêng cho Phòng Kỹ thuật – Công nghệ (DEVICE): Đồng bộ với PO Sản xuất & Nổ BOM (MRP) ở Tab 3
                        if (isDeviceOrder) {
                          const isPoSynced = o.status !== "RECEIVED" && Boolean(l.device_model_id);
                          if (isPoSynced) {
                            return (
                              <>
                                <button
                                  type="button"
                                  onClick={() => navigateToModule("factory-device", undefined, o.id)}
                                  className="px-2.5 py-1 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-bold text-[11px] inline-flex items-center gap-1 shadow-xs cursor-pointer"
                                  title={`Đã đồng bộ với Đơn PO Sản Xuất Thiết Bị (${o.kd_po_code}). Bấm để mở Tab 3: Đơn PO & Tách PR/Gia công (MRP).`}
                                >
                                  <span>✅ Đã đồng bộ PO SX ({o.kd_po_code}) · Mở PO & Nổ BOM (MRP) ↗</span>
                                </button>
                              </>
                            );
                          }
                          return (
                            <>
                              <Button
                                onClick={() => dispatchProdMut.mutate({ lineId: l.id, forceNew: false })}
                                disabled={dispatchProdMut.isPending}
                              >
                                {dispatchProdMut.isPending
                                  ? "Đang đồng bộ PO…"
                                  : "📋 Đồng Bộ PO Sản Xuất & Nổ BOM (MRP)"}
                              </Button>
                              <button
                                type="button"
                                onClick={() => navigateToModule("factory-device", undefined, o.id)}
                                className="px-2 py-1 rounded-xl border border-sky-300 dark:border-sky-700 bg-sky-50 dark:bg-sky-950/60 text-sky-800 dark:text-sky-200 font-bold text-[11px] cursor-pointer"
                              >
                                Mở PO {o.kd_po_code} ↗
                              </button>
                            </>
                          );
                        }

                        const firstTrackedCode = tracked[0]?.split(" ")[0] || "";
                        const linkedOligoId = o.linked_oligo_orders?.[0]?.id;
                        const isAlreadyDispatched =
                          tracked.length > 0 &&
                          ["IN_PRODUCTION", "READY", "PARTIALLY_DELIVERED", "DELIVERED"].includes(o.status);

                        if (isAlreadyDispatched) {
                          return (
                            <>
                              <button
                                type="button"
                                onClick={() => navigateToModule(modMeta.targetTab, linkedOligoId)}
                                className="px-2.5 py-1 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[11px] inline-flex items-center gap-1 shadow-xs cursor-pointer"
                                title={`Đơn đã được phát lệnh (${firstTrackedCode}). Bấm để chuyển sang phân hệ sản xuất xử lý tiếp.`}
                              >
                                <span>✅ Đã phát đơn ({firstTrackedCode}) · Mở xử lý ↗</span>
                              </button>
                              <button
                                type="button"
                                disabled={dispatchProdMut.isPending}
                                onClick={() => dispatchProdMut.mutate({ lineId: l.id, forceNew: true })}
                                className="px-2 py-1 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold text-[10px] cursor-pointer"
                                title="Tạo thêm một đợt / mẻ sản xuất mới bổ sung cho dòng sản phẩm này"
                              >
                                {dispatchProdMut.isPending ? "Đang tạo…" : "+ Phát thêm đợt SX"}
                              </button>
                            </>
                          );
                        }

                        if (tracked.length > 0) {
                          // Có sẵn đơn liên kết (VD: OL2610-0002 đang PENDING) nhưng Đơn nội bộ còn ở trạng thái Chờ nhận / Đã nhận đơn
                          return (
                            <>
                              <Button
                                onClick={() => dispatchProdMut.mutate({ lineId: l.id, forceNew: false })}
                                disabled={dispatchProdMut.isPending}
                              >
                                {dispatchProdMut.isPending
                                  ? "Đang kích hoạt…"
                                  : `🚀 Kích hoạt SX & Chuyển tiếp (${firstTrackedCode})`}
                              </Button>
                              <button
                                type="button"
                                onClick={() => navigateToModule(modMeta.targetTab, linkedOligoId)}
                                className="px-2 py-1 rounded-xl border border-purple-300 dark:border-purple-700 bg-purple-50 dark:bg-purple-950/60 text-purple-800 dark:text-purple-200 font-bold text-[11px] cursor-pointer"
                              >
                                Mở {firstTrackedCode} ↗
                              </button>
                            </>
                          );
                        }

                        return (
                          <Button
                            onClick={() => dispatchProdMut.mutate({ lineId: l.id, forceNew: false })}
                            disabled={dispatchProdMut.isPending}
                          >
                            {dispatchProdMut.isPending ? "Đang phát đơn…" : modMeta.actionLabel}
                          </Button>
                        );
                      })()}
                      {hasEnoughStock && canShip && !shipping && (
                        <Button variant="ghost" onClick={() => setShipping(true)}>
                          🚚 Xuất giao ngay
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </Table>

          {o.actions.some((a) => a.action === "accept") && <AcceptForm order={o} onDone={refresh} />}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <ActionBar
              endpoint={`/api/factory/intake/orders/${o.id}/actions`}
              version={o.version}
              actions={o.actions.filter((a) => a.action !== "accept")}
              labels={ACTIONS}
              onDone={refresh}
            />
            <div className="flex flex-wrap items-center gap-2">
              {o.committed_date &&
                ["ACCEPTED", "IN_PRODUCTION", "READY", "PARTIALLY_DELIVERED"].includes(o.status) &&
                me.data?.permissions.includes("intake.order.manage") && (
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setNewCommitDate(o.committed_date?.slice(0, 10) || "");
                      setDateChangeReason("");
                      setConfirmDateWarning(false);
                      setEditingDate((v) => !v);
                    }}
                  >
                    📅 Thay đổi ngày giao cam kết
                  </Button>
                )}
              {canShip && !shipping && (
                <Button onClick={() => setShipping(true)}>🚚 Lập Phiếu Xuất Giao Hàng</Button>
              )}
            </div>
          </div>

          {/* Khung Cảnh Báo Thay Đổi Ngày Giao Cam Kết */}
          {editingDate && (
            <div className="p-3.5 rounded-xl bg-rose-50/90 dark:bg-rose-950/40 border-2 border-rose-300 dark:border-rose-800 space-y-2.5">
              <div className="font-extrabold text-rose-900 dark:text-rose-200 flex items-center gap-1.5 text-xs">
                <span>🚨 CẢNH BÁO THAY ĐỔI NGÀY GIAO CAM KẾT (SLA IMPACT WARNING)</span>
              </div>
              <div className="text-[11px] text-rose-800 dark:text-rose-300 space-y-1">
                <p>
                  • Ngày KD yêu cầu: <b>{fmtDate(o.requested_date)}</b> · Ngày cam kết ban đầu:{" "}
                  <b>{fmtDate(o.initial_committed_date ?? o.committed_date)}</b> · Ngày cam kết hiện tại:{" "}
                  <b>{fmtDate(o.committed_date)}</b> (Đã dời: <b>{o.due_date_change_count} lần</b>).
                </p>
                <p>
                  • Thay đổi ngày giao sẽ phát thông báo cảnh báo tiến độ về Khối Kinh Doanh (PO <b>{o.kd_po_code}</b>) và{" "}
                  <b>tự động đồng bộ sang Đơn Sản Xuất / Đơn Oligo liên kết</b>.
                </p>
              </div>
              <div className="grid gap-2.5 sm:grid-cols-3 items-end">
                <Field label="Ngày giao cam kết mới *">
                  <input
                    type="date"
                    className={inputClass}
                    value={newCommitDate}
                    onChange={(e) => setNewCommitDate(e.target.value)}
                    required
                  />
                </Field>
                <div className="sm:col-span-2">
                  <Field label="Lý do thay đổi ngày giao (Bắt buộc) *">
                    <input
                      type="text"
                      className={inputClass}
                      value={dateChangeReason}
                      onChange={(e) => setDateChangeReason(e.target.value)}
                      placeholder="Nhập lý do cụ thể dời lịch giao hàng..."
                      required
                    />
                  </Field>
                </div>
              </div>
              {newCommitDate && o.committed_date && newCommitDate !== o.committed_date.slice(0, 10) && (
                <label className="flex items-center gap-2 font-bold text-rose-900 dark:text-rose-200 cursor-pointer pt-1">
                  <input
                    type="checkbox"
                    checked={confirmDateWarning}
                    onChange={(e) => setConfirmDateWarning(e.target.checked)}
                    className="w-4 h-4"
                  />
                  <span>
                    Tôi đã kiểm tra cảnh báo trễ hạn SLA và xác nhận đổi ngày giao từ{" "}
                    <u>{fmtDate(o.committed_date)}</u> sang <u>{fmtDate(newCommitDate)}</u>.
                  </span>
                </label>
              )}
              <div className="flex items-center justify-end gap-2">
                <Button variant="ghost" onClick={() => setEditingDate(false)}>
                  Hủy bỏ
                </Button>
                <Button
                  disabled={
                    moveDate.isPending ||
                    !newCommitDate ||
                    newCommitDate === o.committed_date?.slice(0, 10) ||
                    dateChangeReason.trim().length < 3 ||
                    !confirmDateWarning
                  }
                  onClick={() => moveDate.mutate({ date: newCommitDate, reason: dateChangeReason.trim() })}
                >
                  ⚠️ Xác nhận Đổi Ngày Giao &amp; Phát Cảnh Báo
                </Button>
              </div>
            </div>
          )}

          {canShip && shipping && (
            <ShipmentForm orderId={o.id} orgUnitId={o.org_unit_id} lines={o.lines} onDone={refresh} />
          )}

          {o.shipments.length > 0 && (
            <div className="flex flex-col gap-1 pt-2 border-t border-slate-200 dark:border-slate-800">
              <b>Lịch sử Phiếu Xuất Giao Hàng (`Shipment`):</b>
              {o.shipments.map((s) => (
                <div key={s.id} className="flex flex-wrap items-center gap-2">
                  <span className="font-mono font-semibold text-sky-700 dark:text-sky-400">{s.code}</span> · Xuất từ kho{" "}
                  <b>{s.warehouse_code}</b> · {SHIP_STATUS[s.status]}
                  {s.kd_inbound_code && ` · KD nhập ${s.kd_inbound_code}`}
                  {s.ship_mode === "DROP_SHIP" && s.status === "POSTED" && (
                    <ProofUpload shipmentId={s.id} onDone={refresh} />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

/** "Đơn nội bộ": purchase orders of Kinh doanh received by the 3 production departments (Kit, Oligo, Device). */
export function FactoryOrdersModule() {
  const [status, setStatus] = useState("");
  const [moduleFilter, setModuleFilter] = useState<"" | "KIT" | "OLIGO" | "DEVICE">("");
  const [selected, setSelected] = useState<string | null>(() => {
    if (typeof window !== "undefined") {
      const pendingId = window.sessionStorage.getItem("factory_open_internal_order_id");
      if (pendingId) {
        window.sessionStorage.removeItem("factory_open_internal_order_id");
        return pendingId;
      }
    }
    return null;
  });
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const pendingId = window.sessionStorage.getItem("factory_open_internal_order_id");
    if (pendingId) {
      window.sessionStorage.removeItem("factory_open_internal_order_id");
      setSelected(pendingId);
    }
  }, []);

  const list = useQuery({
    queryKey: ["factory", "internal-orders", status],
    queryFn: () =>
      api<
        {
          id: string;
          code: string;
          kd_po_code: string;
          kd_so_code: string | null;
          ship_mode: string;
          requested_date: string | null;
          committed_date: string | null;
          initial_committed_date?: string | null;
          due_date_change_count?: number;
          notes?: string | null;
          status: string;
          org_unit_code?: string;
          org_unit_name: string;
          module_key?: string;
          line_count: number;
          items_summary?: string;
          linked_oligo_orders?: { id: string; code: string; status: string }[];
          linked_kit_orders?: { id: string; code: string; status: string }[];
          linked_device_orders?: { id: string; code: string; status: string }[];
        }[]
      >(`/api/factory/intake/orders${status ? `?status=${status}` : ""}`),
  });

  const allRows = list.data ?? [];
  const filtered = allRows.filter((r) => !moduleFilter || r.module_key === moduleFilter);

  const countByMod = {
    ALL: allRows.length,
    KIT: allRows.filter((r) => r.module_key === "KIT").length,
    OLIGO: allRows.filter((r) => r.module_key === "OLIGO").length,
    DEVICE: allRows.filter((r) => r.module_key === "DEVICE").length,
  };

  return (
    <div className="flex flex-col gap-3">
      {/* SƠ ĐỒ PHÂN LUỒNG 3 PHÒNG SẢN XUẤT */}
      <div className="grid gap-3 sm:grid-cols-4">
        <button
          type="button"
          onClick={() => setModuleFilter("")}
          className={`text-left rounded-2xl border p-3.5 cursor-pointer transition-all ${
            moduleFilter === ""
              ? "border-sky-600 bg-sky-50/80 dark:bg-sky-950/40 shadow-sm"
              : "border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-sky-400"
          }`}
        >
          <div className="text-xs font-bold text-slate-600 dark:text-slate-300">📋 Tất cả Đơn Nội Bộ</div>
          <div className="text-2xl font-extrabold text-slate-900 dark:text-white mt-1">{countByMod.ALL} đơn</div>
          <div className="text-[11px] text-slate-500 mt-0.5">Cổng tiếp nhận chung từ Khối Kinh Doanh</div>
        </button>

        <button
          type="button"
          onClick={() => setModuleFilter("KIT")}
          className={`text-left rounded-2xl border p-3.5 cursor-pointer transition-all ${
            moduleFilter === "KIT"
              ? "border-emerald-600 bg-emerald-50/80 dark:bg-emerald-950/40 shadow-sm"
              : "border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-emerald-400"
          }`}
        >
          <div className="flex items-center justify-between text-xs font-bold text-emerald-700 dark:text-emerald-300">
            <span>🧪 Phòng Sản xuất Kit (P-KIT)</span>
            <FlaskConical className="w-4 h-4" />
          </div>
          <div className="text-2xl font-extrabold text-emerald-800 dark:text-emerald-200 mt-1">
            {countByMod.KIT} đơn
          </div>
          <div className="text-[11px] text-emerald-600 dark:text-emerald-400 mt-0.5">
            Chuyển thành Lệnh SX Kit (`kit.production_order`)
          </div>
        </button>

        <button
          type="button"
          onClick={() => setModuleFilter("OLIGO")}
          className={`text-left rounded-2xl border p-3.5 cursor-pointer transition-all ${
            moduleFilter === "OLIGO"
              ? "border-purple-600 bg-purple-50/80 dark:bg-purple-950/40 shadow-sm"
              : "border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-purple-400"
          }`}
        >
          <div className="flex items-center justify-between text-xs font-bold text-purple-700 dark:text-purple-300">
            <span>🧬 Phòng Tổng hợp Oligo (P-OLIGO)</span>
            <Dna className="w-4 h-4" />
          </div>
          <div className="text-2xl font-extrabold text-purple-800 dark:text-purple-200 mt-1">
            {countByMod.OLIGO} đơn
          </div>
          <div className="text-[11px] text-purple-600 dark:text-purple-400 mt-0.5">
            Chuyển thành Đơn Oligo (`oligo.oligo_order`)
          </div>
        </button>

        <button
          type="button"
          onClick={() => setModuleFilter("DEVICE")}
          className={`text-left rounded-2xl border p-3.5 cursor-pointer transition-all ${
            moduleFilter === "DEVICE"
              ? "border-sky-600 bg-sky-50/80 dark:bg-sky-950/40 shadow-sm"
              : "border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-sky-400"
          }`}
        >
          <div className="flex items-center justify-between text-xs font-bold text-sky-700 dark:text-sky-300">
            <span>⚙️ Phòng Kỹ thuật – Thiết bị</span>
            <Cpu className="w-4 h-4" />
          </div>
          <div className="text-2xl font-extrabold text-sky-800 dark:text-sky-200 mt-1">
            {countByMod.DEVICE} đơn
          </div>
          <div className="text-[11px] text-sky-600 dark:text-sky-400 mt-0.5">
            Chuyển thành Lệnh Lắp Ráp (`device.device_order`)
          </div>
        </button>
      </div>

      {creating && (
        <NewInternalOrderForm
          onDone={(newId) => {
            setCreating(false);
            if (newId) setSelected(newId);
          }}
        />
      )}

      {selected && <OrderPanel key={selected} id={selected} onClose={() => setSelected(null)} />}

      <Card
        title="Danh sách Đơn Nội Bộ từ Khối Kinh Doanh & Điều Phối Về 3 Phòng Sản Xuất"
        actions={
          <div className="flex flex-wrap md:flex-nowrap items-center justify-end gap-2">
            <select
              className={`${inputClass} !w-52 shrink-0`}
              value={moduleFilter}
              onChange={(e) => setModuleFilter(e.target.value as typeof moduleFilter)}
              aria-label="Phòng sản xuất nhận luồng"
            >
              <option value="">Mọi phòng sản xuất</option>
              <option value="KIT">Phòng Sản xuất Kit</option>
              <option value="OLIGO">Phòng Tổng hợp Oligo</option>
              <option value="DEVICE">Phòng Kỹ thuật – Thiết bị</option>
            </select>
            <select
              className={`${inputClass} !w-44 shrink-0`}
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              aria-label="Trạng thái"
            >
              <option value="">Mọi trạng thái</option>
              {Object.entries(STATUS).map(([k, [, v]]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
            {!creating && (
              <Button className="whitespace-nowrap shrink-0" onClick={() => setCreating(true)}>+ Tạo Đơn Nội Bộ</Button>
            )}
          </div>
        }
      >
        <ErrorNote error={list.error} />
        {filtered.length === 0 && (
          <Empty>Chưa có đơn nội bộ trong phân luồng này. Bấm "+ Tạo Đơn Nội Bộ" để khởi tạo đơn mới.</Empty>
        )}
        {filtered.length > 0 && (
          <Table
            head={[
              "Mã đơn",
              "PO Kinh doanh",
              "Phòng Sản xuất & Đơn SX Liên kết",
              "Sản phẩm & Số lượng",
              "Ghi chú đơn hàng",
              "KD yêu cầu",
              "Cam kết SLA",
              "Trạng thái",
              "Thao tác & COA",
            ]}
          >
            {filtered.map((r) => {
              const meta = MODULE_META[r.module_key ?? "KIT"] ?? MODULE_META.KIT;
              const oligoLinks = r.linked_oligo_orders ?? [];
              const kitLinks = r.linked_kit_orders ?? [];
              const deviceLinks = r.linked_device_orders ?? [];
              const isLate =
                r.committed_date &&
                r.requested_date &&
                r.committed_date.slice(0, 10) > r.requested_date.slice(0, 10);

              return (
                <tr
                  key={r.id}
                  className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50"
                  onClick={() => setSelected(r.id)}
                >
                  <td className="py-2 pr-3 font-mono font-bold text-sky-700 dark:text-sky-400 whitespace-nowrap">
                    {r.code}
                  </td>
                  <td className="py-2 pr-3 font-mono font-semibold whitespace-nowrap">{r.kd_po_code}</td>
                  <td className="py-2 pr-3">
                    <div className="flex flex-col gap-1">
                      <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold w-fit ${meta.color}`}>
                        {meta.badge}
                      </span>
                      {oligoLinks.map((oo) => (
                        <button
                          key={oo.id}
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            window.sessionStorage.setItem("factory_open_oligo_order_id", oo.id);
                            window.dispatchEvent(
                              new CustomEvent("factory-switch-tab", {
                                detail: { tab: "factory-oligo", oligoOrderId: oo.id },
                              })
                            );
                          }}
                          title="Nhấp để chuyển sang màn hình Tổng Hợp Oligo và mở đơn Oligo này"
                          className="px-2 py-0.5 rounded-md bg-purple-50 dark:bg-purple-950/60 border border-purple-200 dark:border-purple-800 font-mono text-[11px] font-bold text-purple-700 dark:text-purple-300 hover:underline w-fit cursor-pointer"
                        >
                          🔗 Đơn Oligo: {oo.code} ↗
                        </button>
                      ))}
                      {kitLinks.map((ko) => (
                        <span
                          key={ko.id}
                          className="px-2 py-0.5 rounded-md bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 font-mono text-[10px] font-bold text-emerald-700 dark:text-emerald-300 w-fit"
                        >
                          🔗 Lệnh Kit: {ko.code}
                        </span>
                      ))}
                      {deviceLinks.map((doItem) => (
                        <span
                          key={doItem.id}
                          className="px-2 py-0.5 rounded-md bg-sky-50 dark:bg-sky-950/60 border border-sky-200 dark:border-sky-800 font-mono text-[10px] font-bold text-sky-700 dark:text-sky-300 w-fit"
                        >
                          🔗 Lệnh Thiết bị: {doItem.code}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="py-2 pr-3 text-xs font-mono text-slate-700 dark:text-slate-300 max-w-56">
                    <div className="truncate">{r.items_summary || `${r.line_count} dòng sản phẩm`}</div>
                    <div className="font-sans text-[10px] text-slate-500">
                      {r.ship_mode === "DROP_SHIP" ? "🚚 Giao thẳng khách" : "🏢 Về kho KD"}
                    </div>
                  </td>
                  <td className="py-2 pr-3 max-w-60">
                    {r.notes ? (
                      <div
                        title={r.notes}
                        className="px-2 py-1 rounded-lg bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200/70 dark:border-amber-800/60 text-[11px] text-slate-700 dark:text-slate-200 line-clamp-2"
                      >
                        📝 {r.notes}
                      </div>
                    ) : (
                      <span className="text-slate-400 italic text-[11px]">Chưa có ghi chú</span>
                    )}
                  </td>
                  <td className="py-2 pr-3 whitespace-nowrap">{fmtDate(r.requested_date)}</td>
                  <td className="py-2 pr-3 whitespace-nowrap">
                    <div className="font-semibold">{fmtDate(r.committed_date)}</div>
                    {(r.due_date_change_count ?? 0) > 0 && (
                      <span className="inline-block mt-0.5 px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-950/80 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-700 text-[10px] font-bold">
                        ⚠️ Đã dời {r.due_date_change_count} lần
                      </span>
                    )}
                    {isLate && (
                      <div className="text-[10px] font-bold text-rose-600 dark:text-rose-400 mt-0.5">
                        🚨 Trễ hơn KD yêu cầu
                      </div>
                    )}
                  </td>
                  <td className="py-2 pr-3 whitespace-nowrap">
                    <StatusBadge status={STATUS[r.status][0]} label={STATUS[r.status][1]} />
                  </td>
                  <td className="py-2 pr-3 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {oligoLinks.length > 0 && (
                        <button
                          type="button"
                          onClick={() =>
                            printOrderCoa(oligoLinks[0].id, "PRIMER_PROBE_ONLY").catch((err) =>
                              window.alert(err.message)
                            )
                          }
                          title="Xuất COA Đơn hàng (gồm các trình tự Primer & Probe)"
                          className="px-2 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-[11px] cursor-pointer"
                        >
                          📜 COA Đơn hàng
                        </button>
                      )}
                      <button
                        type="button"
                        className="text-xs font-bold text-sky-700 dark:text-sky-400 hover:underline cursor-pointer"
                        onClick={() => setSelected(r.id)}
                      >
                        Điều phối / Chi tiết →
                      </button>
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

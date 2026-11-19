"use client";

import React, { useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ActionBar, type AllowedAction } from "../actions";
import { api, fmtQty, useDebouncedValue } from "../api";
import { Button, Card, Empty, ErrorNote, Field, inputClass, Pager, StatusBadge, Table } from "../ui";

export const DOC_TYPE: Record<string, string> = {
  RECEIPT: "📥 Phiếu Nhập",
  RETURN: "↩️ Nhập trả",
  ISSUE: "📤 Phiếu Xuất",
  TRANSFER: "🚚 Điều chuyển / Cấp phát",
  ADJUSTMENT: "⚖️ Điều chỉnh",
  COUNT_ADJUST: "📋 Điều chỉnh kiểm kê",
};

export const REASON_VI_LABEL: Record<string, string> = {
  INITIAL_BALANCE: "📦 Tồn kho đầu kỳ",
  PURCHASE_RECEIPT: "📥 Nhập mua hàng (NCC)",
  PO_RECEIPT: "📥 Nhập mua hàng (PO)",
  GOODS_RECEIPT: "📥 Nhập hàng mua về",
  PREPARATION: "🧪 Nhập bán thành phẩm pha chế",
  PRODUCTION_OUTPUT: "🏭 Nhập thành phẩm sản xuất",
  DEPT_SUPPLY: "🚚 Cấp phát sang Kho Bộ Phận",
  INTER_WAREHOUSE: "🔄 Điều chuyển giữa các Kho",
  REPLENISHMENT: "🚚 Bổ sung tồn kho nhánh",
  PUTAWAY: "📦 Cất lên kệ chính (BT ➔ A1)",
  RELOCATE: "📍 Đổi vị trí nội bộ trong kho",
  PRODUCTION: "📤 Xuất cho sản xuất",
  SYNTHESIS: "🧬 Xuất chạy Mẻ tổng hợp Oligo",
  POST_SYNTHESIS: "🧪 Xuất Hậu tổng hợp Oligo",
  RND: "🔬 Xuất cho Nghiên cứu R&D",
  QC_SAMPLE: "🛡️ Xuất mẫu kiểm nghiệm QC",
  SCRAP: "🗑️ Xuất hủy",
  RETURN_TO_SUPPLIER: "↩️ Trả nhà cung cấp",
  COUNT_DIFF: "⚖️ Chênh lệch kiểm đếm",
  DAMAGE: "⚠️ Hư hỏng / Hao hụt",
  REVERSAL: "⏪ Đảo phiếu kho",
  OTHER: "📝 Lý do khác",
};

const REASONS: Record<"ISSUE" | "TRANSFER" | "ADJUSTMENT", Record<string, string>> = {
  ISSUE: {
    PRODUCTION: "Xuất cho sản xuất",
    RND: "Xuất cho R&D",
    QC_SAMPLE: "Mẫu QC",
    SCRAP: "Hủy",
    RETURN_TO_SUPPLIER: "Trả nhà cung cấp",
    OTHER: "Khác",
  },
  TRANSFER: {
    DEPT_SUPPLY: "🚚 Cấp phát sang Kho Bộ Phận (Liên kho)",
    INTER_WAREHOUSE: "🔄 Điều chuyển giữa các Kho",
    PUTAWAY: "📦 Đưa lên kệ chính (Put-Away BT ➔ A1)",
    RELOCATE: "Đổi vị trí nội bộ trong kho",
  },
  ADJUSTMENT: { COUNT_DIFF: "Chênh lệch kiểm đếm", DAMAGE: "Hư hỏng", OTHER: "Khác" },
};

const DOC_STATUS: Record<string, [string, string]> = {
  DRAFT: ["PENDING_QC", "Nháp"],
  POSTED: ["RELEASED", "Đã ghi sổ"],
  CANCELLED: ["EXPIRED", "Đã hủy"],
  REVERSED: ["ON_HOLD", "Đã đảo"],
};
const NEEDS_NOTES = new Set(["SCRAP", "RETURN_TO_SUPPLIER", "OTHER", "COUNT_DIFF", "DAMAGE"]);

interface StockRow {
  id: string;
  item_id: string;
  location_id: string;
  lot_id: string | null;
  item_code: string;
  item_name: string;
  base_uom: string;
  lot_code: string | null;
  lot_status: string | null;
  location_code: string;
  qty_available: string;
  qty_on_hand: string;
}
interface Loc {
  id: string;
  code: string;
  name: string;
  is_quarantine: boolean;
  warehouse_id?: string;
  warehouse_code?: string;
  warehouse_name?: string;
}
interface DraftLine {
  row: StockRow;
  qty: string;
  to_location_id: string;
  direction: "OUT" | "IN";
}

export interface DocLinePreview {
  line_no: number;
  item_id: string;
  item_code: string;
  item_name: string;
  lot_id: string | null;
  lot_code: string | null;
  mfr_lot_no: string | null;
  qty: number;
  uom: string;
  from_wh_code: string | null;
  from_loc_code: string | null;
  to_wh_code: string | null;
  to_loc_code: string | null;
}

function NewDocumentForm({
  initialWarehouseId,
  warehouses,
  onDone,
}: {
  initialWarehouseId: string;
  warehouses: { id: string; code: string; name: string }[];
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const defaultWh =
    initialWarehouseId ||
    warehouses.find((w) => w.code === "KHO-TONG")?.id ||
    warehouses[0]?.id ||
    "";
  const [whId, setWhId] = useState(defaultWh);
  const [type, setType] = useState<"ISSUE" | "TRANSFER" | "ADJUSTMENT">("TRANSFER");
  const [reason, setReason] = useState("DEPT_SUPPLY");
  const [notes, setNotes] = useState("");
  const [q, setQ] = useState("");
  const debouncedPickQ = useDebouncedValue(q, 300);
  const [lines, setLines] = useState<DraftLine[]>([]);

  const stock = useQuery({
    queryKey: ["factory", "stock", "pick", whId, debouncedPickQ],
    queryFn: () =>
      api<{ rows: StockRow[] }>(
        `/api/factory/inv/stock?warehouse_id=${whId}&page_size=40${debouncedPickQ ? `&q=${encodeURIComponent(debouncedPickQ)}` : ""}`
      ),
    enabled: Boolean(whId),
  });

  const localLocs = useQuery({
    queryKey: ["factory", "locations", whId],
    queryFn: () => api<Loc[]>(`/api/factory/master/warehouses/${whId}/locations`),
    enabled: Boolean(whId),
  });

  const hubOps = useQuery({
    queryKey: ["factory", "warehouse-hub-ops"],
    queryFn: () => api<{ all_locations: Loc[] }>("/api/factory/inv/ops"),
  });

  const isInterWh = type === "TRANSFER" && ["DEPT_SUPPLY", "INTER_WAREHOUSE", "REPLENISHMENT"].includes(reason);
  const destLocations: Loc[] = isInterWh
    ? (hubOps.data?.all_locations ?? []).filter((l) => !l.is_quarantine)
    : localLocs.data ?? [];

  const save = useMutation({
    mutationFn: () => {
      const enriched = lines.map((l) => {
        const base = {
          item_id: l.row.item_id,
          lot_id: l.row.lot_id,
          qty: Number(l.qty.replace(",", ".")),
          uom: l.row.base_uom,
        };
        if (type === "TRANSFER") return { ...base, from_location_id: l.row.location_id, to_location_id: l.to_location_id };
        if (type === "ADJUSTMENT" && l.direction === "IN") return { ...base, to_location_id: l.row.location_id };
        return { ...base, from_location_id: l.row.location_id };
      });
      return api("/api/factory/inv/documents", {
        method: "POST",
        idempotent: true,
        json: {
          doc_type: type,
          reason_code: reason,
          warehouse_id: whId,
          notes: notes || null,
          post: true,
          lines: enriched,
        },
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["factory", "stock"] });
      qc.invalidateQueries({ queryKey: ["factory", "documents"] });
      qc.invalidateQueries({ queryKey: ["factory", "warehouse-hub-ops"] });
      onDone();
    },
  });
  const setL = (i: number, p: Partial<DraftLine>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...p } : l)));

  return (
    <Card title="Lập Phiếu Kho Mới (Xuất kho / Cấp phát Liên kho / Put-Away / Điều chỉnh)">
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Kho Nguồn (Xuất / Điều chỉnh) *">
            <select
              className={inputClass}
              value={whId}
              onChange={(e) => {
                setWhId(e.target.value);
                setLines([]);
              }}
              required
            >
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.code} — {w.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Loại phiếu">
            <select
              className={inputClass}
              value={type}
              onChange={(e) => {
                const t = e.target.value as typeof type;
                setType(t);
                setReason(Object.keys(REASONS[t])[0]);
                setLines([]);
              }}
            >
              <option value="TRANSFER">Điều chuyển / Cấp phát kho</option>
              <option value="ISSUE">Xuất tiêu hao</option>
              <option value="ADJUSTMENT">Điều chỉnh kiểm kê</option>
            </select>
          </Field>
          <Field label="Lý do nghiệp vụ">
            <select className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)}>
              {Object.entries(REASONS[type]).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </Field>
          <Field label={`Diễn giải${NEEDS_NOTES.has(reason) ? " *" : ""}`}>
            <input
              className={inputClass}
              placeholder="Ghi chú lệnh sản xuất, phòng nhận…"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              required={NEEDS_NOTES.has(reason)}
            />
          </Field>
        </div>

        <div>
          <input
            className={inputClass}
            placeholder="Tìm tồn kho tại kho nguồn theo mã, tên vật tư, số lô… rồi bấm dòng để thêm vào phiếu"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <ul className="mt-1 max-h-48 overflow-auto rounded-xl border border-slate-200 dark:border-slate-800 text-xs">
            {stock.data?.rows.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  className="w-full text-left px-3 py-1.5 hover:bg-sky-50 dark:hover:bg-sky-950/40 cursor-pointer"
                  onClick={() =>
                    setLines([
                      ...lines,
                      {
                        row: r,
                        qty: String(Number(r.qty_available)),
                        to_location_id: "",
                        direction: "OUT",
                      },
                    ])
                  }
                >
                  <span className="font-mono font-bold">{r.item_code}</span> — {r.item_name} · Lô{" "}
                  <span className="font-mono font-semibold">{r.lot_code ?? "—"}</span> · Vị trí{" "}
                  <span className="font-mono">{r.location_code}</span> · Khả dụng{" "}
                  <b>
                    {fmtQty(r.qty_available)} {r.base_uom}
                  </b>
                  {r.lot_status && r.lot_status !== "RELEASED" && (
                    <span className="text-amber-600"> ({r.lot_status})</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>

        {lines.length > 0 && (
          <Table
            head={[
              "Vật tư / Lô / Vị trí xuất",
              "Số lượng (ĐVT gốc)",
              type === "TRANSFER"
                ? isInterWh
                  ? "Đến Kho Nhánh · Vị trí nhận *"
                  : "Đến Vị trí trong kho *"
                : type === "ADJUSTMENT"
                ? "Hướng điều chỉnh"
                : "",
              "",
            ]}
          >
            {lines.map((l, i) => (
              <tr key={i}>
                <td className="py-2 pr-3">
                  <span className="font-mono font-semibold">{l.row.item_code}</span> · Lô {l.row.lot_code ?? "—"} · Từ{" "}
                  <span className="font-mono">{l.row.location_code}</span>
                </td>
                <td className="py-2 pr-3 w-36">
                  <input
                    className={inputClass}
                    inputMode="decimal"
                    value={l.qty}
                    onChange={(e) => setL(i, { qty: e.target.value })}
                    required
                  />
                </td>
                <td className="py-2 pr-3 w-72">
                  {type === "TRANSFER" && (
                    <select
                      className={inputClass}
                      value={l.to_location_id}
                      onChange={(e) => setL(i, { to_location_id: e.target.value })}
                      required
                    >
                      <option value="">Chọn kho / vị trí đích…</option>
                      {destLocations
                        .filter((x) => x.id !== l.row.location_id)
                        .map((x) => (
                          <option key={x.id} value={x.id}>
                            {x.warehouse_code ? `${x.warehouse_code} · ` : ""}
                            {x.code} — {x.name}
                            {x.warehouse_name ? ` (${x.warehouse_name})` : ""}
                            {x.is_quarantine ? " [Biệt trữ]" : ""}
                          </option>
                        ))}
                    </select>
                  )}
                  {type === "ADJUSTMENT" && (
                    <select
                      className={inputClass}
                      value={l.direction}
                      onChange={(e) => setL(i, { direction: e.target.value as "OUT" | "IN" })}
                    >
                      <option value="OUT">Giảm tồn</option>
                      <option value="IN">Tăng tồn</option>
                    </select>
                  )}
                </td>
                <td className="py-2 pr-3">
                  <button
                    type="button"
                    className="text-rose-600 text-xs cursor-pointer"
                    onClick={() => setLines(lines.filter((_, j) => j !== i))}
                  >
                    Xóa
                  </button>
                </td>
              </tr>
            ))}
          </Table>
        )}
        <ErrorNote error={save.error ?? stock.error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onDone}>
            Hủy
          </Button>
          <Button type="submit" disabled={save.isPending || !lines.length}>
            {save.isPending ? "Đang ghi sổ…" : "Ghi sổ phiếu"}
          </Button>
        </div>
      </form>
    </Card>
  );
}

interface DocDetail {
  id: string;
  code: string;
  doc_type: string;
  reason_code: string;
  status: string;
  version: number;
  warehouse_code: string;
  notes: string | null;
  reversal_of_id: string | null;
  lines: {
    line_no: number;
    item_code: string;
    item_name: string;
    lot_code: string | null;
    from_code: string | null;
    to_code: string | null;
    qty: string;
    uom: string;
  }[];
  actions: AllowedAction[];
}

export function DocumentDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();
  const doc = useQuery({
    queryKey: ["factory", "document", id],
    queryFn: () => api<DocDetail>(`/api/factory/inv/documents/${id}`),
  });
  const d = doc.data;
  return (
    <Card
      title={
        d
          ? `Phiếu ${d.code} — ${DOC_TYPE[d.doc_type] ?? d.doc_type} (${REASON_VI_LABEL[d.reason_code] ?? d.reason_code})`
          : "Phiếu kho"
      }
      actions={
        <Button variant="ghost" onClick={onClose}>
          Đóng
        </Button>
      }
    >
      <ErrorNote error={doc.error} />
      {d && (
        <div className="flex flex-col gap-3">
          <p className="text-xs">
            <StatusBadge status={DOC_STATUS[d.status][0]} label={DOC_STATUS[d.status][1]} /> · Kho lập phiếu{" "}
            <b>{d.warehouse_code}</b>
            {d.notes && <> · {d.notes}</>}
            {d.reversal_of_id && " · phiếu đảo"}
          </p>
          <Table head={["#", "Vật tư", "Lô", "Từ Kho · Vị trí", "Đến Kho · Vị trí", "Số lượng"]}>
            {d.lines.map((l) => (
              <tr key={l.line_no}>
                <td className="py-2 pr-3">{l.line_no}</td>
                <td className="py-2 pr-3 font-medium">
                  <span className="font-mono font-bold">{l.item_code}</span> — {l.item_name}
                </td>
                <td className="py-2 pr-3 font-mono">{l.lot_code ?? "—"}</td>
                <td className="py-2 pr-3 font-mono">{l.from_code ?? "—"}</td>
                <td className="py-2 pr-3 font-mono font-semibold text-sky-700 dark:text-sky-400">
                  {l.to_code ?? "—"}
                </td>
                <td className="py-2 pr-3 whitespace-nowrap font-bold">
                  {fmtQty(l.qty)} {l.uom}
                </td>
              </tr>
            ))}
          </Table>
          <ActionBar
            endpoint={`/api/factory/inv/documents/${d.id}/actions`}
            version={d.version}
            actions={d.actions}
            labels={{ post: "Ghi sổ", cancel: "Hủy nháp", reverse: "Đảo phiếu" }}
            onDone={() => {
              qc.invalidateQueries({ queryKey: ["factory", "document", id] });
              qc.invalidateQueries({ queryKey: ["factory", "documents"] });
              qc.invalidateQueries({ queryKey: ["factory", "stock"] });
              qc.invalidateQueries({ queryKey: ["factory", "warehouse-hub-ops"] });
            }}
          />
        </div>
      )}
    </Card>
  );
}

/** Helper to render warehouse direction flow badge for a document or line */
export function renderWarehouseFlow(
  docType: string,
  docWhCode: string,
  firstLine?: { from_wh_code?: string | null; from_loc_code?: string | null; to_wh_code?: string | null; to_loc_code?: string | null }
) {
  const fromWh = firstLine?.from_wh_code || (docType === "ISSUE" || docType === "TRANSFER" ? docWhCode : null);
  const fromLoc = firstLine?.from_loc_code;
  const toWh = firstLine?.to_wh_code || (docType === "RECEIPT" || docType === "RETURN" ? docWhCode : null);
  const toLoc = firstLine?.to_loc_code;

  if (docType === "RECEIPT" || docType === "RETURN") {
    return (
      <div className="text-xs">
        <span className="text-slate-400">Nhập vào ➔ </span>
        <span className="font-mono font-bold text-emerald-700 dark:text-emerald-400">
          {toWh ?? docWhCode}
          {toLoc ? ` · ${toLoc}` : ""}
        </span>
      </div>
    );
  }
  if (docType === "TRANSFER") {
    const isInterWh = fromWh && toWh && fromWh !== toWh;
    return (
      <div className="text-xs flex flex-wrap items-center gap-1">
        <span className="font-mono font-semibold text-slate-700 dark:text-slate-300">
          {fromWh ?? docWhCode}
          {fromLoc ? `·${fromLoc}` : ""}
        </span>
        <span className="text-sky-600 font-bold">➔</span>
        <span
          className={`font-mono font-bold ${
            isInterWh
              ? "px-1.5 py-0.5 rounded bg-sky-100 dark:bg-sky-950/70 text-sky-800 dark:text-sky-300"
              : "text-slate-700 dark:text-slate-300"
          }`}
        >
          {toWh ?? docWhCode}
          {toLoc ? `·${toLoc}` : ""}
        </span>
      </div>
    );
  }
  return (
    <div className="text-xs">
      <span className="font-mono font-semibold text-rose-700 dark:text-rose-400">
        {fromWh ?? docWhCode}
        {fromLoc ? ` · ${fromLoc}` : ""}
      </span>
      <span className="text-slate-400"> ➔ Xuất dùng</span>
    </div>
  );
}

const FLOW_TABS: { key: string; label: string }[] = [
  { key: "", label: "📋 Tất cả giao dịch" },
  { key: "PURCHASE_IN", label: "📥 Hàng mua về / Nhập kho mới" },
  { key: "SUPPLY_TRANSFER", label: "🚚 Lịch sử Cấp phát (Kho Tổng ➔ Kho Nhánh)" },
  { key: "PRODUCTION_OUT", label: "📤 Phiếu Xuất dùng / Sản xuất" },
  { key: "OPENING", label: "📦 Tồn đầu kỳ" },
];

export function DocumentsView({
  warehouses,
  canCreate,
  initialWarehouseId = "",
}: {
  warehouses: { id: string; code: string; name: string }[];
  canCreate: boolean;
  initialWarehouseId?: string;
}) {
  const [subMode, setSubMode] = useState<"DOCUMENTS" | "LEDGER_TRACE">("DOCUMENTS");
  const [warehouseId, setWarehouseId] = useState(initialWarehouseId);
  const [docType, setDocType] = useState("");
  const [flow, setFlow] = useState("");
  const [focusedItemId, setFocusedItemId] = useState("");
  const [focusedItemLabel, setFocusedItemLabel] = useState("");
  const [docQ, setDocQ] = useState("");
  const debouncedDocQ = useDebouncedValue(docQ, 300);
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  const params = new URLSearchParams({
    view: subMode === "LEDGER_TRACE" ? "ledger" : "documents",
    page: String(page),
    page_size: "50",
  });
  if (warehouseId) params.set("warehouse_id", warehouseId);
  if (docType) params.set("doc_type", docType);
  if (flow) params.set("flow", flow);
  if (focusedItemId) params.set("item_id", focusedItemId);
  if (debouncedDocQ.trim()) params.set("q", debouncedDocQ.trim());

  const list = useQuery({
    queryKey: ["factory", "documents", params.toString()],
    queryFn: () =>
      api<{
        rows: any[];
        item_summaries?: {
          item_id: string;
          item_code: string;
          item_name: string;
          base_uom: string;
          qty_purchased_in: number;
          qty_opening_in: number;
          qty_transferred_between_wh: number;
          qty_issued_out: number;
          distributed_by_wh: { to_wh: string; qty: number }[];
          balance_by_wh: { wh_code: string; qty_on_hand: number }[];
          total_on_hand: number;
        }[];
        total: number;
        page: number;
        page_size: number;
      }>(`/api/factory/inv/documents?${params}`),
    placeholderData: keepPreviousData,
  });

  const rows = list.data?.rows ?? [];
  const itemSummaries = list.data?.item_summaries ?? [];
  const total = list.data?.total ?? rows.length;

  const openItemTrace = (itemId: string, label: string) => {
    setFocusedItemId(itemId);
    setFocusedItemLabel(label);
    setSubMode("LEDGER_TRACE");
    setPage(1);
  };

  return (
    <div className="flex flex-col gap-3">
      {creating && (
        <NewDocumentForm
          initialWarehouseId={warehouseId}
          warehouses={warehouses}
          onDone={() => setCreating(false)}
        />
      )}
      {selected && <DocumentDetail key={selected} id={selected} onClose={() => setSelected(null)} />}

      {/* Top Mode Switcher + Warehouse Pills */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3 space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                setSubMode("DOCUMENTS");
                setPage(1);
              }}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                subMode === "DOCUMENTS"
                  ? "bg-sky-700 text-white shadow-xs"
                  : "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200"
              }`}
            >
              📄 1. Danh sách Phiếu Nhập / Xuất / Điều chuyển
            </button>
            <button
              type="button"
              onClick={() => {
                setSubMode("LEDGER_TRACE");
                setPage(1);
              }}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                subMode === "LEDGER_TRACE"
                  ? "bg-indigo-700 text-white shadow-xs"
                  : "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200"
              }`}
            >
              📊 2. Tra cứu Hàng Mua Về: Nhập Kho Tổng &amp; Lịch sử Cấp phát (Sổ cái Thẻ Kho)
            </button>
          </div>
          {canCreate && !creating && (
            <Button onClick={() => setCreating(true)}>+ Lập Phiếu Kho / Cấp phát Liên kho</Button>
          )}
        </div>

        {/* Quick Warehouse Filter Pills (Theo dõi riêng từng kho) */}
        <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-slate-100 dark:border-slate-800">
          <span className="text-[11px] font-bold text-slate-500 mr-1">🏭 Xem theo Kho:</span>
          <button
            type="button"
            onClick={() => {
              setWarehouseId("");
              setPage(1);
            }}
            className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition cursor-pointer ${
              warehouseId === ""
                ? "bg-sky-700 text-white border-sky-700"
                : "bg-slate-50 dark:bg-slate-800/70 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700"
            }`}
          >
            🌐 Tất cả các kho ({warehouses.length})
          </button>
          {warehouses.map((w) => (
            <button
              key={w.id}
              type="button"
              onClick={() => {
                setWarehouseId(w.id);
                setPage(1);
              }}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition cursor-pointer ${
                warehouseId === w.id
                  ? "bg-sky-700 text-white border-sky-700"
                  : "bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-sky-400"
              }`}
            >
              {w.code === "KHO-TONG" ? "🏢 " : "📦 "}
              {w.code} — {w.name}
            </button>
          ))}
        </div>

        {/* Flow Quick Filter Pills + Search Box */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
          <div className="flex flex-wrap items-center gap-1.5">
            {FLOW_TABS.map((ft) => (
              <button
                key={ft.key}
                type="button"
                onClick={() => {
                  setFlow(ft.key);
                  setDocType("");
                  setPage(1);
                }}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold border transition cursor-pointer ${
                  flow === ft.key
                    ? "bg-amber-500 text-slate-950 font-bold border-amber-500"
                    : "bg-slate-50 dark:bg-slate-800/60 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700"
                }`}
              >
                {ft.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {focusedItemId && (
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-100 dark:bg-indigo-950/70 px-2.5 py-1 text-xs font-bold text-indigo-800 dark:text-indigo-200 border border-indigo-300 dark:border-indigo-800">
                🎯 Đang lọc vật tư: {focusedItemLabel}
                <button
                  type="button"
                  onClick={() => {
                    setFocusedItemId("");
                    setFocusedItemLabel("");
                    setPage(1);
                  }}
                  className="ml-1 text-rose-600 hover:underline cursor-pointer"
                >
                  ✕ Bỏ lọc
                </button>
              </span>
            )}
            <select
              className={`${inputClass} w-44 text-xs`}
              value={docType}
              onChange={(e) => {
                setDocType(e.target.value);
                setFlow("");
                setPage(1);
              }}
              aria-label="Loại phiếu"
            >
              <option value="">Mọi loại phiếu</option>
              {Object.entries(DOC_TYPE).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
            <input
              className={`${inputClass} w-72 text-xs`}
              placeholder="🔍 Tìm mã/tên vật tư, số lô, mã phiếu, kho nhận…"
              value={docQ}
              onChange={(e) => {
                setDocQ(e.target.value);
                setPage(1);
              }}
            />
          </div>
        </div>
      </div>

      {/* ==================== MODE 1: DANH SÁCH PHIẾU NHẬP / XUẤT / ĐIỀU CHUYỂN ==================== */}
      {subMode === "DOCUMENTS" && (
        <Card title="Danh sách Phiếu Nhập / Xuất / Điều chuyển Liên Kho (Kèm Chi tiết Vật tư & Lô)">
          <ErrorNote error={list.error} />
          {list.data && rows.length === 0 && <Empty>Chưa có phiếu kho phù hợp với bộ lọc hiện tại.</Empty>}
          {rows.length > 0 && (
            <>
              <Table
                head={[
                  "Mã phiếu",
                  "Loại & Nghiệp vụ",
                  "Luồng Kho (Từ ➔ Đến)",
                  "Chi tiết Vật tư / Hóa chất & Số Lô",
                  "Số lượng",
                  "Người lập & Ngày giờ",
                  "Trạng thái",
                ]}
              >
                {rows.map((d) => {
                  const previewLines: DocLinePreview[] = Array.isArray(d.lines_preview) ? d.lines_preview : [];
                  const firstLine = previewLines[0];
                  return (
                    <tr
                      key={d.id}
                      className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50 align-top border-b border-slate-100 dark:border-slate-800/60"
                      onClick={() => setSelected(d.id)}
                    >
                      <td className="py-2.5 pr-3 font-mono font-bold text-xs text-sky-700 dark:text-sky-400 whitespace-nowrap">
                        {d.code}
                      </td>
                      <td className="py-2.5 pr-3 text-xs">
                        <div className="font-bold text-slate-900 dark:text-slate-100">
                          {DOC_TYPE[d.doc_type] ?? d.doc_type}
                        </div>
                        <div className="text-[11px] text-slate-500">
                          {REASON_VI_LABEL[d.reason_code] ?? d.reason_code}
                        </div>
                        {d.notes && (
                          <div className="text-[11px] text-amber-700 dark:text-amber-400 mt-0.5 line-clamp-1">
                            📝 {d.notes}
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 pr-3 whitespace-nowrap">
                        {renderWarehouseFlow(d.doc_type, d.warehouse_code, firstLine)}
                      </td>
                      <td className="py-2.5 pr-3 text-xs min-w-[250px]">
                        {previewLines.length === 0 ? (
                          <span className="text-slate-400">({d.line_count} dòng)</span>
                        ) : (
                          <div className="space-y-1">
                            {previewLines.slice(0, 3).map((ln) => (
                              <div key={ln.line_no} className="flex flex-wrap items-center gap-1.5">
                                <span className="font-mono font-bold text-slate-900 dark:text-slate-100">
                                  {ln.item_code}
                                </span>
                                <span className="text-slate-700 dark:text-slate-300">{ln.item_name}</span>
                                {ln.lot_code && (
                                  <span className="font-mono text-[11px] px-1.5 py-0.2 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                                    Lô: {ln.lot_code}
                                  </span>
                                )}
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    openItemTrace(ln.item_id, `${ln.item_code} — ${ln.item_name}`);
                                  }}
                                  className="text-[10px] font-bold text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer"
                                  title="Xem lịch sử Nhập Kho Tổng & Cấp phát của vật tư này"
                                >
                                  [🔍 Lịch sử cấp phát]
                                </button>
                              </div>
                            ))}
                            {previewLines.length > 3 && (
                              <div className="text-[11px] text-slate-400">
                                + {previewLines.length - 3} mặt hàng khác trong phiếu…
                              </div>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 pr-3 text-xs font-mono font-bold whitespace-nowrap">
                        {previewLines.length === 0 ? (
                          `${d.line_count} dòng`
                        ) : (
                          <div className="space-y-1">
                            {previewLines.slice(0, 3).map((ln) => (
                              <div
                                key={ln.line_no}
                                className={
                                  d.doc_type === "RECEIPT" || d.doc_type === "RETURN"
                                    ? "text-emerald-700 dark:text-emerald-400"
                                    : d.doc_type === "ISSUE"
                                      ? "text-rose-700 dark:text-rose-400"
                                      : "text-sky-700 dark:text-sky-400"
                                }
                              >
                                {d.doc_type === "RECEIPT" || d.doc_type === "RETURN"
                                  ? "+"
                                  : d.doc_type === "ISSUE"
                                    ? "-"
                                    : "➔ "}
                                {fmtQty(ln.qty)} {ln.uom}
                              </div>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 pr-3 text-xs whitespace-nowrap">
                        <div className="font-semibold text-slate-800 dark:text-slate-200">
                          {d.created_by_name ?? "Hệ thống"}
                        </div>
                        <div className="text-[11px] text-slate-400">
                          {new Date(d.posted_at ?? d.created_at).toLocaleString("vi-VN", {
                            timeZone: "Asia/Ho_Chi_Minh",
                            dateStyle: "short",
                            timeStyle: "short",
                          })}
                        </div>
                      </td>
                      <td className="py-2.5 pr-3">
                        <StatusBadge status={DOC_STATUS[d.status][0]} label={DOC_STATUS[d.status][1]} />
                      </td>
                    </tr>
                  );
                })}
              </Table>
              <Pager page={list.data?.page ?? page} pageSize={list.data?.page_size ?? 50} total={total} onPage={setPage} />
            </>
          )}
        </Card>
      )}

      {/* ==================== MODE 2: SỔ CÁI THẺ KHO & TRUY VẾT NHẬP KHO TỔNG -> CẤP PHÁT KHO NHÁNH ==================== */}
      {subMode === "LEDGER_TRACE" && (
        <>
          {/* Section A: Item-level Summary of Receipts into Main Warehouse -> Distributed to Branch Warehouses -> Current Stock */}
          <Card title="1️⃣ Tổng hợp Vòng đời Vật tư: Nhập Kho Tổng ➔ Cấp phát sang các Kho Nhánh ➔ Xuất tiêu hao ➔ Tồn hiện tại">
            {itemSummaries.length === 0 ? (
              <Empty>Không tìm thấy mặt hàng nào khớp từ khóa.</Empty>
            ) : (
              <Table
                head={[
                  "Mã & Tên Vật tư / Hóa chất",
                  "📥 Tổng Nhập Mua / Pha chế",
                  "📦 Tồn đầu kỳ",
                  "🚚 Đã Cấp phát sang Kho Nhánh",
                  "📤 Đã Xuất tiêu hao SX",
                  "🏭 Tồn hiện tại theo từng Kho",
                  "Truy vết",
                ]}
              >
                {itemSummaries.map((it) => (
                  <tr
                    key={it.item_id}
                    className={`border-b border-slate-100 dark:border-slate-800/60 align-top text-xs ${
                      focusedItemId === it.item_id ? "bg-indigo-50/70 dark:bg-indigo-950/30" : ""
                    }`}
                  >
                    <td className="py-2.5 pr-3">
                      <div className="font-mono font-bold text-slate-900 dark:text-slate-100">{it.item_code}</div>
                      <div className="text-slate-600 dark:text-slate-300">{it.item_name}</div>
                    </td>
                    <td className="py-2.5 pr-3 font-mono font-bold text-emerald-700 dark:text-emerald-400 whitespace-nowrap">
                      {it.qty_purchased_in > 0 ? `+${fmtQty(it.qty_purchased_in)} ${it.base_uom}` : "—"}
                    </td>
                    <td className="py-2.5 pr-3 font-mono text-slate-500 whitespace-nowrap">
                      {it.qty_opening_in > 0 ? `${fmtQty(it.qty_opening_in)} ${it.base_uom}` : "—"}
                    </td>
                    <td className="py-2.5 pr-3">
                      {Array.isArray(it.distributed_by_wh) && it.distributed_by_wh.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {it.distributed_by_wh.map((d, idx) => (
                            <span
                              key={idx}
                              className="inline-flex items-center rounded-md bg-sky-100 dark:bg-sky-950/70 px-1.5 py-0.5 font-mono text-[11px] font-bold text-sky-800 dark:text-sky-300 border border-sky-200 dark:border-sky-800"
                            >
                              ➔ {d.to_wh}: {fmtQty(d.qty)} {it.base_uom}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-slate-400">Chưa cấp phát liên kho</span>
                      )}
                    </td>
                    <td className="py-2.5 pr-3 font-mono font-semibold text-rose-700 dark:text-rose-400 whitespace-nowrap">
                      {it.qty_issued_out > 0 ? `-${fmtQty(it.qty_issued_out)} ${it.base_uom}` : "—"}
                    </td>
                    <td className="py-2.5 pr-3">
                      {Array.isArray(it.balance_by_wh) && it.balance_by_wh.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {it.balance_by_wh.map((b, idx) => (
                            <span
                              key={idx}
                              className="inline-flex items-center rounded-md bg-emerald-50 dark:bg-emerald-950/60 px-1.5 py-0.5 font-mono text-[11px] font-bold text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800"
                            >
                              {b.wh_code}: {fmtQty(b.qty_on_hand)} {it.base_uom}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-slate-400">Hết tồn</span>
                      )}
                    </td>
                    <td className="py-2.5 pr-2 whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() =>
                          focusedItemId === it.item_id
                            ? (setFocusedItemId(""), setFocusedItemLabel(""))
                            : openItemTrace(it.item_id, `${it.item_code} — ${it.item_name}`)
                        }
                        className="px-2.5 py-1 rounded-lg text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white cursor-pointer"
                      >
                        {focusedItemId === it.item_id ? "Đang xem ✓" : "🔍 Xem lịch sử"}
                      </button>
                    </td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>

          {/* Section B: Chronological Stock Movement Ledger */}
          <Card
            title={
              focusedItemLabel
                ? `2️⃣ Sổ cái Lịch sử Nhập Kho & Cấp phát chi tiết của: ${focusedItemLabel}`
                : "2️⃣ Sổ cái Lịch sử Giao dịch Nhập Kho Tổng – Cấp phát Kho Nhánh – Xuất tiêu hao (Theo thời gian)"
            }
          >
            <ErrorNote error={list.error} />
            {rows.length === 0 ? (
              <Empty>Chưa có dòng lịch sử giao dịch nào khớp bộ lọc.</Empty>
            ) : (
              <>
                <Table
                  head={[
                    "Ngày giờ",
                    "Mã phiếu",
                    "Nghiệp vụ",
                    "Vật tư / Hóa chất",
                    "Số Lô (Lot) / NCC",
                    "Từ Kho · Vị trí ➔ Đến Kho · Vị trí",
                    "Số lượng",
                    "Người thực hiện",
                  ]}
                >
                  {rows.map((mv) => (
                    <tr
                      key={mv.line_id}
                      onClick={() => setSelected(mv.document_id)}
                      className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50 border-b border-slate-100 dark:border-slate-800/60 text-xs align-top"
                    >
                      <td className="py-2.5 pr-3 whitespace-nowrap text-slate-500">
                        {new Date(mv.occurred_at).toLocaleString("vi-VN", {
                          timeZone: "Asia/Ho_Chi_Minh",
                          dateStyle: "short",
                          timeStyle: "short",
                        })}
                      </td>
                      <td className="py-2.5 pr-3 font-mono font-bold text-sky-700 dark:text-sky-400 whitespace-nowrap">
                        {mv.document_code}
                      </td>
                      <td className="py-2.5 pr-3">
                        <div className="font-bold text-slate-900 dark:text-slate-100">
                          {REASON_VI_LABEL[mv.reason_code] ?? mv.reason_code}
                        </div>
                        {mv.notes && <div className="text-[11px] text-slate-500">{mv.notes}</div>}
                      </td>
                      <td className="py-2.5 pr-3">
                        <span className="font-mono font-bold text-slate-900 dark:text-slate-100">{mv.item_code}</span> —{" "}
                        <span>{mv.item_name}</span>
                      </td>
                      <td className="py-2.5 pr-3 font-mono">
                        <div>{mv.lot_code ?? "—"}</div>
                        {mv.mfr_lot_no && <div className="text-[10px] text-slate-400">NSX: {mv.mfr_lot_no}</div>}
                        {mv.supplier_name && <div className="text-[10px] text-emerald-700 dark:text-emerald-400">NCC: {mv.supplier_name}</div>}
                      </td>
                      <td className="py-2.5 pr-3 whitespace-nowrap">
                        {renderWarehouseFlow(mv.doc_type, mv.doc_warehouse_code, mv)}
                      </td>
                      <td
                        className={`py-2.5 pr-3 font-mono font-bold whitespace-nowrap ${
                          mv.doc_type === "RECEIPT" || mv.doc_type === "RETURN"
                            ? "text-emerald-700 dark:text-emerald-400"
                            : mv.doc_type === "ISSUE"
                              ? "text-rose-700 dark:text-rose-400"
                              : "text-sky-700 dark:text-sky-400"
                        }`}
                      >
                        {mv.doc_type === "RECEIPT" || mv.doc_type === "RETURN"
                          ? "+"
                          : mv.doc_type === "ISSUE"
                            ? "-"
                            : "➔ "}
                        {fmtQty(mv.qty)} {mv.uom}
                      </td>
                      <td className="py-2.5 pr-3 whitespace-nowrap">{mv.performed_by_name ?? "Hệ thống"}</td>
                    </tr>
                  ))}
                </Table>
                <Pager page={list.data?.page ?? page} pageSize={list.data?.page_size ?? 50} total={total} onPage={setPage} />
              </>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

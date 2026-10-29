"use client";

import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ActionBar, type AllowedAction } from "../actions";
import { api, fmtQty } from "../api";
import { Button, Card, Empty, ErrorNote, Field, inputClass, StatusBadge, Table } from "../ui";

const DOC_TYPE: Record<string, string> = { RECEIPT: "Nhập", RETURN: "Nhập trả", ISSUE: "Xuất", TRANSFER: "Chuyển vị trí", ADJUSTMENT: "Điều chỉnh", COUNT_ADJUST: "Điều chỉnh kiểm kê" };
const REASONS: Record<"ISSUE" | "TRANSFER" | "ADJUSTMENT", Record<string, string>> = {
  ISSUE: { PRODUCTION: "Xuất cho sản xuất", RND: "Xuất cho R&D", QC_SAMPLE: "Mẫu QC", SCRAP: "Hủy", RETURN_TO_SUPPLIER: "Trả nhà cung cấp", OTHER: "Khác" },
  TRANSFER: { PUTAWAY: "Đưa lên kệ", RELOCATE: "Đổi vị trí" },
  ADJUSTMENT: { COUNT_DIFF: "Chênh lệch kiểm đếm", DAMAGE: "Hư hỏng", OTHER: "Khác" },
};
const DOC_STATUS: Record<string, [string, string]> = { DRAFT: ["PENDING_QC", "Nháp"], POSTED: ["RELEASED", "Đã ghi sổ"], CANCELLED: ["EXPIRED", "Đã hủy"], REVERSED: ["ON_HOLD", "Đã đảo"] };
const NEEDS_NOTES = new Set(["SCRAP", "RETURN_TO_SUPPLIER", "OTHER", "COUNT_DIFF", "DAMAGE"]);

interface StockRow {
  id: string; item_id: string; location_id: string; lot_id: string | null; item_code: string; item_name: string; base_uom: string;
  lot_code: string | null; lot_status: string | null; location_code: string; qty_available: string; qty_on_hand: string;
}
interface Loc { id: string; code: string; name: string; is_quarantine: boolean }
interface DraftLine { row: StockRow; qty: string; to_location_id: string; direction: "OUT" | "IN" }

function NewDocumentForm({ warehouseId, onDone }: { warehouseId: string; onDone: () => void }) {
  const qc = useQueryClient();
  const [type, setType] = useState<"ISSUE" | "TRANSFER" | "ADJUSTMENT">("ISSUE");
  const [reason, setReason] = useState("PRODUCTION");
  const [notes, setNotes] = useState("");
  const [q, setQ] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([]);
  const stock = useQuery({
    queryKey: ["factory", "stock", "pick", warehouseId, q],
    queryFn: () => api<{ rows: StockRow[] }>(`/api/factory/inv/stock?warehouse_id=${warehouseId}&page_size=30${q ? `&q=${encodeURIComponent(q)}` : ""}`),
  });
  const locs = useQuery({ queryKey: ["factory", "locations", warehouseId], queryFn: () => api<Loc[]>(`/api/factory/master/warehouses/${warehouseId}/locations`) });
  const save = useMutation({
    mutationFn: () => {
      const enriched = lines.map((l) => {
        const base = { item_id: l.row.item_id, lot_id: l.row.lot_id, qty: Number(l.qty.replace(",", ".")), uom: l.row.base_uom };
        if (type === "TRANSFER") return { ...base, from_location_id: l.row.location_id, to_location_id: l.to_location_id };
        if (type === "ADJUSTMENT" && l.direction === "IN") return { ...base, to_location_id: l.row.location_id };
        return { ...base, from_location_id: l.row.location_id };
      });
      return api("/api/factory/inv/documents", { method: "POST", idempotent: true, json: { doc_type: type, reason_code: reason, warehouse_id: warehouseId, notes: notes || null, post: true, lines: enriched } });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["factory", "stock"] });
      qc.invalidateQueries({ queryKey: ["factory", "documents"] });
      onDone();
    },
  });
  const setL = (i: number, p: Partial<DraftLine>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...p } : l)));

  return (
    <Card title="Phiếu kho mới (ghi sổ ngay)">
      <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Loại phiếu">
            <select className={inputClass} value={type} onChange={(e) => { const t = e.target.value as typeof type; setType(t); setReason(Object.keys(REASONS[t])[0]); setLines([]); }}>
              <option value="ISSUE">Xuất kho</option>
              <option value="TRANSFER">Chuyển vị trí trong kho</option>
              <option value="ADJUSTMENT">Điều chỉnh tồn</option>
            </select>
          </Field>
          <Field label="Lý do">
            <select className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)}>
              {Object.entries(REASONS[type]).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          <Field label={`Diễn giải${NEEDS_NOTES.has(reason) ? " *" : ""}`}>
            <input className={inputClass} value={notes} onChange={(e) => setNotes(e.target.value)} required={NEEDS_NOTES.has(reason)} />
          </Field>
        </div>
        <div>
          <input className={inputClass} placeholder="Tìm tồn theo mã, tên vật tư, số lô… rồi bấm dòng để thêm" value={q} onChange={(e) => setQ(e.target.value)} />
          <ul className="mt-1 max-h-48 overflow-auto rounded-xl border border-slate-200 dark:border-slate-800 text-xs">
            {stock.data?.rows.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  className="w-full text-left px-3 py-1.5 hover:bg-sky-50 dark:hover:bg-sky-950/40 cursor-pointer"
                  onClick={() => setLines([...lines, { row: r, qty: "", to_location_id: "", direction: "OUT" }])}
                >
                  {r.item_code} · lô {r.lot_code ?? "—"} · {r.location_code} · khả dụng {fmtQty(r.qty_available)} {r.base_uom}
                  {r.lot_status && r.lot_status !== "RELEASED" && <span className="text-amber-600"> ({r.lot_status})</span>}
                </button>
              </li>
            ))}
          </ul>
        </div>
        {lines.length > 0 && (
          <Table head={["Vật tư / lô / vị trí", "Số lượng (ĐVT gốc)", type === "TRANSFER" ? "Đến vị trí" : type === "ADJUSTMENT" ? "Hướng" : "", ""]}>
            {lines.map((l, i) => (
              <tr key={i}>
                <td className="py-2 pr-3">{l.row.item_code} · {l.row.lot_code ?? "—"} · {l.row.location_code}</td>
                <td className="py-2 pr-3 w-36"><input className={inputClass} inputMode="decimal" value={l.qty} onChange={(e) => setL(i, { qty: e.target.value })} required /></td>
                <td className="py-2 pr-3 w-52">
                  {type === "TRANSFER" && (
                    <select className={inputClass} value={l.to_location_id} onChange={(e) => setL(i, { to_location_id: e.target.value })} required>
                      <option value="">Chọn vị trí</option>
                      {locs.data?.filter((x) => x.code !== l.row.location_code).map((x) => <option key={x.id} value={x.id}>{x.code} — {x.name}{x.is_quarantine ? " (biệt trữ)" : ""}</option>)}
                    </select>
                  )}
                  {type === "ADJUSTMENT" && (
                    <select className={inputClass} value={l.direction} onChange={(e) => setL(i, { direction: e.target.value as "OUT" | "IN" })}>
                      <option value="OUT">Giảm tồn</option>
                      <option value="IN">Tăng tồn</option>
                    </select>
                  )}
                </td>
                <td className="py-2 pr-3"><button type="button" className="text-rose-600 text-xs cursor-pointer" onClick={() => setLines(lines.filter((_, j) => j !== i))}>Xóa</button></td>
              </tr>
            ))}
          </Table>
        )}
        <ErrorNote error={save.error ?? stock.error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onDone}>Hủy</Button>
          <Button type="submit" disabled={save.isPending || !lines.length}>{save.isPending ? "Đang ghi sổ…" : "Ghi sổ phiếu"}</Button>
        </div>
      </form>
    </Card>
  );
}

interface DocDetail {
  id: string; code: string; doc_type: string; reason_code: string; status: string; version: number; warehouse_code: string; notes: string | null; reversal_of_id: string | null;
  lines: { line_no: number; item_code: string; item_name: string; lot_code: string | null; from_code: string | null; to_code: string | null; qty: string; uom: string }[];
  actions: AllowedAction[];
}

function DocumentDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();
  const doc = useQuery({ queryKey: ["factory", "document", id], queryFn: () => api<DocDetail>(`/api/factory/inv/documents/${id}`) });
  const d = doc.data;
  return (
    <Card title={d ? `Phiếu ${d.code} — ${DOC_TYPE[d.doc_type]} (${d.reason_code})` : "Phiếu kho"} actions={<Button variant="ghost" onClick={onClose}>Đóng</Button>}>
      <ErrorNote error={doc.error} />
      {d && (
        <div className="flex flex-col gap-3">
          <p className="text-xs"><StatusBadge status={DOC_STATUS[d.status][0]} label={DOC_STATUS[d.status][1]} /> · Kho {d.warehouse_code}{d.notes && <> · {d.notes}</>}{d.reversal_of_id && " · phiếu đảo"}</p>
          <Table head={["#", "Vật tư", "Lô", "Từ", "Đến", "Số lượng"]}>
            {d.lines.map((l) => (
              <tr key={l.line_no}>
                <td className="py-2 pr-3">{l.line_no}</td>
                <td className="py-2 pr-3">{l.item_code} — {l.item_name}</td>
                <td className="py-2 pr-3 font-mono">{l.lot_code ?? "—"}</td>
                <td className="py-2 pr-3">{l.from_code ?? "—"}</td>
                <td className="py-2 pr-3">{l.to_code ?? "—"}</td>
                <td className="py-2 pr-3 whitespace-nowrap">{fmtQty(l.qty)} {l.uom}</td>
              </tr>
            ))}
          </Table>
          <ActionBar endpoint={`/api/factory/inv/documents/${d.id}/actions`} version={d.version} actions={d.actions} labels={{ post: "Ghi sổ", cancel: "Hủy nháp", reverse: "Đảo phiếu" }} onDone={() => { qc.invalidateQueries({ queryKey: ["factory", "document", id] }); qc.invalidateQueries({ queryKey: ["factory", "documents"] }); qc.invalidateQueries({ queryKey: ["factory", "stock"] }); }} />
        </div>
      )}
    </Card>
  );
}

export function DocumentsView({ warehouses, canCreate }: { warehouses: { id: string; code: string; name: string }[]; canCreate: boolean }) {
  const [warehouseId, setWarehouseId] = useState("");
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const list = useQuery({
    queryKey: ["factory", "documents", warehouseId],
    queryFn: () => api<{ id: string; code: string; doc_type: string; reason_code: string; status: string; posted_at: string | null; created_at: string; warehouse_code: string; created_by_name: string | null; line_count: number }[]>(`/api/factory/inv/documents${warehouseId ? `?warehouse_id=${warehouseId}` : ""}`),
  });
  return (
    <div className="flex flex-col gap-3">
      {creating && warehouseId && <NewDocumentForm warehouseId={warehouseId} onDone={() => setCreating(false)} />}
      {selected && <DocumentDetail key={selected} id={selected} onClose={() => setSelected(null)} />}
      <Card
        title="Phiếu kho"
        actions={
          <>
            <select className={`${inputClass} w-56`} value={warehouseId} onChange={(e) => { setWarehouseId(e.target.value); setCreating(false); }} aria-label="Kho">
              <option value="">Tất cả kho được xem</option>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} — {w.name}</option>)}
            </select>
            {canCreate && !creating && (
              <Button disabled={!warehouseId} title={warehouseId ? "" : "Chọn kho trước"} onClick={() => setCreating(true)}>+ Phiếu mới</Button>
            )}
          </>
        }
      >
        <ErrorNote error={list.error} />
        {list.data?.length === 0 && <Empty>Chưa có phiếu kho.</Empty>}
        {list.data && list.data.length > 0 && (
          <Table head={["Mã", "Loại", "Lý do", "Kho", "Dòng", "Người lập", "Ngày", "Trạng thái"]}>
            {list.data.map((d) => (
              <tr key={d.id} className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50" onClick={() => setSelected(d.id)}>
                <td className="py-2 pr-3 font-mono font-semibold text-sky-700 dark:text-sky-400">{d.code}</td>
                <td className="py-2 pr-3">{DOC_TYPE[d.doc_type]}</td>
                <td className="py-2 pr-3">{d.reason_code}</td>
                <td className="py-2 pr-3">{d.warehouse_code}</td>
                <td className="py-2 pr-3">{d.line_count}</td>
                <td className="py-2 pr-3">{d.created_by_name ?? "Hệ thống"}</td>
                <td className="py-2 pr-3 whitespace-nowrap">{new Date(d.posted_at ?? d.created_at).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", dateStyle: "short", timeStyle: "short" })}</td>
                <td className="py-2 pr-3"><StatusBadge status={DOC_STATUS[d.status][0]} label={DOC_STATUS[d.status][1]} /></td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}

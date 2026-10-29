"use client";

import React, { useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, fmtQty } from "../api";
import { Button, Card, Empty, ErrorNote, Field, inputClass, Pager, StatusBadge, Table } from "../ui";

const ITEM_TYPE_LABEL: Record<string, string> = {
  RAW_MATERIAL: "Nguyên liệu",
  REAGENT: "Hóa chất / thuốc thử",
  CONSUMABLE: "Vật tư tiêu hao",
  COMPONENT: "Linh kiện",
  SEMI_FINISHED: "Bán thành phẩm",
  FINISHED_KIT: "Kit thành phẩm",
  DEVICE: "Thiết bị",
  OLIGO_SERVICE: "Dịch vụ Oligo",
  SPARE_PART: "Phụ tùng",
};
const TRACKING_LABEL: Record<string, string> = { NONE: "Không theo lô", LOT: "Theo lô", SERIAL: "Theo serial" };
const STORAGE_LABEL: Record<string, string> = { RT: "Nhiệt độ phòng", "2-8": "2–8 °C", "-20": "−20 °C", "-80": "−80 °C" };

interface ItemRow {
  id: string;
  code: string;
  name: string;
  item_type: string;
  base_uom: string;
  tracking: string;
  storage_condition: string;
  min_stock: string;
  receipt_qc_required: boolean;
  status: string;
  version: number;
  kd_item_code: string | null;
  kd_unit: string | null;
  kd_unit_factor: string;
}

/** Links the item to the Kinh doanh product code used on internal POs, and how many base units one KD unit holds. */
function KdMapping({ item }: { item: ItemRow }) {
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: (patch: { kd_item_code: string | null; kd_unit: string | null; kd_unit_factor: number }) =>
      api(`/api/factory/master/items/${item.id}`, { method: "PATCH", json: { version: item.version, ...patch, reason: "Gắn mã hàng Kinh doanh" } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["factory", "items"] }),
    onError: (e) => window.alert((e as Error).message),
  });
  return (
    <button
      className="text-sky-700 dark:text-sky-400 underline underline-offset-2 cursor-pointer"
      onClick={() => {
        const code = window.prompt("Mã hàng bên Kinh doanh (để trống để bỏ liên kết):", item.kd_item_code ?? "");
        if (code === null) return;
        const unit = code ? window.prompt("Đơn vị Kinh doanh đặt (ví dụ Hộp, Kit):", item.kd_unit ?? "") : "";
        if (unit === null) return;
        const factor = code ? window.prompt(`1 ${unit || "đơn vị KD"} bằng bao nhiêu ${item.base_uom}?`, String(Number(item.kd_unit_factor) || 1)) : "1";
        if (factor === null) return;
        save.mutate({ kd_item_code: code.trim() || null, kd_unit: unit?.trim() || null, kd_unit_factor: Number(factor.replace(",", ".")) || 1 });
      }}
    >
      {item.kd_item_code ? `${item.kd_item_code} (1 ${item.kd_unit ?? "ĐV"} = ${fmtQty(item.kd_unit_factor)} ${item.base_uom})` : "Gắn mã KD"}
    </button>
  );
}

const emptyForm = { code: "", name: "", item_type: "REAGENT", base_uom: "", tracking: "LOT", storage_condition: "RT", shelf_life_days: "", min_stock: "0", receipt_qc_required: true };

function NewItemForm({ onDone }: { onDone: () => void }) {
  const [form, setForm] = useState(emptyForm);
  const uoms = useQuery({ queryKey: ["factory", "uoms"], queryFn: () => api<{ code: string; name: string }[]>("/api/factory/master/uoms") });
  const qc = useQueryClient();
  const create = useMutation({
    mutationFn: () =>
      api("/api/factory/master/items", {
        method: "POST",
        idempotent: true,
        json: { ...form, code: form.code || undefined, shelf_life_days: form.shelf_life_days ? Number(form.shelf_life_days) : null, min_stock: Number(form.min_stock || 0) },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["factory", "items"] });
      setForm(emptyForm);
      onDone();
    },
  });
  const set = (k: keyof typeof emptyForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm({ ...form, [k]: e.target.type === "checkbox" ? (e.target as HTMLInputElement).checked : e.target.value });

  return (
    <form
      className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 mb-4 p-3 rounded-xl bg-slate-50 dark:bg-slate-950/50 border border-slate-200 dark:border-slate-800"
      onSubmit={(e) => {
        e.preventDefault();
        create.mutate();
      }}
    >
      <Field label="Mã vật tư" hint="Để trống: hệ thống tự cấp (VT00001…)">
        <input className={inputClass} value={form.code} onChange={set("code")} />
      </Field>
      <Field label="Tên vật tư *">
        <input className={inputClass} value={form.name} onChange={set("name")} required />
      </Field>
      <Field label="Loại">
        <select className={inputClass} value={form.item_type} onChange={set("item_type")}>
          {Object.entries(ITEM_TYPE_LABEL).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
      </Field>
      <Field label="Đơn vị gốc *" hint="Không đổi được sau khi đã có tồn kho">
        <select className={inputClass} value={form.base_uom} onChange={set("base_uom")} required>
          <option value="">Chọn đơn vị</option>
          {uoms.data?.map((u) => (
            <option key={u.code} value={u.code}>{u.code} — {u.name}</option>
          ))}
        </select>
      </Field>
      <Field label="Quản lý">
        <select className={inputClass} value={form.tracking} onChange={set("tracking")}>
          {Object.entries(TRACKING_LABEL).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
      </Field>
      <Field label="Bảo quản">
        <select className={inputClass} value={form.storage_condition} onChange={set("storage_condition")}>
          {Object.entries(STORAGE_LABEL).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
      </Field>
      <Field label="Hạn dùng (ngày)">
        <input className={inputClass} type="number" min={1} value={form.shelf_life_days} onChange={set("shelf_life_days")} />
      </Field>
      <Field label="Tồn tối thiểu">
        <input className={inputClass} type="number" min={0} step="any" value={form.min_stock} onChange={set("min_stock")} />
      </Field>
      <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300 sm:col-span-2">
        <input type="checkbox" checked={form.receipt_qc_required} onChange={set("receipt_qc_required")} />
        Bắt buộc QC khi nhận hàng (lô chỉ được dùng sau khi QA giải phóng)
      </label>
      <div className="flex items-end justify-end gap-2 sm:col-span-2">
        <Button type="button" variant="ghost" onClick={onDone}>Hủy</Button>
        <Button type="submit" disabled={create.isPending}>{create.isPending ? "Đang lưu…" : "Lưu vật tư"}</Button>
      </div>
      <div className="sm:col-span-2 lg:col-span-4"><ErrorNote error={create.error} /></div>
    </form>
  );
}

export function ItemsView({ canManage }: { canManage: boolean }) {
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);
  const params = new URLSearchParams({ page: String(page), page_size: "50", ...(q.trim() ? { q: q.trim() } : {}) });
  const items = useQuery({
    queryKey: ["factory", "items", params.toString()],
    queryFn: () => api<{ rows: ItemRow[]; total: number; page: number; page_size: number }>(`/api/factory/master/items?${params}`),
    placeholderData: keepPreviousData,
  });

  return (
    <Card
      title="Danh mục vật tư"
      actions={
        <>
          <input className={`${inputClass} w-56`} placeholder="Tìm mã hoặc tên…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
          {canManage && !adding && <Button onClick={() => setAdding(true)}>+ Thêm vật tư</Button>}
        </>
      }
    >
      {adding && <NewItemForm onDone={() => setAdding(false)} />}
      <ErrorNote error={items.error} />
      {items.data && items.data.rows.length === 0 && <Empty>Chưa có vật tư nào.</Empty>}
      {items.data && items.data.rows.length > 0 && (
        <>
          <Table head={["Mã", "Tên", "Loại", "ĐVT gốc", "Quản lý", "Bảo quản", "Tồn tối thiểu", "QC nhận hàng", "Mã hàng KD", "Trạng thái"]}>
            {items.data.rows.map((r) => (
              <tr key={r.id}>
                <td className="py-2 pr-3 font-mono font-semibold whitespace-nowrap">{r.code}</td>
                <td className="py-2 pr-3">{r.name}</td>
                <td className="py-2 pr-3 whitespace-nowrap">{ITEM_TYPE_LABEL[r.item_type] ?? r.item_type}</td>
                <td className="py-2 pr-3">{r.base_uom}</td>
                <td className="py-2 pr-3 whitespace-nowrap">{TRACKING_LABEL[r.tracking]}</td>
                <td className="py-2 pr-3 whitespace-nowrap">{STORAGE_LABEL[r.storage_condition]}</td>
                <td className="py-2 pr-3 text-right">{fmtQty(r.min_stock)}</td>
                <td className="py-2 pr-3">{r.receipt_qc_required ? "Có" : "Không"}</td>
                <td className="py-2 pr-3 whitespace-nowrap">{canManage ? <KdMapping item={r} /> : r.kd_item_code ?? "—"}</td>
                <td className="py-2 pr-3"><StatusBadge status={r.status === "ACTIVE" ? "RELEASED" : "EXPIRED"} label={r.status === "ACTIVE" ? "Đang dùng" : "Ngừng"} /></td>
              </tr>
            ))}
          </Table>
          <Pager page={items.data.page} pageSize={items.data.page_size} total={items.data.total} onPage={setPage} />
        </>
      )}
    </Card>
  );
}

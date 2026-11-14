"use client";

import React, { useMemo, useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, fmtQty, useDebouncedValue } from "../api";
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

function isPlaceholderUomClient(raw: string | null | undefined): boolean {
  const s = String(raw ?? "").trim();
  if (!s) return true;
  return /^([-\u2013\u2014]+|n\/?a|none|null|\?)$/i.test(s);
}

interface UomOption {
  code: string;
  name: string;
  dimension: string;
}

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
  has_stock?: boolean;
}

interface ConversionRow {
  id: string;
  from_uom: string;
  to_uom: string;
  factor: number;
  item_id: string | null;
  item_code: string | null;
  item_name: string | null;
  item_base_uom: string | null;
  is_builtin_metric: boolean;
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

function BaseUomModal({
  item,
  uoms,
  onClose,
}: {
  item: ItemRow;
  uoms: UomOption[];
  onClose: () => void;
}) {
  const isMissing = isPlaceholderUomClient(item.base_uom);
  const [newUom, setNewUom] = useState(isMissing ? "µL" : item.base_uom);
  const [mode, setMode] = useState<"RELABEL_1_TO_1" | "RESCALE_STOCK">("RELABEL_1_TO_1");
  const [reason, setReason] = useState(
    isMissing ? 'Chuẩn hóa ĐVT gốc từ "-" sang đơn vị chuẩn thực tế' : ""
  );
  const qc = useQueryClient();

  const save = useMutation({
    mutationFn: () =>
      api(`/api/factory/master/items/${item.id}`, {
        method: "PATCH",
        json: {
          version: item.version,
          base_uom: newUom,
          uom_change_mode: item.has_stock ? mode : "STRICT",
          reason: reason.trim() || undefined,
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["factory", "items"] });
      qc.invalidateQueries({ queryKey: ["factory", "stock"] });
      onClose();
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
      <div className="w-full max-w-lg rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xl p-5 space-y-4">
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-3">
          <div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
              Đổi / Chuẩn hóa ĐVT gốc trong Kho — <span className="font-mono text-sky-700 dark:text-sky-400">{item.code}</span>
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{item.name}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 text-sm font-bold cursor-pointer px-2 py-1"
          >
            ✕
          </button>
        </div>

        <div className="rounded-xl border border-sky-200 dark:border-sky-900/70 bg-sky-50/80 dark:bg-sky-950/30 p-3 text-xs text-sky-900 dark:text-sky-200 space-y-1">
          <div className="font-bold">💡 Gợi ý chọn ĐVT gốc đúng chuẩn Lab &amp; Production:</div>
          <div>
            • Hệ thống đã tích hợp sẵn quy đổi <b>2 chiều tự động</b>:{" "}
            <span className="font-mono font-semibold">1 L = 1.000 mL = 1.000.000 µL</span> và{" "}
            <span className="font-mono font-semibold">1 kg = 1.000 g = 1.000.000 mg = 1.000.000.000 µg</span>.
          </div>
          <div>
            • Do đó, nếu Kho quản lý bằng <b>µL</b> (hoặc <b>mL</b>) trong khi Công thức BOM ghi <b>mL</b> (hoặc <b>µL</b>), hệ thống sẽ tự động quy đổi khi phát hành lệnh — <b>không cần sửa lại BOM</b>.
          </div>
          <div>
            • Nếu Kho quản lý theo <b>Ống (<span className="font-mono">tube</span>) / Lọ (<span className="font-mono">vial</span>) / Chai (<span className="font-mono">bottle</span>)</b>, chọn ĐVT gốc là <span className="font-mono">tube</span> rồi bấm <b>⚖️ Quy đổi</b> để khai báo (VD: <span className="font-mono">1 tube = 0.5 mL</span>).
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl bg-slate-50 dark:bg-slate-950/50 border border-slate-200 dark:border-slate-800 px-3 py-2 text-xs">
            <div className="text-slate-500">ĐVT gốc hiện tại</div>
            <div className="mt-0.5 font-mono font-bold text-sm text-rose-600 dark:text-rose-400">
              {item.base_uom} {isMissing ? "(Đang thiếu / lỗi import Excel)" : ""}
            </div>
          </div>
          <Field label="ĐVT gốc chuẩn mới *">
            <select className={inputClass} value={newUom} onChange={(e) => setNewUom(e.target.value)}>
              {uoms.map((u) => (
                <option key={u.code} value={u.code}>
                  {u.code} — {u.name}
                </option>
              ))}
            </select>
          </Field>
        </div>

        {item.has_stock && (
          <div className="rounded-xl border border-amber-200 dark:border-amber-900/70 bg-amber-50/70 dark:bg-amber-950/30 p-3 text-xs space-y-2">
            <div className="font-bold text-amber-900 dark:text-amber-300">
              ⚠️ Vật tư đã phát sinh dữ liệu tồn kho — Chọn cách xử lý số tồn:
            </div>
            <label className="flex items-start gap-2 cursor-pointer text-slate-700 dark:text-slate-200">
              <input
                type="radio"
                name="uom_change_mode"
                checked={mode === "RELABEL_1_TO_1"}
                onChange={() => setMode("RELABEL_1_TO_1")}
                className="mt-0.5"
              />
              <span>
                <b>Cập nhật nhãn ĐVT gốc (giữ nguyên số lượng tồn 1:1)</b>
                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                  Dùng khi file Excel bị thiếu dấu <code className="font-mono">-</code> hoặc nhập sai tên ĐVT (con số tồn kho hiện có đang đúng với ĐVT mới).
                </div>
              </span>
            </label>
            {!isMissing && (
              <label className="flex items-start gap-2 cursor-pointer text-slate-700 dark:text-slate-200">
                <input
                  type="radio"
                  name="uom_change_mode"
                  checked={mode === "RESCALE_STOCK"}
                  onChange={() => setMode("RESCALE_STOCK")}
                  className="mt-0.5"
                />
                <span>
                  <b>Đổi ĐVT gốc kèm nhân quy đổi số lượng tồn kho (× hệ số)</b>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">
                    Hệ thống tự lập phiếu điều chỉnh <code className="font-mono">UOM_REBASE</code> (VD: đang tồn <code className="font-mono">0,5 mL</code> → tự đổi thành <code className="font-mono">500 µL</code>), khớp tuyệt đối sổ cái kho.
                  </div>
                </span>
              </label>
            )}
          </div>
        )}

        <Field label="Lý do thay đổi (lưu Audit Trail ISO 13485)" hint={item.has_stock ? "Bắt buộc khi vật tư đã có tồn kho" : undefined}>
          <input
            className={inputClass}
            placeholder="VD: Sửa dấu '-' do import Excel sang µL"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>

        <ErrorNote error={save.error} />

        <div className="flex items-center justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={onClose}>
            Hủy
          </Button>
          <Button
            type="button"
            disabled={save.isPending || !newUom || newUom === item.base_uom}
            onClick={() => save.mutate()}
          >
            {save.isPending ? "Đang cập nhật…" : "Lưu ĐVT gốc mới"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function UomConversionPanel({
  canManage,
  uoms,
  items,
  preselectedItem,
  onClose,
}: {
  canManage: boolean;
  uoms: UomOption[];
  items: ItemRow[];
  preselectedItem: ItemRow | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [filterText, setFilterText] = useState("");
  const debouncedFilter = useDebouncedValue(filterText, 250);
  const [targetItemId, setTargetItemId] = useState<string>(preselectedItem?.id ?? "");
  const [fromUom, setFromUom] = useState<string>("tube");
  const [factor, setFactor] = useState<string>("0.5");
  const [toUom, setToUom] = useState<string>(
    preselectedItem && !isPlaceholderUomClient(preselectedItem.base_uom) ? preselectedItem.base_uom : "mL"
  );

  React.useEffect(() => {
    if (preselectedItem) {
      setTargetItemId(preselectedItem.id);
      if (!isPlaceholderUomClient(preselectedItem.base_uom)) {
        setToUom(preselectedItem.base_uom);
      }
    }
  }, [preselectedItem]);

  const itemChoices = useMemo(() => {
    const map = new Map<string, ItemRow>();
    if (preselectedItem) map.set(preselectedItem.id, preselectedItem);
    for (const it of items) map.set(it.id, it);
    return Array.from(map.values());
  }, [items, preselectedItem]);

  const conversions = useQuery({
    queryKey: ["factory", "uom-conversions", debouncedFilter.trim()],
    queryFn: () => {
      const sp = new URLSearchParams();
      if (debouncedFilter.trim()) sp.set("q", debouncedFilter.trim());
      return api<ConversionRow[]>(`/api/factory/master/uom-conversions${sp.toString() ? `?${sp}` : ""}`);
    },
  });

  const saveConv = useMutation({
    mutationFn: () =>
      api("/api/factory/master/uom-conversions", {
        method: "POST",
        json: {
          item_id: targetItemId || null,
          from_uom: fromUom,
          to_uom: toUom,
          factor: Number(factor.replace(",", ".")),
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["factory", "uom-conversions"] });
    },
  });

  const deleteConv = useMutation({
    mutationFn: (id: string) =>
      api(`/api/factory/master/uom-conversions?id=${encodeURIComponent(id)}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["factory", "uom-conversions"] });
    },
  });

  const numericFactor = Number(factor.replace(",", "."));
  const reverseFactor = Number.isFinite(numericFactor) && numericFactor > 0 ? 1 / numericFactor : null;

  return (
    <Card
      title="⚖️ Bảng Quy đổi Đơn vị tính (UOM Conversion — Chuẩn 2 chiều)"
      actions={
        <Button type="button" variant="ghost" onClick={onClose}>
          Đóng bảng quy đổi
        </Button>
      }
    >
      <div className="space-y-4">
        <div className="rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/70 dark:bg-emerald-950/30 p-3 text-xs text-emerald-900 dark:text-emerald-200">
          <div className="font-bold">✓ Quy đổi tự động 2 chiều &amp; bắc cầu 2 bước</div>
          <div className="mt-0.5 text-[11px]">
            Hệ thống đã cài sẵn quy đổi hệ mét: <b>1 L = 1.000 mL = 1.000.000 µL</b> · <b>1 kg = 1.000 g = 1.000.000 mg = 1.000.000.000 µg</b> ·{" "}
            <b>1 mol = 1.000.000 µmol = 1.000.000.000 nmol</b>. Nếu khai báo thêm <code className="font-mono">1 tube = 500 µL</code>, khi BOM yêu cầu <code className="font-mono">0,06 mL</code> (= 60 µL), hệ thống tự quy đổi 2 bước ra <code className="font-mono">0,12 tube</code>.
          </div>
        </div>

        {canManage && (
          <form
            className="grid gap-3 md:grid-cols-12 items-end rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/40 p-3"
            onSubmit={(e) => {
              e.preventDefault();
              saveConv.mutate();
            }}
          >
            <div className="md:col-span-4">
              <Field label="Áp dụng cho vật tư" hint="Chọn mã VT cụ thể (ưu tiên cao nhất) hoặc Dùng chung">
                <select className={inputClass} value={targetItemId} onChange={(e) => setTargetItemId(e.target.value)}>
                  <option value="">🌐 Dùng chung toàn hệ thống (Mọi vật tư)</option>
                  {itemChoices.map((it) => (
                    <option key={it.id} value={it.id}>
                      {it.code} — {it.name} (ĐVT gốc: {it.base_uom})
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <div className="md:col-span-2">
              <Field label="1 Đơn vị nguồn">
                <select className={inputClass} value={fromUom} onChange={(e) => setFromUom(e.target.value)}>
                  {uoms.map((u) => (
                    <option key={u.code} value={u.code}>
                      {u.code} ({u.name})
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <div className="md:col-span-2">
              <Field label="Bằng (Hệ số)">
                <input
                  className={inputClass}
                  type="number"
                  step="any"
                  min={0.00000001}
                  required
                  value={factor}
                  onChange={(e) => setFactor(e.target.value)}
                />
              </Field>
            </div>
            <div className="md:col-span-2">
              <Field label="Đơn vị đích">
                <select className={inputClass} value={toUom} onChange={(e) => setToUom(e.target.value)}>
                  {uoms.map((u) => (
                    <option key={u.code} value={u.code}>
                      {u.code} ({u.name})
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <div className="md:col-span-2 flex justify-end">
              <Button type="submit" className="w-full" disabled={saveConv.isPending}>
                {saveConv.isPending ? "Đang lưu…" : "+ Lưu quy đổi"}
              </Button>
            </div>
            {reverseFactor !== null && (
              <div className="md:col-span-12 text-[11px] text-slate-600 dark:text-slate-300">
                Xem trước 2 chiều: <b>1 {fromUom} = {fmtQty(numericFactor)} {toUom}</b> ⇔{" "}
                <b>1 {toUom} = {fmtQty(Number(reverseFactor.toFixed(6)))} {fromUom}</b>
              </div>
            )}
            <div className="md:col-span-12">
              <ErrorNote error={saveConv.error} />
            </div>
          </form>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs font-semibold text-slate-700 dark:text-slate-300">
            Danh sách quy tắc quy đổi ({conversions.data?.length ?? 0})
          </div>
          <input
            className={`${inputClass} w-64`}
            placeholder="Lọc theo mã vật tư hoặc đơn vị…"
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
          />
        </div>

        <ErrorNote error={conversions.error || deleteConv.error} />

        {conversions.data && conversions.data.length > 0 ? (
          <Table head={["Phạm vi áp dụng", "Quy tắc (Chiều thuận)", "Chiều ngược", "Phân loại", ""]}>
            {conversions.data.map((c) => {
              const inv = c.factor > 0 ? 1 / c.factor : 0;
              return (
                <tr key={c.id}>
                  <td className="py-2 pr-3">
                    {c.item_id ? (
                      <div>
                        <span className="font-mono font-semibold text-sky-700 dark:text-sky-400">{c.item_code}</span>{" "}
                        <span className="text-slate-600 dark:text-slate-300">— {c.item_name}</span>
                        {c.item_base_uom && (
                          <span className="ml-1.5 text-[11px] text-slate-400">(ĐVT gốc: {c.item_base_uom})</span>
                        )}
                      </div>
                    ) : (
                      <span className="font-semibold text-slate-700 dark:text-slate-300">🌐 Dùng chung toàn hệ thống</span>
                    )}
                  </td>
                  <td className="py-2 pr-3 font-mono font-semibold whitespace-nowrap">
                    1 {c.from_uom} = {fmtQty(c.factor)} {c.to_uom}
                  </td>
                  <td className="py-2 pr-3 font-mono text-slate-500 whitespace-nowrap">
                    1 {c.to_uom} = {fmtQty(Number(inv.toFixed(6)))} {c.from_uom}
                  </td>
                  <td className="py-2 pr-3 whitespace-nowrap">
                    {c.is_builtin_metric ? (
                      <StatusBadge status="EFFECTIVE" label="Chuẩn hệ mét" />
                    ) : c.item_id ? (
                      <StatusBadge status="PENDING_QC" label="Riêng vật tư" />
                    ) : (
                      <StatusBadge status="DRAFT" label="Tùy chỉnh chung" />
                    )}
                  </td>
                  <td className="py-2 pr-3 text-right">
                    {canManage && !c.is_builtin_metric && (
                      <Button
                        type="button"
                        variant="ghost"
                        disabled={deleteConv.isPending}
                        onClick={() => {
                          if (window.confirm(`Xóa quy tắc 1 ${c.from_uom} = ${c.factor} ${c.to_uom}?`)) {
                            deleteConv.mutate(c.id);
                          }
                        }}
                      >
                        Xóa
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </Table>
        ) : (
          <Empty>Chưa có quy tắc quy đổi nào khớp bộ lọc.</Empty>
        )}
      </div>
    </Card>
  );
}

const emptyForm = { code: "", name: "", item_type: "REAGENT", base_uom: "", tracking: "LOT", storage_condition: "RT", shelf_life_days: "", min_stock: "0", receipt_qc_required: true };

function NewItemForm({ uoms, onDone }: { uoms: UomOption[]; onDone: () => void }) {
  const [form, setForm] = useState(emptyForm);
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
      <Field label="Đơn vị gốc *" hint="Hệ mét mL ↔ µL tự quy đổi 2 chiều">
        <select className={inputClass} value={form.base_uom} onChange={set("base_uom")} required>
          <option value="">Chọn đơn vị</option>
          {uoms.map((u) => (
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
  const debouncedQ = useDebouncedValue(q, 300);
  const [page, setPage] = useState(1);
  const [onlyMissingUom, setOnlyMissingUom] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editingUomItem, setEditingUomItem] = useState<ItemRow | null>(null);
  const [showConversions, setShowConversions] = useState(false);
  const [convTargetItem, setConvTargetItem] = useState<ItemRow | null>(null);

  const uoms = useQuery({
    queryKey: ["factory", "uoms"],
    queryFn: () => api<UomOption[]>("/api/factory/master/uoms"),
  });

  const params = new URLSearchParams({
    page: String(page),
    page_size: "50",
    ...(debouncedQ.trim() ? { q: debouncedQ.trim() } : {}),
    ...(onlyMissingUom ? { missing_uom: "1" } : {}),
  });
  const items = useQuery({
    queryKey: ["factory", "items", params.toString()],
    queryFn: () =>
      api<{ rows: ItemRow[]; total: number; page: number; page_size: number; missing_uom_count?: number }>(
        `/api/factory/master/items?${params}`
      ),
    placeholderData: keepPreviousData,
  });

  const missingCount = items.data?.missing_uom_count ?? 0;

  return (
    <div className="flex flex-col gap-3">
      {editingUomItem && (
        <BaseUomModal
          item={editingUomItem}
          uoms={uoms.data ?? []}
          onClose={() => setEditingUomItem(null)}
        />
      )}

      {showConversions && (
        <UomConversionPanel
          canManage={canManage}
          uoms={uoms.data ?? []}
          items={items.data?.rows ?? []}
          preselectedItem={convTargetItem}
          onClose={() => {
            setShowConversions(false);
            setConvTargetItem(null);
          }}
        />
      )}

      <Card
        title="Danh mục vật tư"
        actions={
          <>
            <input
              className={`${inputClass} w-56`}
              placeholder="Tìm mã hoặc tên…"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(1);
              }}
            />
            {(missingCount > 0 || onlyMissingUom) && (
              <Button
                type="button"
                variant={onlyMissingUom ? "primary" : "secondary"}
                onClick={() => {
                  setOnlyMissingUom((v) => !v);
                  setPage(1);
                }}
              >
                {onlyMissingUom ? `Đang lọc thiếu ĐVT (${missingCount})` : `⚠️ Thiếu ĐVT (${missingCount})`}
              </Button>
            )}
            <Button
              type="button"
              variant={showConversions ? "primary" : "secondary"}
              onClick={() => {
                setConvTargetItem(null);
                setShowConversions((v) => !v);
              }}
            >
              ⚖️ Bảng Quy đổi ĐVT
            </Button>
            {canManage && !adding && <Button onClick={() => setAdding(true)}>+ Thêm vật tư</Button>}
          </>
        }
      >
        {missingCount > 0 && (
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-950 dark:border-amber-800/70 dark:bg-amber-950/40 dark:text-amber-200">
            <div>
              ⚠️ Có <b>{missingCount}</b> vật tư đang có ĐVT gốc là dấu <code className="font-mono font-bold">-</code> (do import từ file Excel cũ thiếu cột Đơn vị). Bấm trực tiếp vào ĐVT gốc để chuẩn hóa sang <code className="font-mono">µL</code>, <code className="font-mono">mL</code>, <code className="font-mono">g</code>, <code className="font-mono">tube</code>…
            </div>
            {!onlyMissingUom && (
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setOnlyMissingUom(true);
                  setPage(1);
                }}
              >
                Lọc xem ngay →
              </Button>
            )}
          </div>
        )}

        {adding && <NewItemForm uoms={uoms.data ?? []} onDone={() => setAdding(false)} />}
        <ErrorNote error={items.error} />
        {items.data && items.data.rows.length === 0 && <Empty>Chưa có vật tư nào.</Empty>}
        {items.data && items.data.rows.length > 0 && (
          <>
            <Table head={["Mã", "Tên", "Loại", "ĐVT gốc", "Quản lý", "Bảo quản", "Tồn tối thiểu", "QC nhận hàng", "Mã hàng KD", "Trạng thái", ""]}>
              {items.data.rows.map((r) => {
                const badUom = isPlaceholderUomClient(r.base_uom);
                return (
                  <tr key={r.id}>
                    <td className="py-2 pr-3 font-mono font-semibold whitespace-nowrap">{r.code}</td>
                    <td className="py-2 pr-3">{r.name}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">{ITEM_TYPE_LABEL[r.item_type] ?? r.item_type}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">
                      {canManage ? (
                        <button
                          type="button"
                          onClick={() => setEditingUomItem(r)}
                          title={badUom ? "ĐVT gốc đang là dấu '-' — Bấm để chọn ĐVT chuẩn (mL, µL, tube...)" : "Bấm để sửa/quy đổi ĐVT gốc"}
                          className={
                            badUom
                              ? "inline-flex items-center gap-1 rounded-lg border border-rose-300 bg-rose-50 px-2 py-0.5 text-[11px] font-bold text-rose-700 hover:bg-rose-100 dark:border-rose-800 dark:bg-rose-950/60 dark:text-rose-300 cursor-pointer"
                              : "inline-flex items-center gap-1 font-mono font-semibold text-sky-700 dark:text-sky-400 hover:underline underline-offset-2 cursor-pointer"
                          }
                        >
                          {badUom ? `⚠️ Thiếu ĐVT (${r.base_uom})` : r.base_uom}
                          <span className="text-[10px] opacity-75">✏️</span>
                        </button>
                      ) : badUom ? (
                        <span className="text-rose-600 font-bold">⚠️ {r.base_uom}</span>
                      ) : (
                        r.base_uom
                      )}
                    </td>
                    <td className="py-2 pr-3 whitespace-nowrap">{TRACKING_LABEL[r.tracking]}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">{STORAGE_LABEL[r.storage_condition]}</td>
                    <td className="py-2 pr-3 text-right">{fmtQty(r.min_stock)}</td>
                    <td className="py-2 pr-3">{r.receipt_qc_required ? "Có" : "Không"}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">{canManage ? <KdMapping item={r} /> : r.kd_item_code ?? "—"}</td>
                    <td className="py-2 pr-3"><StatusBadge status={r.status === "ACTIVE" ? "RELEASED" : "EXPIRED"} label={r.status === "ACTIVE" ? "Đang dùng" : "Ngừng"} /></td>
                    <td className="py-2 pr-3 whitespace-nowrap text-right">
                      <button
                        type="button"
                        onClick={() => {
                          setConvTargetItem(r);
                          setShowConversions(true);
                        }}
                        title={`Khai báo hoặc xem quy đổi đơn vị riêng cho ${r.code} (VD: 1 tube = 0,5 mL)`}
                        className="text-xs font-semibold text-indigo-700 dark:text-indigo-400 hover:underline underline-offset-2 cursor-pointer"
                      >
                        ⚖️ Quy đổi
                      </button>
                    </td>
                  </tr>
                );
              })}
            </Table>
            <Pager page={items.data.page} pageSize={items.data.page_size} total={items.data.total} onPage={setPage} />
          </>
        )}
      </Card>
    </div>
  );
}

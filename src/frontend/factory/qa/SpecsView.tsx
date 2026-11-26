"use client";

import React, { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ActionBar, type AllowedAction } from "../actions";
import { api, useDebouncedValue, useFactoryMe } from "../api";
import { Button, Card, Empty, ErrorNote, Field, inputClass, StatusBadge, Table } from "../ui";

interface AssignedItem {
  id: string;
  code: string;
  name: string;
  item_type?: string;
  base_uom?: string;
}

const ITEM_TYPE_SHORT: Record<string, string> = {
  FINISHED_KIT: "Kit TP",
  DEVICE: "Thiết bị",
  SEMI_FINISHED: "Bán TP",
  REAGENT: "Hóa chất",
  RAW_MATERIAL: "Nguyên liệu",
  CONSUMABLE: "Tiêu hao",
  COMPONENT: "Linh kiện",
  SPARE_PART: "Phụ tùng",
  OLIGO_SERVICE: "Oligo",
};

const PICKER_TYPE_FILTERS: { value: string; label: string }[] = [
  { value: "", label: "Tất cả" },
  { value: "FINISHED_KIT,DEVICE", label: "Thành phẩm (Kit / Thiết bị)" },
  { value: "SEMI_FINISHED", label: "Bán thành phẩm / Công thức pha" },
  { value: "RAW_MATERIAL,REAGENT", label: "Nguyên liệu & Hóa chất" },
  { value: "CONSUMABLE,COMPONENT,SPARE_PART", label: "Tiêu hao & Bao bì" },
];

interface SpecRow {
  id: string;
  code: string;
  spec_version: number;
  name: string;
  applies_to: string;
  status: string;
  item_id?: string | null;
  item_code: string | null;
  item_name: string | null;
  assigned_items?: AssignedItem[];
  parameter_count: number;
}
interface Param {
  name: string;
  method: string;
  unit: string;
  value_type: "NUMERIC" | "TEXT" | "PASS_FAIL";
  lower_limit: string;
  upper_limit: string;
  target: string;
  is_critical: boolean;
  derived_metric: string;
  oligo_purifications: string[];
}
interface SpecDetail extends SpecRow {
  version: number;
  item_id: string | null;
  notes: string | null;
  parameters: (Omit<Param, "lower_limit" | "upper_limit" | "derived_metric" | "oligo_purifications"> & {
    lower_limit: string | null;
    upper_limit: string | null;
    derived_metric: string | null;
    oligo_purifications: string[] | null;
  })[];
  actions: AllowedAction[];
}

const APPLIES: Record<string, string> = { ITEM: "Vật tư (chung)", RECEIPT: "Kiểm tra đầu vào", PRODUCT: "Thành phẩm", OLIGO: "Oligo", DEVICE_MODEL: "Model thiết bị" };
const SPEC_STATUS: Record<string, [string, string]> = { DRAFT: ["PENDING_QC", "Bản nháp"], EFFECTIVE: ["RELEASED", "Hiệu lực"], OBSOLETE: ["EXPIRED", "Hết hiệu lực"] };
const ACTION_LABEL = {
  approve: "✅ Phê duyệt cho hiệu lực",
  supersede: "🔄 Thay thế bằng phiên bản mới (Chuyển hết hiệu lực)",
  obsolete: "🚫 Ngừng hiệu lực",
};
const blankParam = (): Param => ({ name: "", method: "", unit: "", value_type: "NUMERIC", lower_limit: "", upper_limit: "", target: "", is_critical: true, derived_metric: "", oligo_purifications: [] });
const NEEDS_ITEM = ["ITEM", "RECEIPT", "PRODUCT", "DEVICE_MODEL"];
/** Oligo: values the server computes from the sequence instead of the analyst typing them. */
const DERIVED: Record<string, string> = {
  "": "Kiểm nghiệm viên nhập",
  MW_DELTA_DA: "ΔMW = MW đo − MW lý thuyết (Da)",
  OD_TOTAL: "Tổng OD260 (từ hậu tổng hợp)",
  YIELD_NMOL: "nmol (từ hậu tổng hợp)",
  YIELD_UG: "µg (từ hậu tổng hợp)",
};
const PURIFICATIONS = ["DESALT", "OPC", "HPLC", "PAGE"];

function MultiItemPicker({
  selectedIds,
  initialItems = [],
  onChange,
}: {
  selectedIds: string[];
  initialItems?: AssignedItem[];
  onChange: (ids: string[], selectedObjects: AssignedItem[]) => void;
}) {
  const [q, setQ] = useState("");
  const debouncedQ = useDebouncedValue(q, 200);
  const [typeFilter, setTypeFilter] = useState("");
  const [visibleLimit, setVisibleLimit] = useState(250);
  const [knownItems, setKnownItems] = useState<Record<string, AssignedItem>>(() => {
    const map: Record<string, AssignedItem> = {};
    for (const it of initialItems) map[it.id] = it;
    return map;
  });

  useEffect(() => {
    setVisibleLimit(250);
  }, [debouncedQ, typeFilter]);

  const items = useQuery({
    queryKey: ["factory", "items", "multi-picker", debouncedQ, typeFilter],
    queryFn: async () => {
      const typeParam = typeFilter ? `&item_type=${encodeURIComponent(typeFilter)}` : "";
      const res = await api<{ rows: AssignedItem[]; total?: number }>(
        `/api/factory/master/items?page_size=5000&q=${encodeURIComponent(debouncedQ)}${typeParam}`
      );
      setKnownItems((prev) => {
        const next = { ...prev };
        for (const r of res.rows) next[r.id] = r;
        return next;
      });
      return res;
    },
  });

  const rows = items.data?.rows ?? [];
  const totalCount = items.data?.total ?? rows.length;
  const visibleRows = rows.slice(0, visibleLimit);

  const toggleId = (row: AssignedItem) => {
    const exists = selectedIds.includes(row.id);
    const nextIds = exists ? selectedIds.filter((x) => x !== row.id) : [...selectedIds, row.id];
    const nextKnown = { ...knownItems, [row.id]: row };
    setKnownItems(nextKnown);
    onChange(
      nextIds,
      nextIds.map((id) => nextKnown[id] ?? { id, code: id.slice(0, 8), name: "" })
    );
  };

  const selectAllVisible = () => {
    const nextKnown = { ...knownItems };
    const nextSet = new Set(selectedIds);
    for (const r of rows) {
      nextKnown[r.id] = r;
      nextSet.add(r.id);
    }
    const nextIds = Array.from(nextSet);
    setKnownItems(nextKnown);
    onChange(
      nextIds,
      nextIds.map((id) => nextKnown[id] ?? { id, code: id.slice(0, 8), name: "" })
    );
  };

  const clearAll = () => {
    onChange([], []);
  };

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 p-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <input
          className={`${inputClass} flex-1 min-w-[200px]`}
          placeholder="🔍 Tìm mã/tên SP, nguyên liệu, mã công thức, TCCS (hỗ trợ gõ không dấu, bỏ qua ký tự ®/-)..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div className="flex items-center gap-1.5 text-xs">
          <span className="font-semibold text-sky-700 dark:text-sky-300">
            Đã chọn: {selectedIds.length} SP
          </span>
          <button
            type="button"
            className="px-2 py-1 rounded bg-sky-50 dark:bg-sky-950/60 text-sky-700 dark:text-sky-300 border border-sky-200 dark:border-sky-800 hover:bg-sky-100 cursor-pointer"
            onClick={selectAllVisible}
          >
            + Chọn tất cả đang lọc ({rows.length})
          </button>
          {selectedIds.length > 0 && (
            <button
              type="button"
              className="px-2 py-1 rounded bg-rose-50 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800 hover:bg-rose-100 cursor-pointer"
              onClick={clearAll}
            >
              ✕ Bỏ chọn hết
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
        <div className="flex flex-wrap items-center gap-1">
          {PICKER_TYPE_FILTERS.map((f) => {
            const active = typeFilter === f.value;
            return (
              <button
                key={f.value || "ALL"}
                type="button"
                onClick={() => setTypeFilter(f.value)}
                className={`px-2 py-0.5 rounded-full font-semibold border cursor-pointer transition-colors ${
                  active
                    ? "bg-sky-600 text-white border-sky-600"
                    : "bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700"
                }`}
              >
                {f.label}
              </button>
            );
          })}
        </div>
        <span className="text-slate-500 dark:text-slate-400 font-mono">
          Đang lọc: <b>{rows.length}</b> / {totalCount} mã
        </span>
      </div>

      {selectedIds.length > 0 && (
        <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto p-1.5 rounded-lg bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800">
          {selectedIds.map((id) => {
            const info = knownItems[id] || initialItems.find((x) => x.id === id);
            return (
              <span
                key={id}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-sky-100 dark:bg-sky-900/60 text-sky-900 dark:text-sky-200 border border-sky-300 dark:border-sky-700"
              >
                <span className="font-mono font-bold">{info?.code ?? id.slice(0, 8)}</span>
                {info?.name ? <span className="truncate max-w-[180px]">— {info.name}</span> : null}
                <button
                  type="button"
                  className="ml-1 text-rose-600 dark:text-rose-400 hover:font-bold cursor-pointer"
                  onClick={() => {
                    const nextIds = selectedIds.filter((x) => x !== id);
                    onChange(
                      nextIds,
                      nextIds.map((k) => knownItems[k] ?? { id: k, code: k.slice(0, 8), name: "" })
                    );
                  }}
                >
                  ✕
                </button>
              </span>
            );
          })}
        </div>
      )}

      <div
        className="max-h-64 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800 rounded-lg border border-slate-200 dark:border-slate-800"
        onScroll={(e) => {
          const el = e.currentTarget;
          if (el.scrollTop + el.clientHeight >= el.scrollHeight - 80 && visibleLimit < rows.length) {
            setVisibleLimit((v) => Math.min(rows.length, v + 250));
          }
        }}
      >
        {visibleRows.map((r) => {
          const checked = selectedIds.includes(r.id);
          const typeLabel = r.item_type ? ITEM_TYPE_SHORT[r.item_type] ?? r.item_type : null;
          return (
            <label
              key={r.id}
              className={`flex items-center gap-2.5 px-2.5 py-1.5 text-xs cursor-pointer hover:bg-sky-50/60 dark:hover:bg-slate-800/70 ${
                checked ? "bg-sky-50/90 dark:bg-sky-950/30 font-semibold" : ""
              }`}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggleId(r)}
                className="h-3.5 w-3.5 accent-sky-600"
              />
              <span className="font-mono font-semibold text-sky-700 dark:text-sky-300 shrink-0">{r.code}</span>
              <span className="text-slate-700 dark:text-slate-200 flex-1 min-w-0 truncate">{r.name}</span>
              {typeLabel && (
                <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-[10px] font-medium text-slate-600 dark:text-slate-300 shrink-0">
                  {typeLabel}
                </span>
              )}
              {r.base_uom && (
                <span className="text-[10px] font-mono text-slate-400 shrink-0">{r.base_uom}</span>
              )}
            </label>
          );
        })}
        {visibleLimit < rows.length && (
          <button
            type="button"
            onClick={() => setVisibleLimit((v) => Math.min(rows.length, v + 500))}
            className="w-full py-2 text-center text-xs font-semibold text-sky-700 dark:text-sky-300 hover:bg-sky-50 dark:hover:bg-sky-950/30 cursor-pointer"
          >
            Đang hiển thị {visibleRows.length} / {rows.length} mã — Cuộn xuống hoặc bấm để xem thêm
          </button>
        )}
        {rows.length === 0 && (
          <div className="p-3 text-center text-xs text-slate-400">
            {items.isLoading
              ? "Đang tải danh mục vật tư & sản phẩm..."
              : "Không tìm thấy sản phẩm / vật tư phù hợp."}
          </div>
        )}
      </div>
    </div>
  );
}

function renderAssignedBadges(s: SpecRow) {
  const list = s.assigned_items && s.assigned_items.length > 0
    ? s.assigned_items
    : s.item_code
    ? [{ id: s.item_id ?? "primary", code: s.item_code, name: s.item_name ?? "" }]
    : [];
  if (list.length === 0) return <span className="text-slate-400">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {list.map((it) => (
        <span
          key={it.id}
          title={`${it.code} — ${it.name}`}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700"
        >
          <strong className="font-mono text-sky-700 dark:text-sky-300">{it.code}</strong>
          <span className="truncate max-w-[180px]">{it.name}</span>
        </span>
      ))}
    </div>
  );
}

function SpecEditor({ base, mode, onClose }: { base?: SpecDetail; mode: "new" | "revision" | "edit"; onClose: () => void }) {
  const qc = useQueryClient();
  const initialIds =
    base?.assigned_items && base.assigned_items.length > 0
      ? base.assigned_items.map((x) => x.id)
      : base?.item_id
      ? [base.item_id]
      : [];
  const [head, setHead] = useState({
    name: base?.name ?? "",
    applies_to: base?.applies_to ?? "ITEM",
    item_ids: initialIds,
    notes: base?.notes ?? "",
  });
  const [params, setParams] = useState<Param[]>(
    base?.parameters.map((p) => ({ ...p, method: p.method ?? "", unit: p.unit ?? "", target: p.target ?? "", derived_metric: p.derived_metric ?? "", oligo_purifications: p.oligo_purifications ?? [], lower_limit: p.lower_limit == null ? "" : String(Number(p.lower_limit)), upper_limit: p.upper_limit == null ? "" : String(Number(p.upper_limit)) })) ?? [blankParam()]
  );
  const qaOps = useQuery({
    queryKey: ["factory", "qa-ops"],
    queryFn: () => api<{ methods: { code: string; name: string }[] }>("/api/factory/qms/ops"),
  });
  const save = useMutation({
    mutationFn: () => {
      const body = {
        ...head,
        item_id: head.item_ids[0] || null,
        item_ids: head.item_ids,
        parameters: params.map((p) => ({
          ...p,
          lower_limit: p.value_type === "NUMERIC" && p.lower_limit !== "" ? Number(p.lower_limit) : null,
          upper_limit: p.value_type === "NUMERIC" && p.upper_limit !== "" ? Number(p.upper_limit) : null,
          target: p.target || null,
          derived_metric: head.applies_to === "OLIGO" && p.derived_metric ? p.derived_metric : null,
          oligo_purifications: head.applies_to === "OLIGO" && p.oligo_purifications.length ? p.oligo_purifications : null,
        })),
      };
      if (mode === "edit") return api(`/api/factory/qms/specs/${base!.id}`, { method: "PUT", json: { ...body, version: base!.version } });
      return api("/api/factory/qms/specs", { method: "POST", idempotent: true, json: mode === "revision" ? { ...body, from_code: base!.code } : body });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["factory", "specs"] });
      qc.invalidateQueries({ queryKey: ["factory", "spec"] });
      onClose();
    },
  });
  const setP = (i: number, patch: Partial<Param>) => setParams(params.map((p, j) => (j === i ? { ...p, ...patch } : p)));

  return (
    <Card title={mode === "new" ? "Tiêu chuẩn QC mới" : mode === "revision" ? `Phiên bản mới của ${base!.code}` : `Chỉnh sửa Tiêu chuẩn QC ${base!.code} (rev ${base!.spec_version})`}>
      <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Tên tiêu chuẩn *"><input className={inputClass} value={head.name} onChange={(e) => setHead({ ...head, name: e.target.value })} required /></Field>
          <Field label="Áp dụng cho phân loại">
            <select className={inputClass} value={head.applies_to} onChange={(e) => setHead({ ...head, applies_to: e.target.value })}>
              {Object.entries(APPLIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          {NEEDS_ITEM.includes(head.applies_to) && (
            <div className="sm:col-span-2">
              <Field label="Chọn (Một hoặc Nhiều) Vật tư / Bán thành phẩm / Sản phẩm áp dụng bộ tiêu chuẩn này *">
                <MultiItemPicker
                  selectedIds={head.item_ids}
                  initialItems={base?.assigned_items ?? []}
                  onChange={(ids) => setHead({ ...head, item_ids: ids })}
                />
              </Field>
            </div>
          )}
        </div>
        <div className="flex flex-col gap-2">
          {params.map((p, i) => (
            <div key={i} className="grid gap-2 grid-cols-2 lg:grid-cols-8 items-end p-2 rounded-xl border border-slate-200 dark:border-slate-800">
              <Field label={`Chỉ tiêu ${i + 1} *`}><input className={inputClass} value={p.name} onChange={(e) => setP(i, { name: e.target.value })} required /></Field>
              <Field label="Phương pháp (SOP QC)">
                <input
                  className={inputClass}
                  list="qc-methods-datalist"
                  placeholder="Chọn hoặc nhập mã PP..."
                  value={p.method}
                  onChange={(e) => setP(i, { method: e.target.value })}
                />
              </Field>
              <Field label="Kiểu">
                <select className={inputClass} value={p.value_type} onChange={(e) => setP(i, { value_type: e.target.value as Param["value_type"] })}>
                  <option value="NUMERIC">Số</option>
                  <option value="PASS_FAIL">Đạt / Không đạt</option>
                  <option value="TEXT">Mô tả</option>
                </select>
              </Field>
              <Field label="Đơn vị"><input className={inputClass} value={p.unit} onChange={(e) => setP(i, { unit: e.target.value })} /></Field>
              <Field label="Min"><input className={inputClass} inputMode="decimal" disabled={p.value_type !== "NUMERIC"} value={p.lower_limit} onChange={(e) => setP(i, { lower_limit: e.target.value })} /></Field>
              <Field label="Max"><input className={inputClass} inputMode="decimal" disabled={p.value_type !== "NUMERIC"} value={p.upper_limit} onChange={(e) => setP(i, { upper_limit: e.target.value })} /></Field>
              <Field label="Yêu cầu kỹ thuật / Mô tả đạt">
                <input
                  className={inputClass}
                  placeholder="VD: Cửa trượt kính cường lực 5mm..."
                  value={p.target}
                  onChange={(e) => setP(i, { target: e.target.value })}
                />
              </Field>
              <div className="flex items-center gap-2 pb-2">
                <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={p.is_critical} onChange={(e) => setP(i, { is_critical: e.target.checked })} />Bắt buộc</label>
                {params.length > 1 && <button type="button" className="text-rose-600 text-xs cursor-pointer" onClick={() => setParams(params.filter((_, j) => j !== i))}>Xóa</button>}
              </div>
              {head.applies_to === "OLIGO" && (
                <div className="col-span-2 lg:col-span-8 flex flex-wrap items-center gap-3 text-xs">
                  <select className={`${inputClass} w-72`} value={p.derived_metric} disabled={p.value_type !== "NUMERIC"} onChange={(e) => setP(i, { derived_metric: e.target.value })} aria-label="Cách lấy giá trị">
                    {Object.entries(DERIVED).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                  <span className="text-slate-500">Chỉ áp dụng cho tinh sạch (bỏ trống = mọi loại):</span>
                  {PURIFICATIONS.map((pu) => (
                    <label key={pu} className="flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={p.oligo_purifications.includes(pu)}
                        onChange={(e) => setP(i, { oligo_purifications: e.target.checked ? [...p.oligo_purifications, pu] : p.oligo_purifications.filter((x) => x !== pu) })}
                      />
                      {pu}
                    </label>
                  ))}
                </div>
              )}
            </div>
          ))}
          <div><Button type="button" variant="ghost" onClick={() => setParams([...params, blankParam()])}>+ Thêm chỉ tiêu</Button></div>
          <datalist id="qc-methods-datalist">
            {(qaOps.data?.methods ?? []).map((m) => (
              <option key={m.code} value={`${m.code} (${m.name})`} />
            ))}
          </datalist>
        </div>
        <ErrorNote error={save.error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Hủy</Button>
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? "Đang lưu…" : mode === "edit" ? "Lưu cập nhật tiêu chuẩn" : "Lưu tiêu chuẩn"}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function SpecDetailPanel({
  id,
  initialEditing = null,
  onClose,
  onOpenAssign,
  onDelete,
}: {
  id: string;
  initialEditing?: "revision" | "edit" | null;
  onClose: () => void;
  onOpenAssign: (s: SpecRow, mode: "ASSIGN" | "CLONE") => void;
  onDelete: (s: SpecRow) => void;
}) {
  const qc = useQueryClient();
  const me = useFactoryMe();
  const [editing, setEditing] = useState<"revision" | "edit" | null>(initialEditing);
  useEffect(() => {
    setEditing(initialEditing);
  }, [id, initialEditing]);
  const spec = useQuery({ queryKey: ["factory", "spec", id], queryFn: () => api<SpecDetail>(`/api/factory/qms/specs/${id}`) });
  const s = spec.data;
  const canManage = Boolean(me.data?.is_root || me.data?.permissions.includes("qms.spec.manage"));
  if (s && editing) return <SpecEditor base={s} mode={editing} onClose={() => setEditing(null)} />;
  return (
    <Card title={s ? `${s.code} rev ${s.spec_version} — ${s.name}` : "Tiêu chuẩn"} actions={<Button variant="ghost" onClick={onClose}>Đóng</Button>}>
      <ErrorNote error={spec.error} />
      {s && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
              <span>{APPLIES[s.applies_to]} ·</span>
              <StatusBadge status={SPEC_STATUS[s.status][0]} label={SPEC_STATUS[s.status][1]} />
              <span>· Sản phẩm áp dụng ({s.assigned_items?.length ?? (s.item_code ? 1 : 0)}):</span>
              {renderAssignedBadges(s)}
            </div>
            {canManage && (
              <div className="inline-flex flex-wrap items-center gap-1 whitespace-nowrap">
                <button
                  type="button"
                  title="Gán / Chọn một hoặc nhiều sản phẩm áp dụng tiêu chuẩn này"
                  className="px-2 py-1 rounded-lg text-[11px] font-medium border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                  onClick={() => onOpenAssign(s, "ASSIGN")}
                >
                  🔗 Gán SP
                </button>
                <button
                  type="button"
                  title="Sao chép bộ chỉ tiêu này sang tiêu chuẩn mới cho sản phẩm khác"
                  className="px-2 py-1 rounded-lg text-[11px] font-medium border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                  onClick={() => onOpenAssign(s, "CLONE")}
                >
                  📋 Sao chép
                </button>
                <button
                  type="button"
                  title="Sửa tên, phân loại, sản phẩm áp dụng và các chỉ tiêu kiểm nghiệm"
                  className="px-2 py-1 rounded-lg text-[11px] font-semibold border border-sky-300 dark:border-sky-800 bg-sky-50 dark:bg-sky-950/50 text-sky-800 dark:text-sky-300 hover:bg-sky-100 cursor-pointer"
                  onClick={() => setEditing("edit")}
                >
                  ✏️ Sửa
                </button>
                <button
                  type="button"
                  title="Xóa tiêu chuẩn QC này"
                  className="px-2 py-1 rounded-lg text-[11px] font-semibold border border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300 hover:bg-rose-100 cursor-pointer"
                  onClick={() => onDelete(s)}
                >
                  🗑️ Xóa
                </button>
              </div>
            )}
          </div>
          <Table head={["#", "Chỉ tiêu", "Phương pháp", "Yêu cầu", "Bắt buộc"]}>
            {s.parameters.map((p, i) => (
              <tr key={i}>
                <td className="py-2 pr-3">{i + 1}</td>
                <td className="py-2 pr-3">
                  {p.name}
                  {(p.derived_metric || p.oligo_purifications?.length) && (
                    <div className="text-[11px] text-slate-500">
                      {[p.derived_metric && DERIVED[p.derived_metric], p.oligo_purifications?.length && `chỉ ${p.oligo_purifications.join(", ")}`].filter(Boolean).join(" · ")}
                    </div>
                  )}
                </td>
                <td className="py-2 pr-3">{p.method || "—"}</td>
                <td className="py-2 pr-3">
                  {p.value_type === "NUMERIC"
                    ? [
                        p.target || null,
                        [p.lower_limit != null && `≥ ${Number(p.lower_limit)}`, p.upper_limit != null && `≤ ${Number(p.upper_limit)}`].filter(Boolean).join(", ") || null,
                      ]
                        .filter(Boolean)
                        .join(" · ") || "—"
                    : p.target || (p.value_type === "PASS_FAIL" ? "Đạt" : "—")}{" "}
                  {p.unit}
                </td>
                <td className="py-2 pr-3">{p.is_critical ? "Có" : "Không"}</td>
              </tr>
            ))}
          </Table>
          <ActionBar endpoint={`/api/factory/qms/specs/${s.id}/actions`} version={s.version} actions={s.actions} labels={ACTION_LABEL} onDone={() => { qc.invalidateQueries({ queryKey: ["factory", "spec", id] }); qc.invalidateQueries({ queryKey: ["factory", "specs"] }); }} />
          {canManage && (
            <div className="flex flex-wrap gap-2">
              <Button variant="ghost" onClick={() => setEditing("edit")}>✏️ Sửa tiêu chuẩn &amp; chỉ tiêu</Button>
              {s.status === "EFFECTIVE" && <Button variant="ghost" onClick={() => setEditing("revision")}>➕ Tạo phiên bản mới (Revision)</Button>}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

export function SpecsView() {
  const qc = useQueryClient();
  const me = useFactoryMe();
  const canManage = Boolean(me.data?.is_root || me.data?.permissions.includes("qms.spec.manage"));
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedInitialEdit, setSelectedInitialEdit] = useState<"revision" | "edit" | null>(null);
  const [creating, setCreating] = useState(false);
  const [searchQ, setSearchQ] = useState("");
  const [appliesFilter, setAppliesFilter] = useState("");
  const [assignTarget, setAssignTarget] = useState<{
    spec: SpecRow;
    mode: "ASSIGN" | "CLONE";
    applies_to: string;
    item_ids: string[];
    custom_name: string;
    make_effective: boolean;
  } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const specs = useQuery({ queryKey: ["factory", "specs"], queryFn: () => api<SpecRow[]>("/api/factory/qms/specs") });

  const deleteMut = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api<{ deleted: boolean; code: string }>(`/api/factory/qms/specs/${id}`, {
        method: "DELETE",
        json: { reason },
      }),
    onSuccess: (res, vars) => {
      if (selected === vars.id) {
        setSelected(null);
        setSelectedInitialEdit(null);
      }
      qc.invalidateQueries({ queryKey: ["factory", "specs"] });
      qc.invalidateQueries({ queryKey: ["factory", "spec"] });
      qc.invalidateQueries({ queryKey: ["factory", "qa-ops"] });
      setNotice(`🗑️ Đã xóa tiêu chuẩn QC ${res.code}.`);
    },
    onError: (err) => window.alert((err as Error).message),
  });

  const handleDeleteSpec = (s: SpecRow) => {
    const reason = window.prompt(
      `Nhập lý do xóa tiêu chuẩn ${s.code} (rev ${s.spec_version} — ${s.name}):`,
      "Xóa tiêu chuẩn trùng hoặc không còn áp dụng"
    );
    if (reason === null) return;
    deleteMut.mutate({ id: s.id, reason: reason.trim() || `Xóa tiêu chuẩn ${s.code}` });
  };

  const assignMut = useMutation({
    mutationFn: (payload: any) =>
      api<any>("/api/factory/qms/ops", {
        method: "POST",
        json: { op: "assign_spec_item", ...payload },
      }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["factory", "specs"] });
      qc.invalidateQueries({ queryKey: ["factory", "spec"] });
      qc.invalidateQueries({ queryKey: ["factory", "qa-ops"] });
      const count = res.spec?.assigned_items?.length ?? 1;
      setNotice(
        res.mode === "CLONE"
          ? `✅ Đã sao chép và gán thành tiêu chuẩn mới ${res.spec.code} (${res.spec.name}) cho ${count} sản phẩm!`
          : `✅ Đã cập nhật gán ${count} sản phẩm cho tiêu chuẩn ${res.spec.code} (${res.spec.name})!`
      );
      setAssignTarget(null);
      if (res.spec?.id) setSelected(res.spec.id);
    },
  });

  const openAssignModal = (s: SpecRow, mode: "ASSIGN" | "CLONE") => {
    const existingIds =
      mode === "ASSIGN"
        ? s.assigned_items && s.assigned_items.length > 0
          ? s.assigned_items.map((x) => x.id)
          : s.item_id
          ? [s.item_id]
          : []
        : [];
    setAssignTarget({
      spec: s,
      mode,
      applies_to: s.applies_to || "PRODUCT",
      item_ids: existingIds,
      custom_name: mode === "ASSIGN" ? s.name : "",
      make_effective: true,
    });
  };

  const renderAssignCard = () => {
    if (!assignTarget) return null;
    return (
      <Card
        title={
          assignTarget.mode === "ASSIGN"
            ? `🔗 Gán / Chọn Nhiều Sản phẩm áp dụng cho Tiêu chuẩn ${assignTarget.spec.code}`
            : `📋 Sao chép bộ chỉ tiêu của ${assignTarget.spec.code} & Gán cho (Một hoặc Nhiều) Sản phẩm khác`
        }
        actions={
          <Button variant="ghost" onClick={() => setAssignTarget(null)}>
            Đóng
          </Button>
        }
      >
        <ErrorNote error={assignMut.error} />
        <form
          className="grid gap-3 sm:grid-cols-2 items-end"
          onSubmit={(e) => {
            e.preventDefault();
            assignMut.mutate({
              spec_id: assignTarget.spec.id,
              mode: assignTarget.mode,
              applies_to: assignTarget.applies_to,
              item_id: assignTarget.item_ids[0] || null,
              item_ids: assignTarget.item_ids,
              custom_name: assignTarget.custom_name || null,
              make_effective: assignTarget.make_effective,
            });
          }}
        >
          <Field label="1. Chế độ thực hiện *">
            <select
              className={inputClass}
              value={assignTarget.mode}
              onChange={(e) => {
                const nextMode = e.target.value as "ASSIGN" | "CLONE";
                const s = assignTarget.spec;
                const existingIds =
                  nextMode === "ASSIGN"
                    ? s.assigned_items && s.assigned_items.length > 0
                      ? s.assigned_items.map((x) => x.id)
                      : s.item_id
                      ? [s.item_id]
                      : []
                    : [];
                setAssignTarget({
                  ...assignTarget,
                  mode: nextMode,
                  item_ids: existingIds,
                  custom_name: nextMode === "ASSIGN" ? s.name : "",
                });
              }}
            >
              <option value="ASSIGN">🔗 Gán trực tiếp tiêu chuẩn {assignTarget.spec.code} cho các sản phẩm được tích chọn bên dưới</option>
              <option value="CLONE">📋 Sao chép bộ chỉ tiêu của {assignTarget.spec.code} sang mã TC mới cho các sản phẩm bên dưới</option>
            </select>
          </Field>
          <Field label="2. Áp dụng cho phân loại *">
            <select
              className={inputClass}
              value={assignTarget.applies_to}
              onChange={(e) => setAssignTarget({ ...assignTarget, applies_to: e.target.value })}
            >
              {Object.entries(APPLIES).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </Field>
          <div className="sm:col-span-2">
            <Field label="3. Tích chọn (Một hoặc Nhiều) Vật tư / Bán thành phẩm / Sản phẩm cần gán *">
              <MultiItemPicker
                selectedIds={assignTarget.item_ids}
                initialItems={assignTarget.spec.assigned_items ?? []}
                onChange={(ids, selectedObjs) => {
                  const prefix = assignTarget.applies_to === "RECEIPT" ? "IQC" : assignTarget.applies_to === "PRODUCT" ? "FQC" : "IPQC";
                  let autoName = assignTarget.custom_name;
                  if (assignTarget.mode === "CLONE" && selectedObjs.length > 0) {
                    const first = selectedObjs[0];
                    autoName =
                      selectedObjs.length === 1
                        ? `Tiêu chuẩn ${prefix} — ${first.code} ${first.name}`
                        : `Tiêu chuẩn ${prefix} — ${first.code} (+${selectedObjs.length - 1} SP cùng nhóm)`;
                  }
                  setAssignTarget({
                    ...assignTarget,
                    item_ids: ids,
                    custom_name: autoName,
                  });
                }}
              />
            </Field>
          </div>
          <Field label="4. Tên Tiêu chuẩn sau khi gán">
            <input
              className={inputClass}
              value={assignTarget.custom_name}
              onChange={(e) => setAssignTarget({ ...assignTarget, custom_name: e.target.value })}
              placeholder="Để trống để hệ thống tự đặt tên theo sản phẩm đã chọn"
            />
          </Field>
          <div className="flex items-center justify-between gap-2 pb-1">
            <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer">
              <input
                type="checkbox"
                checked={assignTarget.make_effective}
                onChange={(e) => setAssignTarget({ ...assignTarget, make_effective: e.target.checked })}
              />
              Kích hoạt có hiệu lực ngay (EFFECTIVE)
            </label>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={() => setAssignTarget(null)}>
                Hủy
              </Button>
              <Button type="submit" disabled={assignMut.isPending || (NEEDS_ITEM.includes(assignTarget.applies_to) && assignTarget.item_ids.length === 0)}>
                {assignTarget.mode === "CLONE"
                  ? `📋 Sao chép & Gán (${assignTarget.item_ids.length} SP)`
                  : `🔗 Lưu gán (${assignTarget.item_ids.length} SP)`}
              </Button>
            </div>
          </div>
        </form>
      </Card>
    );
  };

  return (
    <div className="flex flex-col gap-3">
      {creating && <SpecEditor mode="new" onClose={() => setCreating(false)} />}

      <Card
        title="Tiêu chuẩn QC (Gán Một hoặc Nhiều Sản phẩm ↔ Bộ Chỉ tiêu Kiểm nghiệm)"
        actions={
          canManage &&
          !creating && <Button onClick={() => setCreating(true)}>+ Tiêu chuẩn mới</Button>
        }
      >
        <ErrorNote error={specs.error ?? deleteMut.error} />
        {notice && (
          <div className="mb-3 p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-xs font-semibold text-emerald-800 dark:text-emerald-200 flex items-center justify-between">
            <span>{notice}</span>
            <button type="button" className="underline ml-2 cursor-pointer" onClick={() => setNotice(null)}>
              Đóng
            </button>
          </div>
        )}
        {specs.data && specs.data.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3 p-2 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50">
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => setAppliesFilter("")}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition-colors cursor-pointer ${
                  appliesFilter === ""
                    ? "bg-sky-700 text-white border-sky-700"
                    : "bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-100"
                }`}
              >
                Tất cả ({specs.data.length})
              </button>
              {Object.entries(APPLIES).map(([k, label]) => {
                const cnt = specs.data!.filter((x) => x.applies_to === k).length;
                if (cnt === 0) return null;
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setAppliesFilter(appliesFilter === k ? "" : k)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition-colors cursor-pointer ${
                      appliesFilter === k
                        ? "bg-sky-700 text-white border-sky-700"
                        : "bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-100"
                    }`}
                  >
                    {label} ({cnt})
                  </button>
                );
              })}
            </div>
            <input
              className={`${inputClass} w-72`}
              placeholder="🔍 Tìm mã TC, tên tiêu chuẩn, mã/tên sản phẩm..."
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
            />
          </div>
        )}
        {specs.data?.length === 0 && <Empty>Chưa có tiêu chuẩn QC. Không có tiêu chuẩn hiệu lực thì không lấy mẫu QC được.</Empty>}
        {specs.data && specs.data.length > 0 && (
          <Table head={["Mã", "Rev", "Tên", "Áp dụng", "Vật tư / Sản phẩm được gán", "Chỉ tiêu", "Trạng thái", "Thao tác"]}>
            {specs.data
              .filter((s) => {
                if (appliesFilter && s.applies_to !== appliesFilter) return false;
                const q = searchQ.trim().toLowerCase();
                if (!q) return true;
                const assignedText = (s.assigned_items ?? []).map((x) => `${x.code} ${x.name}`).join(" ");
                const hay = `${s.code} ${s.name} ${s.item_code ?? ""} ${s.item_name ?? ""} ${assignedText}`.toLowerCase();
                return hay.includes(q);
              })
              .map((s) => {
                const isRowSelected = selected === s.id && !creating;
                const isRowAssign = assignTarget?.spec.id === s.id;
                return (
                  <React.Fragment key={s.id}>
                    <tr
                      className={`cursor-pointer transition-colors ${
                        isRowSelected || isRowAssign
                          ? "bg-sky-50/80 dark:bg-sky-950/30 font-semibold"
                          : "hover:bg-slate-50 dark:hover:bg-slate-800/50"
                      }`}
                      onClick={() => {
                        if (isRowSelected && !selectedInitialEdit) {
                          setSelected(null);
                        } else {
                          setSelectedInitialEdit(null);
                          setSelected(s.id);
                        }
                      }}
                    >
                      <td className="py-2 pr-3 font-mono font-semibold text-sky-700 dark:text-sky-400">{s.code}</td>
                      <td className="py-2 pr-3">{s.spec_version}</td>
                      <td className="py-2 pr-3">{s.name}</td>
                      <td className="py-2 pr-3 whitespace-nowrap">{APPLIES[s.applies_to]}</td>
                      <td className="py-2 pr-3 font-medium">{renderAssignedBadges(s)}</td>
                      <td className="py-2 pr-3">{s.parameter_count}</td>
                      <td className="py-2 pr-3 whitespace-nowrap"><StatusBadge status={SPEC_STATUS[s.status][0]} label={SPEC_STATUS[s.status][1]} /></td>
                      <td className="py-2 pr-3 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            title="Gán / Chọn một hoặc nhiều sản phẩm áp dụng tiêu chuẩn này"
                            className="px-2 py-1 rounded-lg text-[11px] font-medium border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                            onClick={() =>
                              isRowAssign && assignTarget?.mode === "ASSIGN"
                                ? setAssignTarget(null)
                                : openAssignModal(s, "ASSIGN")
                            }
                          >
                            {isRowAssign && assignTarget?.mode === "ASSIGN" ? "Đóng gán" : "🔗 Gán SP"}
                          </button>
                          <button
                            type="button"
                            title="Sao chép bộ chỉ tiêu sang mã TC mới cho sản phẩm khác"
                            className="px-2 py-1 rounded-lg text-[11px] font-medium border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                            onClick={() =>
                              isRowAssign && assignTarget?.mode === "CLONE"
                                ? setAssignTarget(null)
                                : openAssignModal(s, "CLONE")
                            }
                          >
                            {isRowAssign && assignTarget?.mode === "CLONE" ? "Đóng sao chép" : "📋 Sao chép"}
                          </button>
                          {canManage && (
                            <>
                              <button
                                type="button"
                                title="Sửa tiêu chuẩn QC và các chỉ tiêu kiểm nghiệm"
                                className="px-2 py-1 rounded-lg text-[11px] font-semibold border border-sky-300 dark:border-sky-800 bg-sky-50 dark:bg-sky-950/50 text-sky-800 dark:text-sky-300 hover:bg-sky-100 cursor-pointer"
                                onClick={() => {
                                  if (isRowSelected && selectedInitialEdit === "edit") {
                                    setSelected(null);
                                    setSelectedInitialEdit(null);
                                  } else {
                                    setSelected(s.id);
                                    setSelectedInitialEdit("edit");
                                  }
                                }}
                              >
                                {isRowSelected && selectedInitialEdit === "edit" ? "Đóng sửa" : "✏️ Sửa"}
                              </button>
                              <button
                                type="button"
                                disabled={deleteMut.isPending}
                                title="Xóa tiêu chuẩn QC này"
                                className="px-2 py-1 rounded-lg text-[11px] font-semibold border border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300 hover:bg-rose-100 cursor-pointer"
                                onClick={() => handleDeleteSpec(s)}
                              >
                                🗑️ Xóa
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                    {isRowAssign && (
                      <tr>
                        <td colSpan={8} className="py-2 pr-3">
                          {renderAssignCard()}
                        </td>
                      </tr>
                    )}
                    {isRowSelected && (
                      <tr>
                        <td colSpan={8} className="py-2 pr-3">
                          <SpecDetailPanel
                            key={`${s.id}-${selectedInitialEdit ?? "view"}`}
                            id={s.id}
                            initialEditing={selectedInitialEdit}
                            onClose={() => {
                              setSelected(null);
                              setSelectedInitialEdit(null);
                            }}
                            onOpenAssign={(sp, mode) => openAssignModal(sp, mode)}
                            onDelete={(sp) => handleDeleteSpec(sp)}
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

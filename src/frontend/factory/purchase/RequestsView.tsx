"use client";

import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ActionBar, type AllowedAction } from "../actions";
import { api, fmtDate, fmtQty } from "../api";
import { Button, Card, Empty, ErrorNote, Field, inputClass, StatusBadge, Table } from "../ui";
import { CatalogItemCombobox, type CatalogMasterItemOption } from "../warehouse/CatalogItemCombobox";

export const PR_STATUS: Record<string, [string, string]> = {
  DRAFT: ["PENDING_QC", "Nháp"],
  SUBMITTED: ["QUARANTINE", "Chờ trưởng phòng duyệt"],
  PENDING_BOD: ["QUARANTINE", "Chờ BGĐ duyệt"],
  APPROVED: ["RELEASED", "Đã duyệt"],
  ORDERED: ["RELEASED", "Đã đặt hàng"],
  REJECTED: ["REJECTED", "Từ chối"],
  CLOSED: ["EXPIRED", "Đã đóng"],
  CANCELLED: ["EXPIRED", "Đã hủy"],
};
const ACTION_LABEL: Record<string, string> = {
  submit: "Gửi duyệt",
  approve: "Duyệt",
  escalate: "Chuyển BGĐ duyệt",
  bod_approve: "BGĐ duyệt",
  reject: "Từ chối",
  return: "Trả lại để sửa",
  cancel: "Hủy đề nghị",
  close: "Đóng đề nghị",
};

interface PrReasonOption {
  id: string;
  category: string;
  label: string;
  value: string;
  entity_type?: string;
  entity_id?: string;
}

interface Option {
  id: string;
  code: string;
  name: string;
  warehouses: { id: string; code: string; name: string }[];
  reasons?: PrReasonOption[];
}

type CatalogMasterItem = CatalogMasterItemOption;

interface Line {
  mode: "CATALOG" | "NEW";
  item_id: string;
  label: string;
  new_item_code: string;
  new_item_name: string;
  item_type: "RAW_MATERIAL" | "REAGENT" | "CONSUMABLE" | "COMPONENT";
  qty: string;
  uom: string;
  est_price: string;
  notes: string;
}

const PR_UOM_GROUPS: Array<{ group: string; items: Array<{ code: string; label: string }> }> = [
  {
    group: "📦 Đóng gói & Vật chứa Lab",
    items: [
      { code: "Hộp", label: "Hộp" },
      { code: "Lọ", label: "Lọ (Vial)" },
      { code: "Chai", label: "Chai (Bottle)" },
      { code: "Tube", label: "Tube (Ống)" },
      { code: "Ống", label: "Ống" },
      { code: "Bộ", label: "Bộ (Set)" },
      { code: "Kit", label: "Kit" },
      { code: "Gói", label: "Gói (Pack)" },
      { code: "Túi", label: "Túi (Bag)" },
      { code: "Bịch", label: "Bịch" },
      { code: "Thùng", label: "Thùng (Carton)" },
      { code: "Đĩa", label: "Đĩa (Plate)" },
      { code: "Well", label: "Giếng (Well)" },
      { code: "Cột", label: "Cột (Column)" },
    ],
  },
  {
    group: "💧 Thể tích (Chất lỏng / Dung dịch)",
    items: [
      { code: "mL", label: "mL (Mililít)" },
      { code: "µL", label: "µL (Microlít)" },
      { code: "L", label: "L (Lít)" },
    ],
  },
  {
    group: "⚖️ Khối lượng (Hóa chất rắn / Bột)",
    items: [
      { code: "g", label: "g (Gam)" },
      { code: "mg", label: "mg (Miligam)" },
      { code: "µg", label: "µg (Microgam)" },
      { code: "kg", label: "kg (Kilôgam)" },
    ],
  },
  {
    group: "🧬 Sinh học phân tử & Hoạt độ",
    items: [
      { code: "Rxn", label: "Rxn (Phản ứng)" },
      { code: "Test", label: "Test (Xét nghiệm)" },
      { code: "nmol", label: "nmol (Nanomol)" },
      { code: "µmol", label: "µmol (Micromol)" },
      { code: "pmol", label: "pmol (Picomol)" },
      { code: "OD", label: "OD (Mật độ quang)" },
      { code: "U", label: "U (Unit Enzyme)" },
      { code: "kU", label: "kU (1000 Unit)" },
    ],
  },
  {
    group: "⚙️ Thiết bị, Linh kiện & Vật tư",
    items: [
      { code: "Cái", label: "Cái" },
      { code: "Chiếc", label: "Chiếc" },
      { code: "pcs", label: "pcs (Pieces)" },
      { code: "Cuộn", label: "Cuộn (Roll)" },
      { code: "Tấm", label: "Tấm (Sheet)" },
      { code: "Cây", label: "Cây" },
      { code: "m", label: "m (Mét)" },
      { code: "cm", label: "cm" },
      { code: "mm", label: "mm" },
    ],
  },
];
const ALL_PR_UOM_CODES = PR_UOM_GROUPS.flatMap((g) => g.items.map((i) => i.code));

function emptyLine(mode: "CATALOG" | "NEW" = "CATALOG"): Line {
  return {
    mode,
    item_id: "",
    label: "",
    new_item_code: "",
    new_item_name: "",
    item_type: "RAW_MATERIAL",
    qty: "1",
    uom: "Hộp",
    est_price: "",
    notes: "",
  };
}

function NewRequestForm({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const options = useQuery({ queryKey: ["factory", "pr-options"], queryFn: () => api<Option[]>("/api/factory/purchase/request-options") });
  const uoms = useQuery({ queryKey: ["factory", "uoms"], queryFn: () => api<{ code: string }[]>("/api/factory/master/uoms") });
  const catalogItems = useQuery({
    queryKey: ["factory", "items", "pr-catalog-all"],
    queryFn: () => api<{ rows: CatalogMasterItem[]; total: number }>("/api/factory/master/items?page_size=2000&status=ACTIVE"),
  });
  const [head, setHead] = useState({
    org_unit_id: "",
    target_warehouse_id: "",
    needed_by: "",
    reasonPreset: "",
    reason: "",
    purpose_entity_type: null as string | null,
    purpose_entity_id: null as string | null,
  });
  const [lines, setLines] = useState<Line[]>(() => [emptyLine("CATALOG")]);
  const unit = options.data?.find((o) => o.id === head.org_unit_id);

  React.useEffect(() => {
    if (!options.data?.length || head.org_unit_id) return;
    const first = options.data[0];
    const firstReason = first.reasons?.[0];
    setHead({
      org_unit_id: first.id,
      target_warehouse_id: first.warehouses[0]?.id ?? "",
      needed_by: "",
      reasonPreset: firstReason?.id ?? "",
      reason: firstReason?.value ?? "",
      purpose_entity_type: firstReason?.entity_type ?? null,
      purpose_entity_id: firstReason?.entity_id ?? null,
    });
  }, [options.data, head.org_unit_id]);

  const groupedReasons = React.useMemo(() => {
    const groups = new Map<string, PrReasonOption[]>();
    for (const r of unit?.reasons ?? []) {
      const list = groups.get(r.category) ?? [];
      list.push(r);
      groups.set(r.category, list);
    }
    return Array.from(groups.entries());
  }, [unit]);

  const validLines = lines.filter((l) => {
    const q = Number(String(l.qty || "").replace(",", "."));
    if (!(q > 0)) return false;
    return l.mode === "CATALOG" ? Boolean(l.item_id) : Boolean(l.new_item_name.trim() || l.new_item_code.trim());
  });

  const create = useMutation({
    mutationFn: () =>
      api("/api/factory/purchase/requests", {
        method: "POST",
        idempotent: true,
        json: {
          org_unit_id: head.org_unit_id,
          target_warehouse_id: head.target_warehouse_id,
          needed_by: head.needed_by || null,
          reason: head.reason.trim(),
          purpose_entity_type: head.purpose_entity_type,
          purpose_entity_id: head.purpose_entity_id,
          auto_submit: true,
          lines: validLines.map((l) => ({
            item_id: l.mode === "CATALOG" ? l.item_id : null,
            new_item_code: l.mode === "NEW" ? l.new_item_code.trim() || null : null,
            new_item_name: l.mode === "NEW" ? l.new_item_name.trim() || null : null,
            item_type: l.mode === "NEW" ? l.item_type : null,
            qty: Number(l.qty.replace(",", ".")),
            uom: l.uom || "Hộp",
            est_price: l.est_price ? Number(l.est_price) : null,
            notes: l.notes.trim() || null,
          })),
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["factory", "prs"] });
      qc.invalidateQueries({ queryKey: ["factory", "items"] });
      onDone();
    },
  });
  const setL = (i: number, p: Partial<Line>) => setLines((prev) => prev.map((l, j) => (j === i ? { ...l, ...p } : l)));

  if (options.data && options.data.length === 0) {
    return <Card title="Đề nghị mua mới"><Empty>Bạn chưa được cấp quyền lập đề nghị mua cho phòng nào.</Empty><Button variant="ghost" onClick={onDone}>Đóng</Button></Card>;
  }
  return (
    <Card title="Đề nghị mua NVL mới">
      <form className="flex flex-col gap-3 text-xs" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-12">
          <div className="lg:col-span-3">
            <Field label="Phòng đề nghị *">
              <select
                className={inputClass}
                value={head.org_unit_id}
                onChange={(e) => {
                  const nextId = e.target.value;
                  const u = options.data?.find((o) => o.id === nextId);
                  const r0 = u?.reasons?.[0];
                  setHead({
                    ...head,
                    org_unit_id: nextId,
                    target_warehouse_id: u?.warehouses[0]?.id ?? "",
                    reasonPreset: r0?.id ?? "",
                    reason: r0?.value ?? head.reason,
                    purpose_entity_type: r0?.entity_type ?? null,
                    purpose_entity_id: r0?.entity_id ?? null,
                  });
                }}
                required
              >
                <option value="">Chọn phòng</option>
                {options.data?.map((o) => <option key={o.id} value={o.id}>{o.code} — {o.name}</option>)}
              </select>
            </Field>
          </div>
          <div className="lg:col-span-3">
            <Field label="Kho nhận *">
              <select className={inputClass} value={head.target_warehouse_id} onChange={(e) => setHead({ ...head, target_warehouse_id: e.target.value })} required>
                <option value="">Chọn kho</option>
                {unit?.warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} — {w.name}</option>)}
              </select>
            </Field>
          </div>
          <div className="lg:col-span-2">
            <Field label="Cần trước ngày"><input className={inputClass} type="date" value={head.needed_by} onChange={(e) => setHead({ ...head, needed_by: e.target.value })} /></Field>
          </div>
          <div className="lg:col-span-4">
            <Field label="Chọn Lý do / Dự án / Lệnh SX từ danh mục *">
              <select
                className={inputClass}
                value={head.reasonPreset}
                onChange={(e) => {
                  const valId = e.target.value;
                  const found = unit?.reasons?.find((r) => r.id === valId);
                  setHead({
                    ...head,
                    reasonPreset: valId,
                    reason: found ? found.value : head.reason,
                    purpose_entity_type: found?.entity_type ?? null,
                    purpose_entity_id: found?.entity_id ?? null,
                  });
                }}
              >
                <option value="">-- Chọn từ danh mục Lý do / Dự án / Lệnh SX --</option>
                {groupedReasons.map(([cat, items]) => (
                  <optgroup key={cat} label={cat}>
                    {items.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                  </optgroup>
                ))}
                <option value="__CUSTOM__">✍️ Tự nhập lý do khác...</option>
              </select>
            </Field>
          </div>
        </div>
        <Field label="Chi tiết Lý do / Mã Lệnh SX / Dự án *">
          <input className={inputClass} value={head.reason} onChange={(e) => setHead({ ...head, reason: e.target.value })} placeholder="Chọn từ danh mục phía trên hoặc nhập nội dung lý do cụ thể..." required />
        </Field>
        <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-2xl border border-amber-200 dark:border-amber-800/70 bg-amber-50/50 dark:bg-amber-950/20">
          <span className="font-bold text-slate-800 dark:text-slate-100 flex items-center gap-1.5">
            🧪 Danh sách Nguyên vật liệu / Hóa chất đề nghị mua ({lines.length} dòng)
            {catalogItems.data?.total ? (
              <span className="font-normal text-[11px] text-slate-500 dark:text-slate-400">
                · {catalogItems.data.total.toLocaleString("vi-VN")} mã trong danh mục
              </span>
            ) : null}
          </span>
          <div className="flex items-center gap-2">
            <Button type="button" variant="secondary" onClick={() => setLines((prev) => [...prev, emptyLine("CATALOG")])}>+ Thêm từ DS có sẵn</Button>
            <Button type="button" variant="secondary" onClick={() => setLines((prev) => [...prev, emptyLine("NEW")])}>✨ + Gõ mã/tên mới</Button>
          </div>
        </div>
        {lines.length > 0 && (
          <Table head={["Nguồn", "Mã & Tên Vật tư / Hóa chất *", "Số lượng *", "ĐVT *", "Đơn giá ước tính (VND)", "Ghi chú", ""]}>
            {lines.map((l, i) => (
              <tr key={i}>
                <td className="py-2 pr-2 w-36">
                  <select className={inputClass} value={l.mode} onChange={(e) => setL(i, { mode: e.target.value as "CATALOG" | "NEW" })}>
                    <option value="CATALOG">📚 DS có sẵn</option>
                    <option value="NEW">✨ Mã/tên mới</option>
                  </select>
                </td>
                <td className="py-2 pr-2 min-w-[280px]">
                  {l.mode === "CATALOG" ? (
                    <CatalogItemCombobox
                      value={l.item_id}
                      selectedLabel={l.label}
                      items={catalogItems.data?.rows ?? []}
                      totalCatalogCount={catalogItems.data?.total}
                      onSelect={(it) => {
                        setL(i, {
                          item_id: it.id,
                          label: `${it.code} — ${it.name}`,
                          uom: it.base_uom && !/^[-–—]+$/.test(it.base_uom.trim()) ? it.base_uom : l.uom || "Hộp",
                        });
                      }}
                      onClear={() => setL(i, { item_id: "", label: "" })}
                      onSwitchToNew={(typed) => {
                        const isCodeLike = /^[A-Za-z0-9._-]{2,30}$/.test(typed) && /[0-9._-]/.test(typed);
                        setL(i, {
                          mode: "NEW",
                          item_id: "",
                          label: "",
                          new_item_code: isCodeLike ? typed.toUpperCase() : "",
                          new_item_name: isCodeLike ? "" : typed,
                        });
                      }}
                    />
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-12 gap-1.5">
                      <div className="sm:col-span-4">
                        <input className={inputClass} placeholder="Mã mới (tự động nếu trống)" value={l.new_item_code} onChange={(e) => setL(i, { new_item_code: e.target.value.toUpperCase() })} />
                      </div>
                      <div className="sm:col-span-8">
                        <input className={inputClass} placeholder="Tên nguyên vật liệu / hóa chất mới *" value={l.new_item_name} onChange={(e) => setL(i, { new_item_name: e.target.value })} required={l.mode === "NEW"} />
                      </div>
                    </div>
                  )}
                </td>
                <td className="py-2 pr-2 w-24"><input className={inputClass} inputMode="decimal" value={l.qty} onChange={(e) => setL(i, { qty: e.target.value })} required /></td>
                <td className="py-2 pr-2 w-32">
                  <select
                    className={`${inputClass} font-semibold`}
                    value={l.uom || "Hộp"}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val === "__CUSTOM_UOM__") {
                        const custom = window.prompt("Nhập Đơn vị tính (ĐVT) khác:", l.uom || "");
                        if (custom && custom.trim()) {
                          setL(i, { uom: custom.trim() });
                        }
                        return;
                      }
                      setL(i, { uom: val });
                    }}
                    required
                  >
                    {l.uom && !ALL_PR_UOM_CODES.includes(l.uom) && (
                      <option value={l.uom}>{l.uom}</option>
                    )}
                    {PR_UOM_GROUPS.map((grp) => (
                      <optgroup key={grp.group} label={grp.group}>
                        {grp.items.map((it) => (
                          <option key={it.code} value={it.code}>
                            {it.label}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                    {(uoms.data ?? [])
                      .filter((u) => !ALL_PR_UOM_CODES.includes(u.code))
                      .map((u) => (
                        <option key={u.code} value={u.code}>
                          {u.code}
                        </option>
                      ))}
                    <option value="__CUSTOM_UOM__">✍️ + Gõ ĐVT khác...</option>
                  </select>
                </td>
                <td className="py-2 pr-2 w-36"><input className={inputClass} inputMode="numeric" value={l.est_price} onChange={(e) => setL(i, { est_price: e.target.value.replace(/\D/g, "") })} /></td>
                <td className="py-2 pr-2 w-40"><input className={inputClass} placeholder="Quy cách, hãng..." value={l.notes} onChange={(e) => setL(i, { notes: e.target.value })} /></td>
                <td className="py-2 pr-2"><button type="button" className="text-rose-600 text-xs cursor-pointer" onClick={() => setLines((prev) => prev.length > 1 ? prev.filter((_, j) => j !== i) : [emptyLine("CATALOG")])}>Xóa</button></td>
              </tr>
            ))}
          </Table>
        )}
        <ErrorNote error={create.error ?? options.error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onDone}>Hủy</Button>
          <Button type="submit" disabled={create.isPending || !validLines.length || !head.reason.trim()}>{create.isPending ? "Đang lưu…" : `Lưu & Gửi đề nghị mua (${validLines.length} mục)`}</Button>
        </div>
      </form>
    </Card>
  );
}

interface PrDetail {
  id: string; code: string; status: string; version: number; org_unit_name: string; warehouse_code: string; warehouse_name: string;
  requester_name: string; approver_name: string | null; needed_by: string | null; reason: string; est_total: string; requires_bod: boolean;
  lines: {
    id: string;
    line_no: number;
    item_code: string;
    item_name: string;
    qty: string;
    uom: string;
    est_price: string | null;
    qty_ordered: string;
    notes?: string | null;
    linked_po_code?: string | null;
    linked_po_status?: string | null;
    linked_mo_code?: string | null;
    linked_mo_status?: string | null;
  }[];
  actions: AllowedAction[];
}

function RequestDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();
  const pr = useQuery({ queryKey: ["factory", "pr", id], queryFn: () => api<PrDetail>(`/api/factory/purchase/requests/${id}`) });
  const p = pr.data;
  return (
    <Card title={p ? `Đề nghị ${p.code}` : "Đề nghị mua"} actions={<Button variant="ghost" onClick={onClose}>Đóng</Button>}>
      <ErrorNote error={pr.error} />
      {p && (
        <div className="flex flex-col gap-3">
          <p className="text-xs text-slate-600 dark:text-slate-300">
            <StatusBadge status={PR_STATUS[p.status][0]} label={PR_STATUS[p.status][1]} /> · {p.org_unit_name} → kho {p.warehouse_code} · Người lập: {p.requester_name}
            {p.approver_name && <> · Duyệt: {p.approver_name}</>} · Cần trước: {fmtDate(p.needed_by)} · Ước tính: {fmtQty(p.est_total)} đ{p.requires_bod && " (vượt ngưỡng, cần BGĐ)"}
          </p>
          <p className="text-xs">Lý do: {p.reason}</p>
          <Table head={["#", "Vật tư", "Số lượng yêu cầu", "Đã cấp / Đã đặt", "Tiến độ từng dòng (Số Lot · Ngày cấp · Lệnh P.SX · PO)", "Đơn giá ước tính"]}>
            {p.lines.map((l) => {
              const reqQty = Number(l.qty) || 0;
              const ordQty = Number(l.qty_ordered) || 0;
              const isFulfilled = ordQty >= reqQty && reqQty > 0;
              return (
                <tr key={l.id} className={isFulfilled ? "bg-emerald-50/40 dark:bg-emerald-950/15" : ""}>
                  <td className="py-2 pr-3">{l.line_no}</td>
                  <td className="py-2 pr-3">
                    <b>{l.item_code}</b> — {l.item_name}
                  </td>
                  <td className="py-2 pr-3 whitespace-nowrap font-semibold">{fmtQty(l.qty)} {l.uom}</td>
                  <td className="py-2 pr-3 whitespace-nowrap font-bold">
                    {fmtQty(l.qty_ordered)} / {fmtQty(l.qty)} {l.uom}
                  </td>
                  <td className="py-2 pr-3 text-xs">
                    {l.linked_po_code ? (
                      <span className="font-bold text-sky-700 dark:text-sky-400">
                        🛒 Đang đặt mua PO: {l.linked_po_code} ({l.linked_po_status})
                      </span>
                    ) : l.linked_mo_code && !isFulfilled ? (
                      <span className="font-bold text-amber-700 dark:text-amber-300">
                        ⏳ Đang chờ P.SX pha chế ({l.linked_mo_code} · {l.linked_mo_status || "IN_PROGRESS"})
                      </span>
                    ) : isFulfilled ? (
                      <span className="font-bold text-emerald-700 dark:text-emerald-400">
                        {l.notes || "✅ Đã cấp hoàn tất"}
                      </span>
                    ) : l.notes ? (
                      <span className="font-semibold text-indigo-700 dark:text-indigo-300">{l.notes}</span>
                    ) : (
                      <span className="text-slate-400">⏳ Chờ Kho / Cung ứng điều phối</span>
                    )}
                  </td>
                  <td className="py-2 pr-3">{l.est_price ? `${fmtQty(l.est_price)} đ` : "—"}</td>
                </tr>
              );
            })}
          </Table>
          <ActionBar endpoint={`/api/factory/purchase/requests/${p.id}/actions`} version={p.version} actions={p.actions} labels={ACTION_LABEL} onDone={() => { qc.invalidateQueries({ queryKey: ["factory", "pr", id] }); qc.invalidateQueries({ queryKey: ["factory", "prs"] }); }} />
        </div>
      )}
    </Card>
  );
}

export function RequestsView() {
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [deptFilter, setDeptFilter] = useState("");
  const list = useQuery({
    queryKey: ["factory", "prs", status],
    queryFn: () => api<{ id: string; code: string; status: string; org_unit_name: string; warehouse_code: string; requester_name: string; needed_by: string | null; est_total: string; line_count: number; reason: string }[]>(`/api/factory/purchase/requests${status ? `?status=${status}` : ""}`),
  });
  const departments = Array.from(new Set((list.data ?? []).map((r) => r.org_unit_name).filter(Boolean)));
  const filteredRows = (list.data ?? []).filter((r) => !deptFilter || r.org_unit_name === deptFilter);

  return (
    <div className="flex flex-col gap-3">
      {creating && <NewRequestForm onDone={() => setCreating(false)} />}
      {selected && <RequestDetail key={selected} id={selected} onClose={() => setSelected(null)} />}
      <Card
        title="Đề nghị mua NVL tập trung (R&D · Sản xuất Kit · Oligo · Kỹ thuật Thiết bị · QA/QC)"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {departments.length > 1 && (
              <select className={`${inputClass} w-52`} value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)} aria-label="Phòng ban">
                <option value="">Tất cả phòng ban ({list.data?.length ?? 0})</option>
                {departments.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            )}
            <select className={`${inputClass} w-48`} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Trạng thái">
              <option value="">Mọi trạng thái</option>
              {Object.entries(PR_STATUS).map(([k, [, v]]) => <option key={k} value={k}>{v}</option>)}
            </select>
            {!creating && <Button onClick={() => setCreating(true)}>+ Đề nghị mua</Button>}
          </div>
        }
      >
        <ErrorNote error={list.error} />
        {filteredRows.length === 0 && <Empty>Chưa có đề nghị mua phù hợp bộ lọc.</Empty>}
        {filteredRows.length > 0 && (
          <Table head={["Mã", "Phòng đề xuất", "Kho nhánh nhận", "Người lập", "Mục đích / Lý do", "Cần trước", "Ước tính", "Dòng", "Trạng thái"]}>
            {filteredRows.map((r) => (
              <tr key={r.id} className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50" onClick={() => setSelected(r.id)}>
                <td className="py-2 pr-3 font-mono font-semibold text-sky-700 dark:text-sky-400">{r.code}</td>
                <td className="py-2 pr-3 font-semibold">{r.org_unit_name}</td>
                <td className="py-2 pr-3 font-mono">{r.warehouse_code}</td>
                <td className="py-2 pr-3">{r.requester_name}</td>
                <td className="py-2 pr-3 text-xs text-slate-600 dark:text-slate-300 max-w-64 truncate">{r.reason}</td>
                <td className="py-2 pr-3 whitespace-nowrap">{fmtDate(r.needed_by)}</td>
                <td className="py-2 pr-3 text-right whitespace-nowrap">{fmtQty(r.est_total)} đ</td>
                <td className="py-2 pr-3">{r.line_count}</td>
                <td className="py-2 pr-3"><StatusBadge status={PR_STATUS[r.status][0]} label={PR_STATUS[r.status][1]} /></td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}

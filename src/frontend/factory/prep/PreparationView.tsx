"use client";

import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, fmtDate, fmtQty } from "../api";
import { Button, Card, Empty, ErrorNote, Field, inputClass, StatusBadge, Table } from "../ui";
import { ItemPicker } from "../oligo/EquipmentView";

interface Line { line_no?: number; item_id: string; qty: number; uom: string; item_code?: string; item_name?: string }
interface Formula {
  id: string; code: string; name: string; category: string | null; output_item_id: string; output_code: string; output_name: string; basis_qty: number; basis_uom: string;
  shelf_life_days: number | null; requires_qc: boolean; instructions: string | null; status: string; version: number; lines: Line[];
}
interface Prep {
  id: string; code: string; status: string; qty_out: number; uom_out: string; prepared_at: string; formula_code: string; formula_name: string; lot_code: string; lot_status: string;
  expiry_date: string | null; prepared_by_name: string | null; notes: string | null; cancel_reason: string | null;
  lines: { item_code: string; lot_code: string | null; qty_base: number; uom: string }[];
}
interface WhOpt { id: string; code: string; name: string; locations: { id: string; code: string; name: string }[] }

const LOT_STATUS: Record<string, string> = { QUARANTINE: "Biệt trữ — chờ QC", PENDING_QC: "Chờ QC", RELEASED: "Đạt", ON_HOLD: "Tạm giữ", REJECTED: "Không đạt", EXPIRED: "Hết hạn" };

function FormulaEditor({ base, onClose }: { base?: Formula; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({
    code: base?.code ?? "", name: base?.name ?? "", category: base?.category ?? "", output_item_id: base?.output_item_id ?? "", basis_qty: String(base?.basis_qty ?? ""),
    basis_uom: base?.basis_uom ?? "mL", shelf_life_days: base?.shelf_life_days ? String(base.shelf_life_days) : "", requires_qc: base?.requires_qc ?? false,
    instructions: base?.instructions ?? "", status: base?.status ?? "ACTIVE",
  });
  const [lines, setLines] = useState<(Line & { label?: string })[]>(base?.lines.map((l) => ({ ...l, label: `${l.item_code} · ${l.item_name}` })) ?? [{ item_id: "", qty: 0, uom: "mL" }]);
  const save = useMutation({
    mutationFn: () => {
      const body = { ...f, basis_qty: Number(f.basis_qty), shelf_life_days: f.shelf_life_days ? Number(f.shelf_life_days) : null, lines: lines.map((l) => ({ item_id: l.item_id, qty: Number(l.qty), uom: l.uom })) };
      if (!base) return api("/api/factory/prep/formulas", { method: "POST", idempotent: true, json: body });
      const reason = window.prompt("Lý do sửa công thức:");
      if (!reason) throw new Error("Cần lý do sửa.");
      return api(`/api/factory/prep/formulas/${base.id}`, { method: "PUT", json: { ...body, version: base.version, reason } });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["factory", "prep-formulas"] });
      onClose();
    },
  });
  return (
    <form className="flex flex-col gap-3 p-3 rounded-xl border border-sky-200 dark:border-sky-900 bg-sky-50/60 dark:bg-sky-950/30" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6 items-end">
        <Field label="Mã *"><input className={inputClass} value={f.code} disabled={!!base} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} required /></Field>
        <Field label="Tên *"><input className={inputClass} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></Field>
        <Field label="Nhóm"><input className={inputClass} list="prep-categories" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} /></Field>
        <Field label="Mẻ chuẩn *" hint="Lượng thành phẩm mà các nguyên liệu dưới tạo ra">
          <div className="flex gap-1">
            <input className={inputClass} type="number" step="any" min="0" value={f.basis_qty} onChange={(e) => setF({ ...f, basis_qty: e.target.value })} required />
            <input className={`${inputClass} w-16`} value={f.basis_uom} onChange={(e) => setF({ ...f, basis_uom: e.target.value })} required aria-label="Đơn vị" />
          </div>
        </Field>
        <Field label="Hạn dùng (ngày)" hint="Không quá hạn nguyên liệu sớm nhất"><input className={inputClass} type="number" min="1" value={f.shelf_life_days} onChange={(e) => setF({ ...f, shelf_life_days: e.target.value })} /></Field>
        <Field label="Trạng thái">
          <select className={inputClass} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
            <option value="ACTIVE">Đang dùng</option>
            <option value="INACTIVE">Ngừng</option>
          </select>
        </Field>
      </div>
      <datalist id="prep-categories">{["Tổng hợp", "Pha loãng amidite", "Khử bảo vệ", "Tinh sạch", "Đệm HPLC", "Khác"].map((c) => <option key={c} value={c} />)}</datalist>
      <div className="flex flex-wrap gap-3 items-center text-xs">
        <span>Thành phẩm pha:</span>
        <ItemPicker value={f.output_item_id} current={base ? `${base.output_code} · ${base.output_name}` : undefined} onChange={(id) => setF({ ...f, output_item_id: id })} />
        <label className="flex items-center gap-1"><input type="checkbox" checked={f.requires_qc} onChange={(e) => setF({ ...f, requires_qc: e.target.checked })} />Cần QC trước khi dùng</label>
      </div>
      <div className="text-xs font-bold">Nguyên liệu (cho một mẻ chuẩn)</div>
      {lines.map((l, i) => (
        <div key={i} className="flex flex-wrap gap-2 items-center text-xs">
          <ItemPicker value={l.item_id} current={l.label} onChange={(id) => setLines(lines.map((x, j) => (j === i ? { ...x, item_id: id } : x)))} />
          <input className={`${inputClass} w-24`} type="number" step="any" min="0" value={l.qty || ""} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, qty: Number(e.target.value) } : x)))} required aria-label="Lượng" />
          <input className={`${inputClass} w-16`} value={l.uom} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, uom: e.target.value } : x)))} required aria-label="Đơn vị" />
          {lines.length > 1 && <button type="button" className="text-rose-600 cursor-pointer" onClick={() => setLines(lines.filter((_, j) => j !== i))}>Xóa</button>}
        </div>
      ))}
      <Field label="Hướng dẫn pha"><textarea className={`${inputClass} h-20`} value={f.instructions} onChange={(e) => setF({ ...f, instructions: e.target.value })} /></Field>
      <div className="flex gap-2">
        <Button type="button" variant="ghost" onClick={() => setLines([...lines, { item_id: "", qty: 0, uom: "mL" }])}>+ Nguyên liệu</Button>
        <Button type="button" variant="ghost" onClick={onClose}>Hủy</Button>
        <Button type="submit" disabled={save.isPending}>Lưu công thức</Button>
      </div>
      <ErrorNote error={save.error} />
    </form>
  );
}

function PrepareForm({ formula, onDone }: { formula: Formula; onDone: () => void }) {
  const opts = useQuery({ queryKey: ["factory", "prep-options"], queryFn: () => api<WhOpt[]>("/api/factory/prep/options") });
  const [f, setF] = useState({ qty: String(formula.basis_qty), uom: formula.basis_uom, warehouse_id: "", to_location_id: "", notes: "" });
  const wh = opts.data?.find((w) => w.id === f.warehouse_id) ?? (opts.data?.length === 1 ? opts.data[0] : undefined);
  const factor = Number(f.qty) / formula.basis_qty;
  const run = useMutation({
    mutationFn: () =>
      api<{ code: string; lot_code: string; qc_needed: boolean }>("/api/factory/prep/preparations", {
        method: "POST",
        idempotent: true,
        json: { formula_id: formula.id, qty: Number(f.qty), uom: f.uom, warehouse_id: wh?.id, to_location_id: formula.requires_qc ? null : f.to_location_id || null, notes: f.notes || null },
      }),
    onSuccess: onDone,
  });
  if (opts.data && !opts.data.length) return <Empty>Bạn chưa có quyền pha chế ở kho nào.</Empty>;
  return (
    <form className="flex flex-col gap-3 p-3 rounded-xl border border-sky-200 dark:border-sky-900 bg-sky-50/60 dark:bg-sky-950/30" onSubmit={(e) => { e.preventDefault(); run.mutate(); }}>
      <div className="text-xs font-bold">Lệnh pha: {formula.code} — {formula.name} → {formula.output_code} {formula.output_name}</div>
      <div className="grid gap-3 sm:grid-cols-4 items-end">
        <Field label="Lượng pha *">
          <div className="flex gap-1">
            <input className={inputClass} type="number" step="any" min="0" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} required />
            <input className={`${inputClass} w-16`} value={f.uom} onChange={(e) => setF({ ...f, uom: e.target.value })} required aria-label="Đơn vị" />
          </div>
        </Field>
        {(opts.data?.length ?? 0) > 1 && (
          <Field label="Kho *">
            <select className={inputClass} value={f.warehouse_id} onChange={(e) => setF({ ...f, warehouse_id: e.target.value, to_location_id: "" })} required>
              <option value="">Chọn</option>
              {opts.data?.map((w) => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}
            </select>
          </Field>
        )}
        {formula.requires_qc ? (
          <p className="text-[11px] text-slate-500">Lô pha vào vị trí biệt trữ, chờ QA/QC lấy mẫu và giải phóng.</p>
        ) : (
          <Field label="Cất vào vị trí *">
            <select className={inputClass} value={f.to_location_id} onChange={(e) => setF({ ...f, to_location_id: e.target.value })} required>
              <option value="">Chọn</option>
              {wh?.locations.map((l) => <option key={l.id} value={l.id}>{l.code} · {l.name}</option>)}
            </select>
          </Field>
        )}
        <Field label="Ghi chú"><input className={inputClass} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      </div>
      {f.uom === formula.basis_uom && factor > 0 && (
        <Table head={["Nguyên liệu", "Cần dùng (ước tính)"]}>
          {formula.lines.map((l) => (
            <tr key={l.line_no}>
              <td className="py-1 pr-3 text-xs">{l.item_code} · {l.item_name}</td>
              <td className="py-1 pr-3 text-right text-xs">{fmtQty(Math.round(l.qty * factor * 1e6) / 1e6)} {l.uom}</td>
            </tr>
          ))}
        </Table>
      )}
      <p className="text-[11px] text-slate-500">Nguyên liệu lấy theo hạn dùng sớm nhất (lô đã giải phóng, còn hạn). Hạn của lô pha không vượt hạn nguyên liệu sớm nhất.</p>
      <div><Button type="submit" disabled={run.isPending}>{run.isPending ? "Đang pha…" : "Xác nhận pha chế"}</Button></div>
      {run.data && <p className="text-xs text-emerald-700 dark:text-emerald-400">Đã tạo lệnh {run.data.code}, lô {run.data.lot_code}{run.data.qc_needed ? " (chờ QC)" : ""}.</p>}
      <ErrorNote error={run.error} />
    </form>
  );
}

/** "Pha chế hóa chất" (as OligoFlow): formulas, the preparation order and the preparation log. */
export function PreparationView({ canManage, canExecute }: { canManage: boolean; canExecute: boolean }) {
  const qc = useQueryClient();
  const formulas = useQuery({ queryKey: ["factory", "prep-formulas"], queryFn: () => api<Formula[]>("/api/factory/prep/formulas") });
  const preps = useQuery({ queryKey: ["factory", "prep-log"], queryFn: () => api<Prep[]>("/api/factory/prep/preparations") });
  const [editing, setEditing] = useState<Formula | "new" | null>(null);
  const [preparing, setPreparing] = useState<Formula | null>(null);
  const cancel = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => api(`/api/factory/prep/preparations/${id}/cancel`, { method: "POST", json: { reason } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["factory", "prep-log"] }),
  });
  return (
    <div className="flex flex-col gap-3">
      <Card title="Công thức pha chế" actions={canManage && !editing && <Button onClick={() => setEditing("new")}>+ Công thức</Button>}>
        {editing && <FormulaEditor key={editing === "new" ? "new" : editing.id} base={editing === "new" ? undefined : editing} onClose={() => setEditing(null)} />}
        {preparing && <PrepareForm key={preparing.id} formula={preparing} onDone={() => { qc.invalidateQueries({ queryKey: ["factory", "prep-log"] }); }} />}
        <ErrorNote error={formulas.error} />
        {formulas.data?.length === 0 && !editing && <Empty>Chưa có công thức (ví dụ: Deblock 3% TCA/DCM, Cap A/B, Oxidizer, pha loãng amidite 0.1 M, đệm HPLC).</Empty>}
        {formulas.data && formulas.data.length > 0 && (
          <Table head={["Mã", "Tên / nhóm", "Thành phẩm", "Mẻ chuẩn", "Nguyên liệu", "Hạn / QC", ""]}>
            {formulas.data.map((f) => (
              <tr key={f.id} className={f.status === "ACTIVE" ? "" : "opacity-50"}>
                <td className="py-1.5 pr-3 font-mono text-xs">{f.code}</td>
                <td className="py-1.5 pr-3">{f.name}{f.category && <div className="text-[11px] text-slate-500">{f.category}</div>}</td>
                <td className="py-1.5 pr-3 text-xs">{f.output_code} · {f.output_name}</td>
                <td className="py-1.5 pr-3 text-xs whitespace-nowrap">{fmtQty(f.basis_qty)} {f.basis_uom}</td>
                <td className="py-1.5 pr-3 text-xs">{f.lines.map((l) => `${l.item_code} ${fmtQty(l.qty)} ${l.uom}`).join(" · ")}</td>
                <td className="py-1.5 pr-3 text-xs">{f.shelf_life_days ? `${f.shelf_life_days} ngày` : "—"}{f.requires_qc && " · cần QC"}</td>
                <td className="py-1.5 pr-3 text-right whitespace-nowrap">
                  {canExecute && f.status === "ACTIVE" && <Button variant="ghost" onClick={() => setPreparing(preparing?.id === f.id ? null : f)}>Pha</Button>}
                  {canManage && <Button variant="ghost" onClick={() => setEditing(f)}>Sửa</Button>}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <Card title="Nhật ký pha chế">
        <ErrorNote error={preps.error ?? cancel.error} />
        {preps.data?.length === 0 && <Empty>Chưa có lệnh pha.</Empty>}
        {preps.data && preps.data.length > 0 && (
          <Table head={["Lệnh", "Công thức", "Lô pha", "Lượng", "Nguyên liệu đã dùng (lô)", "Hạn dùng", "Người / lúc", ""]}>
            {preps.data.map((p) => (
              <tr key={p.id} className={p.status === "CANCELLED" ? "opacity-50" : ""}>
                <td className="py-1.5 pr-3 font-mono text-xs">{p.code}{p.status === "CANCELLED" && <div className="font-sans text-rose-600">Đã hủy: {p.cancel_reason}</div>}</td>
                <td className="py-1.5 pr-3 text-xs">{p.formula_code} · {p.formula_name}</td>
                <td className="py-1.5 pr-3 text-xs"><span className="font-mono">{p.lot_code}</span> <StatusBadge status={p.lot_status} label={LOT_STATUS[p.lot_status]} /></td>
                <td className="py-1.5 pr-3 text-right text-xs whitespace-nowrap">{fmtQty(p.qty_out)} {p.uom_out}</td>
                <td className="py-1.5 pr-3 text-xs">{p.lines.map((l) => `${l.item_code} ${l.lot_code ?? ""} ${fmtQty(l.qty_base)} ${l.uom}`).join(" · ")}</td>
                <td className="py-1.5 pr-3 text-xs">{fmtDate(p.expiry_date)}</td>
                <td className="py-1.5 pr-3 text-xs whitespace-nowrap">{p.prepared_by_name ?? ""} · {new Date(p.prepared_at).toLocaleString("vi-VN")}</td>
                <td className="py-1.5 pr-3 text-right">
                  {canExecute && p.status === "DONE" && (
                    <Button variant="ghost" onClick={() => { const r = window.prompt("Lý do hủy lệnh pha (chỉ hủy được khi lô pha chưa dùng):"); if (r) cancel.mutate({ id: p.id, reason: r }); }}>Hủy</Button>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}

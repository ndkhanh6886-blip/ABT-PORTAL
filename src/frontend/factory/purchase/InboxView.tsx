"use client";

import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, fmtDate, fmtQty } from "../api";
import { Button, Card, Empty, ErrorNote, Field, inputClass, Table } from "../ui";

interface OpenLine {
  pr_line_id: string;
  pr_code: string;
  needed_by: string | null;
  org_unit_name: string;
  warehouse_code: string;
  item_code: string;
  item_name: string;
  uom: string;
  qty_open: string;
  est_price: string | null;
}
interface Pick { qty: string; unit_price: string; vat_rate: string }

/** Approved request lines not yet ordered: Cung ứng NVL picks lines (any department) and creates one order per supplier. */
export function InboxView({ onCreated }: { onCreated: (poId: string) => void }) {
  const qc = useQueryClient();
  const lines = useQuery({ queryKey: ["factory", "pr-inbox"], queryFn: () => api<OpenLine[]>("/api/factory/purchase/inbox") });
  const suppliers = useQuery({ queryKey: ["factory", "partners", "supplier"], queryFn: () => api<{ id: string; code: string; name: string }[]>("/api/factory/master/partners?role=supplier") });
  const [picked, setPicked] = useState<Record<string, Pick>>({});
  const [head, setHead] = useState({ supplier_id: "", expected_date: "", payment_terms: "" });
  const create = useMutation({
    mutationFn: () =>
      api<{ id: string }>("/api/factory/purchase/orders", {
        method: "POST",
        idempotent: true,
        json: {
          ...head,
          expected_date: head.expected_date || null,
          lines: Object.entries(picked).map(([pr_line_id, p]) => ({ pr_line_id, qty: Number(p.qty.replace(",", ".")), unit_price: Number(p.unit_price || 0), vat_rate: Number(p.vat_rate) })),
        },
      }),
    onSuccess: (po) => {
      setPicked({});
      qc.invalidateQueries({ queryKey: ["factory", "pr-inbox"] });
      qc.invalidateQueries({ queryKey: ["factory", "pos"] });
      qc.invalidateQueries({ queryKey: ["factory", "prs"] });
      onCreated(po.id);
    },
  });
  const toggle = (l: OpenLine) => {
    const next = { ...picked };
    if (next[l.pr_line_id]) delete next[l.pr_line_id];
    else next[l.pr_line_id] = { qty: String(Number(l.qty_open)), unit_price: l.est_price ? String(Number(l.est_price)) : "", vat_rate: "8" };
    setPicked(next);
  };
  const setP = (id: string, p: Partial<Pick>) => setPicked({ ...picked, [id]: { ...picked[id], ...p } });
  const count = Object.keys(picked).length;

  return (
    <Card title="Đề nghị đã duyệt chờ đặt hàng">
      <ErrorNote error={lines.error} />
      {lines.data?.length === 0 && <Empty>Không có dòng đề nghị nào đang chờ đặt hàng.</Empty>}
      {lines.data && lines.data.length > 0 && (
        <Table head={["", "Đề nghị", "Phòng / kho", "Vật tư", "Còn cần đặt", "Cần trước", "SL đặt", "Đơn giá (VND)", "VAT %"]}>
          {lines.data.map((l) => {
            const p = picked[l.pr_line_id];
            return (
              <tr key={l.pr_line_id}>
                <td className="py-2 pr-2"><input type="checkbox" checked={Boolean(p)} onChange={() => toggle(l)} aria-label={`Chọn ${l.item_code}`} /></td>
                <td className="py-2 pr-3 font-mono">{l.pr_code}</td>
                <td className="py-2 pr-3">{l.org_unit_name} · {l.warehouse_code}</td>
                <td className="py-2 pr-3">{l.item_code} — {l.item_name}</td>
                <td className="py-2 pr-3 whitespace-nowrap">{fmtQty(l.qty_open)} {l.uom}</td>
                <td className="py-2 pr-3 whitespace-nowrap">{fmtDate(l.needed_by)}</td>
                <td className="py-2 pr-3 w-28">{p && <input className={inputClass} inputMode="decimal" value={p.qty} onChange={(e) => setP(l.pr_line_id, { qty: e.target.value })} />}</td>
                <td className="py-2 pr-3 w-36">{p && <input className={inputClass} inputMode="numeric" value={p.unit_price} onChange={(e) => setP(l.pr_line_id, { unit_price: e.target.value.replace(/\D/g, "") })} />}</td>
                <td className="py-2 pr-3 w-24">
                  {p && (
                    <select className={inputClass} value={p.vat_rate} onChange={(e) => setP(l.pr_line_id, { vat_rate: e.target.value })}>
                      {["0", "5", "8", "10"].map((v) => <option key={v} value={v}>{v}</option>)}
                    </select>
                  )}
                </td>
              </tr>
            );
          })}
        </Table>
      )}
      {count > 0 && (
        <form className="grid gap-3 sm:grid-cols-4 items-end mt-4 p-3 rounded-xl bg-slate-50 dark:bg-slate-950/50 border border-slate-200 dark:border-slate-800" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
          <Field label="Nhà cung cấp *">
            <select className={inputClass} value={head.supplier_id} onChange={(e) => setHead({ ...head, supplier_id: e.target.value })} required>
              <option value="">Chọn nhà cung cấp</option>
              {suppliers.data?.map((s) => <option key={s.id} value={s.id}>{s.code} — {s.name}</option>)}
            </select>
          </Field>
          <Field label="Ngày giao dự kiến"><input className={inputClass} type="date" value={head.expected_date} onChange={(e) => setHead({ ...head, expected_date: e.target.value })} /></Field>
          <Field label="Điều khoản thanh toán"><input className={inputClass} value={head.payment_terms} onChange={(e) => setHead({ ...head, payment_terms: e.target.value })} /></Field>
          <Button type="submit" disabled={create.isPending}>{create.isPending ? "Đang tạo…" : `Tạo đơn mua (${count} dòng)`}</Button>
          <div className="sm:col-span-4"><ErrorNote error={create.error ?? suppliers.error} /></div>
        </form>
      )}
    </Card>
  );
}

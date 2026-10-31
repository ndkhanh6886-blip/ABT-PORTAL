"use client";

import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, fmtQty } from "../api";
import { Button, Card, Empty, ErrorNote, Field, inputClass, Table } from "../ui";

interface SupplierScorecard {
  id: string;
  code: string;
  name: string;
  tax_code: string | null;
  is_supplier: boolean;
  is_subcontractor: boolean;
  address: string | null;
  payment_terms: string | null;
  asl_status: "APPROVED" | "CONDITIONAL" | "DISQUALIFIED";
  lead_time_days: number;
  category_domain: "BIOCHEM" | "PACKAGING" | "ELECTRONICS" | "SUBCONTRACT";
  po_count: number;
  total_spend: number;
  total_lots: number;
  released_lots: number;
  rejected_lots: number;
  iqc_pass_pct: number;
  otd_pct: number;
}

const ASL_BADGE: Record<string, { label: string; cls: string }> = {
  APPROVED: {
    label: "✅ ASL Approved (Được phép mua)",
    cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300",
  },
  CONDITIONAL: {
    label: "⚠️ Conditional (Giám sát chặt)",
    cls: "bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300",
  },
  DISQUALIFIED: {
    label: "🚫 Disqualified (Đình chỉ mua)",
    cls: "bg-rose-100 text-rose-800 dark:bg-rose-950/70 dark:text-rose-300",
  },
};

const DOMAIN_LABEL: Record<string, string> = {
  BIOCHEM: "🧪 Hóa sinh / Enzyme / Oligo",
  PACKAGING: "📦 Bao bì / Nhựa y tế",
  ELECTRONICS: "⚡ Linh kiện Điện tử / Cơ khí",
  SUBCONTRACT: "🔧 Gia công ngoài (CNC / PCB)",
};

export function SuppliersView({ canManage }: { canManage: boolean }) {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [form, setForm] = useState({
    code: "",
    name: "",
    tax_code: "",
    address: "",
    payment_terms: "Chuyển khoản 30 ngày",
    is_supplier: true,
    is_subcontractor: false,
  });

  const ops = useQuery({
    queryKey: ["factory", "supply-chain-ops"],
    queryFn: () => api<{ supplier_scorecard: SupplierScorecard[] }>("/api/factory/purchase/ops"),
  });

  const create = useMutation({
    mutationFn: () =>
      api("/api/factory/master/partners", {
        method: "POST",
        idempotent: true,
        json: { ...form, code: form.code || undefined, tax_code: form.tax_code || null },
      }),
    onSuccess: () => {
      setForm({
        code: "",
        name: "",
        tax_code: "",
        address: "",
        payment_terms: "Chuyển khoản 30 ngày",
        is_supplier: true,
        is_subcontractor: false,
      });
      qc.invalidateQueries({ queryKey: ["factory", "partners"] });
      qc.invalidateQueries({ queryKey: ["factory", "supply-chain-ops"] });
    },
  });

  const updateAsl = useMutation({
    mutationFn: (payload: {
      partner_id: string;
      asl_status: "APPROVED" | "CONDITIONAL" | "DISQUALIFIED";
      lead_time_days: number;
      category_domain: "BIOCHEM" | "PACKAGING" | "ELECTRONICS" | "SUBCONTRACT";
    }) =>
      api("/api/factory/purchase/ops", {
        method: "POST",
        idempotent: true,
        json: { op: "update_supplier_asl", ...payload },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["factory", "supply-chain-ops"] });
    },
  });

  const rows = (ops.data?.supplier_scorecard ?? []).filter(
    (s) =>
      !q.trim() ||
      s.code.toLowerCase().includes(q.toLowerCase()) ||
      s.name.toLowerCase().includes(q.toLowerCase()) ||
      (s.tax_code ?? "").includes(q)
  );

  return (
    <Card
      title="Danh mục Nhà Cung Cấp Được Phê Duyệt (`ASL — ISO 13485 §7.4`) & Bảng Điểm Đánh Giá Hiệu Suất"
      actions={
        <input
          className={`${inputClass} w-64`}
          placeholder="Tìm mã, tên NCC, mã số thuế…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      }
    >
      {canManage && (
        <form
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 items-end mb-4 p-3 rounded-xl bg-slate-50 dark:bg-slate-950/50 border border-slate-200 dark:border-slate-800"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <Field label="Mã đối tác" hint="Để trống: tự cấp (DT0001…)">
            <input className={inputClass} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
          </Field>
          <Field label="Tên Nhà cung cấp / Đơn vị gia công *">
            <input
              className={inputClass}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
            />
          </Field>
          <Field label="Mã số thuế">
            <input
              className={inputClass}
              value={form.tax_code}
              onChange={(e) => setForm({ ...form, tax_code: e.target.value })}
            />
          </Field>
          <Field label="Điều khoản thanh toán">
            <input
              className={inputClass}
              value={form.payment_terms}
              onChange={(e) => setForm({ ...form, payment_terms: e.target.value })}
            />
          </Field>
          <Field label="Địa chỉ">
            <input
              className={inputClass}
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
            />
          </Field>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={form.is_supplier}
              onChange={(e) => setForm({ ...form, is_supplier: e.target.checked })}
            />
            Nhà cung cấp NVL
          </label>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={form.is_subcontractor}
              onChange={(e) => setForm({ ...form, is_subcontractor: e.target.checked })}
            />
            Đơn vị Gia công ngoài
          </label>
          <Button type="submit" disabled={create.isPending}>
            + Thêm vào Danh mục ASL
          </Button>
          <div className="sm:col-span-2 lg:col-span-4">
            <ErrorNote error={create.error} />
          </div>
        </form>
      )}
      <ErrorNote error={ops.error ?? updateAsl.error} />
      {rows.length === 0 && <Empty>Chưa có đối tác phù hợp.</Empty>}
      {rows.length > 0 && (
        <Table
          head={[
            "Mã & Tên Nhà Cung Cấp",
            "Vai trò / Nhóm ngành",
            "Lead Time",
            "Số PO / Doanh số",
            "Giao đúng hạn (OTD %)",
            "Đạt QC đầu vào (IQC %)",
            "Phân hạng ASL (ISO 13485)",
          ]}
        >
          {rows.map((p) => {
            const badge = ASL_BADGE[p.asl_status] ?? ASL_BADGE.APPROVED;
            return (
              <tr key={p.id}>
                <td className="py-2 pr-3">
                  <div className="font-mono font-bold text-sky-700 dark:text-sky-400">
                    {p.code} — <span className="font-sans text-slate-900 dark:text-white">{p.name}</span>
                  </div>
                  <div className="text-[11px] text-slate-500">
                    MST: {p.tax_code ?? "—"} · {p.payment_terms ?? "TT 30 ngày"} · {p.address ?? "Việt Nam"}
                  </div>
                </td>
                <td className="py-2 pr-3 text-xs">
                  <div className="font-semibold">
                    {[p.is_supplier && "NCC Vật tư", p.is_subcontractor && "Gia công ngoài"].filter(Boolean).join(" + ")}
                  </div>
                  <div className="text-[11px] text-slate-500">{DOMAIN_LABEL[p.category_domain] ?? p.category_domain}</div>
                </td>
                <td className="py-2 pr-3 whitespace-nowrap font-mono text-xs">{p.lead_time_days} ngày</td>
                <td className="py-2 pr-3 whitespace-nowrap text-xs">
                  <div>
                    <b>{p.po_count}</b> đơn PO
                  </div>
                  <div className="text-slate-500">{fmtQty(p.total_spend)} đ</div>
                </td>
                <td className="py-2 pr-3 whitespace-nowrap">
                  <span className="font-bold text-emerald-700 dark:text-emerald-400">{p.otd_pct}%</span>
                </td>
                <td className="py-2 pr-3 whitespace-nowrap">
                  <div className="font-bold text-sky-700 dark:text-sky-400">{p.iqc_pass_pct}%</div>
                  <div className="text-[10px] text-slate-500">
                    {p.released_lots}/{p.total_lots} lô đạt
                  </div>
                </td>
                <td className="py-2 pr-3">
                  {canManage ? (
                    <select
                      className={`${inputClass} text-xs font-bold`}
                      value={p.asl_status}
                      onChange={(e) =>
                        updateAsl.mutate({
                          partner_id: p.id,
                          asl_status: e.target.value as any,
                          lead_time_days: p.lead_time_days,
                          category_domain: p.category_domain,
                        })
                      }
                    >
                      <option value="APPROVED">✅ APPROVED (Cho phép mua)</option>
                      <option value="CONDITIONAL">⚠️ CONDITIONAL (Giám sát)</option>
                      <option value="DISQUALIFIED">🚫 DISQUALIFIED (Cấm mua)</option>
                    </select>
                  ) : (
                    <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${badge.cls}`}>{badge.label}</span>
                  )}
                </td>
              </tr>
            );
          })}
        </Table>
      )}
    </Card>
  );
}

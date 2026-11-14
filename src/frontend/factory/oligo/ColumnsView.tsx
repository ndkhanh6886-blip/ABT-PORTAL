"use client";

import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { Button, Card, Empty, ErrorNote, Field, inputClass, Table } from "../ui";

interface Col {
  id: string;
  code: string;
  name: string;
  status: string;
  retired_reason: string | null;
  lot_code?: string | null;
  catalog_code?: string | null;
  brand?: string | null;
  price_vnd: number;
  design_runs: number;
  asset_code: string | null;
  asset_name: string | null;
  cost_per_run: number;
  runs_used: number;
  remaining_runs?: number;
  depreciated_vnd: number;
  last_run_at: string | null;
}

const vnd = (v: number) => `${Math.round(v || 0).toLocaleString("vi-VN", { maximumFractionDigits: 0 })} VND`;

function Runs({ id }: { id: string }) {
  const runs = useQuery({
    queryKey: ["factory", "lc-column-runs", id],
    queryFn: () =>
      api<{ sequence_code: string; step_name: string; cost_vnd: number; run_at: string; run_by_name: string | null }[]>(
        `/api/factory/assets/columns/${id}/runs`
      ),
  });
  if (!runs.data?.length) return <p className="text-xs text-slate-400 py-2">Chưa có lượt chạy nào được ghi nhận trên cột này.</p>;
  return (
    <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800">
      <div className="text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">
        Nhật ký chi tiết sử dụng cột ({runs.data.length} lượt chạy)
      </div>
      <Table head={["Thời gian", "Mã trình tự", "Bước quy trình SOP", "Đơn giá khấu hao", "Người thực hiện"]}>
        {runs.data.map((r, i) => (
          <tr key={i}>
            <td className="py-1 pr-3 text-xs whitespace-nowrap">{new Date(r.run_at).toLocaleString("vi-VN")}</td>
            <td className="py-1 pr-3 font-mono text-xs font-semibold text-sky-700 dark:text-sky-400">{r.sequence_code}</td>
            <td className="py-1 pr-3 text-xs">{r.step_name}</td>
            <td className="py-1 pr-3 text-right text-xs font-mono">{vnd(r.cost_vnd)}</td>
            <td className="py-1 pr-3 text-xs">{r.run_by_name ?? "Hệ thống"}</td>
          </tr>
        ))}
      </Table>
    </div>
  );
}

/** "Khấu hao & Sử dụng Cột sắc ký HPLC" (Tương thích 100% với OligoFlow cũ trên abt-portal.online) */
export function ColumnsView({ canManage }: { canManage: boolean }) {
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: ["factory", "lc-columns"],
    queryFn: () => api<Col[]>("/api/factory/assets/columns"),
  });
  const assets = useQuery({
    queryKey: ["factory", "assets", "P-OLIGO"],
    queryFn: () => api<{ id: string; code: string; name: string; asset_type: string }[]>("/api/factory/assets?dept=P-OLIGO"),
  });
  const [f, setF] = useState({
    code: "",
    lot_code: "",
    catalog_code: "",
    brand: "Waters",
    name: "",
    asset_id: "",
    price_vnd: "0",
    design_runs: "1000",
    remaining_runs_override: "1000",
  });
  const [open, setOpen] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ["factory", "lc-columns"] });

  const add = useMutation({
    mutationFn: () =>
      api("/api/factory/assets/columns", {
        method: "POST",
        json: {
          code: f.code,
          name: f.name,
          lot_code: f.lot_code || null,
          catalog_code: f.catalog_code || null,
          brand: f.brand || "Waters",
          asset_id: f.asset_id || null,
          price_vnd: Number(f.price_vnd || 0),
          design_runs: Number(f.design_runs || 1000),
          remaining_runs_override: f.remaining_runs_override ? Number(f.remaining_runs_override) : null,
        },
      }),
    onSuccess: () => {
      setF({
        code: "",
        lot_code: "",
        catalog_code: "",
        brand: "Waters",
        name: "",
        asset_id: "",
        price_vnd: "0",
        design_runs: "1000",
        remaining_runs_override: "1000",
      });
      setShowAdd(false);
      refresh();
    },
  });

  const retire = useMutation({
    mutationFn: (id: string) => {
      const reason = window.prompt("Lý do thanh lý / ngừng sử dụng cột:");
      if (!reason) throw new Error("Cần nhập lý do.");
      return api(`/api/factory/assets/columns/${id}/retire`, { method: "POST", json: { reason } });
    },
    onSuccess: refresh,
  });

  return (
    <Card
      title="📊 Khấu hao & Sử dụng Cột sắc ký HPLC"
      actions={
        canManage ? (
          <Button onClick={() => setShowAdd((v) => !v)}>
            {showAdd ? "Đóng form" : "+ Khai báo cột HPLC mới"}
          </Button>
        ) : null
      }
    >
      {canManage && showAdd && (
        <form
          className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5 items-end mb-4 p-3 rounded-xl bg-slate-50 dark:bg-slate-950/50 border border-slate-200 dark:border-slate-800"
          onSubmit={(e) => {
            e.preventDefault();
            add.mutate();
          }}
        >
          <Field label="Mã cột / Serial *">
            <input
              className={inputClass}
              placeholder="VD: BTL-00845"
              value={f.code}
              onChange={(e) => setF({ ...f, code: e.target.value })}
              required
            />
          </Field>
          <Field label="Số Lot">
            <input
              className={inputClass}
              placeholder="VD: 260401.5"
              value={f.lot_code}
              onChange={(e) => setF({ ...f, lot_code: e.target.value })}
            />
          </Field>
          <Field label="Mã Catalog">
            <input
              className={inputClass}
              placeholder="VD: 186003953"
              value={f.catalog_code}
              onChange={(e) => setF({ ...f, catalog_code: e.target.value })}
            />
          </Field>
          <Field label="Hãng sản xuất">
            <input
              className={inputClass}
              placeholder="VD: Waters"
              value={f.brand}
              onChange={(e) => setF({ ...f, brand: e.target.value })}
            />
          </Field>
          <Field label="Lắp trên hệ thống HPLC">
            <select className={inputClass} value={f.asset_id} onChange={(e) => setF({ ...f, asset_id: e.target.value })}>
              <option value="">— Chọn máy HPLC —</option>
              {assets.data
                ?.filter((a) => a.asset_type !== "SYNTHESIZER")
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} · {a.name}
                  </option>
                ))}
            </select>
          </Field>
          <div className="sm:col-span-2">
            <Field label="Tên cột HPLC *">
              <input
                className={inputClass}
                placeholder="VD: XBridge Oligonucleotide BEH C18 Column, 130Å, 2.5 µm, 4.6 mm X 50 mm (186003953)"
                value={f.name}
                onChange={(e) => setF({ ...f, name: e.target.value })}
                required
              />
            </Field>
          </div>
          <Field label="Giá mua (VND) *">
            <input
              className={inputClass}
              inputMode="numeric"
              value={f.price_vnd}
              onChange={(e) => setF({ ...f, price_vnd: e.target.value.replace(/\D/g, "") })}
              required
            />
          </Field>
          <Field label="Lượt thiết kế *">
            <input
              className={inputClass}
              type="number"
              min="1"
              value={f.design_runs}
              onChange={(e) => setF({ ...f, design_runs: e.target.value, remaining_runs_override: e.target.value })}
              required
            />
          </Field>
          <Button type="submit" disabled={add.isPending}>
            + Lưu cột HPLC
          </Button>
          <div className="sm:col-span-3 lg:col-span-5">
            <ErrorNote error={add.error} />
          </div>
        </form>
      )}
      <ErrorNote error={list.error ?? retire.error} />
      {list.data?.length === 0 && <Empty>Chưa có cột sắc ký HPLC nào.</Empty>}
      {list.data && list.data.length > 0 && (
        <Table
          head={[
            "MÃ CỘT / SERIAL",
            "TÊN CỘT HPLC",
            "GIÁ MUA",
            "LƯỢT CHẠY (ĐÃ DÙNG / THIẾT KẾ)",
            "ĐƠN GIÁ KHẤU HAO / TRÌNH TỰ",
            "TỔNG KHẤU HAO LŨY KẾ",
            "THAO TÁC",
          ]}
        >
          {list.data.map((c) => {
            const rem = c.remaining_runs ?? Math.max(0, c.design_runs - c.runs_used);
            return (
              <React.Fragment key={c.id}>
                <tr className={c.status === "ACTIVE" ? "" : "opacity-50"}>
                  <td className="py-2.5 pr-3 text-xs whitespace-nowrap">
                    <div className="font-mono font-bold text-amber-600 dark:text-amber-400">{c.code}</div>
                    {c.lot_code && <div className="text-[11px] text-slate-400">Lot: {c.lot_code}</div>}
                  </td>
                  <td className="py-2.5 pr-3 text-xs">
                    <div className="font-bold text-slate-900 dark:text-white">{c.name}</div>
                    <div className="text-[11px] text-slate-400 mt-0.5">
                      {c.catalog_code ? `Mã: ${c.catalog_code}` : `Máy: ${c.asset_code ?? "HPLC"}`}
                      {c.brand ? ` | Hãng: ${c.brand}` : ""}
                    </div>
                    {c.retired_reason && <div className="text-rose-600 text-[11px]">Thanh lý: {c.retired_reason}</div>}
                  </td>
                  <td className="py-2.5 pr-3 text-right text-xs font-semibold whitespace-nowrap">{vnd(c.price_vnd)}</td>
                  <td className="py-2.5 pr-3 text-center text-xs whitespace-nowrap">
                    <div className="inline-flex items-center px-2.5 py-0.5 rounded-lg bg-sky-950/60 border border-sky-700/60 text-sky-400 font-bold text-xs">
                      {c.runs_used} / {c.design_runs} Lượt
                    </div>
                    <div className="text-[11px] text-slate-400 mt-0.5">Còn lại: {rem} lượt</div>
                  </td>
                  <td className="py-2.5 pr-3 text-right text-xs font-bold text-cyan-600 dark:text-cyan-400 whitespace-nowrap">
                    {vnd(c.cost_per_run)}
                  </td>
                  <td className="py-2.5 pr-3 text-right text-xs font-bold text-emerald-600 dark:text-emerald-400 whitespace-nowrap">
                    {vnd(c.depreciated_vnd)}
                  </td>
                  <td className="py-2.5 pr-3 text-right whitespace-nowrap">
                    <div className="inline-flex items-center gap-1.5">
                      <Button variant="ghost" onClick={() => setOpen(open === c.id ? null : c.id)}>
                        {open === c.id ? "Đóng chi tiết" : "☰ Chi tiết sử dụng"}
                      </Button>
                      {canManage && c.status === "ACTIVE" && (
                        <Button variant="ghost" onClick={() => retire.mutate(c.id)}>
                          Thanh lý
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
                {open === c.id && (
                  <tr>
                    <td colSpan={7} className="pb-3">
                      <Runs id={c.id} />
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
        </Table>
      )}
    </Card>
  );
}

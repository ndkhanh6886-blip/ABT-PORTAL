"use client";

import React, { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { Button, Card, ErrorNote, Field, inputClass, Table } from "../ui";
import { FORMAT, PURIFICATION, useScales } from "./shared";

interface PriceLine {
  key: string;
  code: string;
  name: string;
  unit: string;
  qty: number;
  unit_price: number;
  amount: number;
}

interface QuoteResult {
  lines: PriceLine[];
  unit_price: number;
  total_price: number;
  skips_std_base: boolean;
}

interface PricingConfigResponse {
  config: Record<string, any>;
  version: number;
  updated_at: string | null;
  catalog: { key: string; code: string; name: string; unit: string }[];
}

const SCALE_COLS = ["50nmol", "100nmol", "200nmol", "250nmol", "500nmol", "1000nmol"];
const DUAL_SCALE_COLS = ["50nmol", "100nmol", "200nmol", "500nmol", "1000nmol"];

export function PricingConfigView({ canManage }: { canManage: boolean }) {
  const qc = useQueryClient();
  const scales = useScales();
  const cfgQuery = useQuery({
    queryKey: ["factory", "oligo-pricing-config"],
    queryFn: () => api<PricingConfigResponse>("/api/factory/oligo/pricing"),
  });

  const [draft, setDraft] = useState<Record<string, any> | null>(null);
  const [matrixTab, setMatrixTab] = useState<"BASE" | "PROBE" | "MOD" | "PUR_AMP" | "CATALOG">("BASE");

  useEffect(() => {
    if (cfgQuery.data?.config && !draft) {
      setDraft(JSON.parse(JSON.stringify(cfgQuery.data.config)));
    }
  }, [cfgQuery.data, draft]);

  const saveCfg = useMutation({
    mutationFn: (nextConfig: Record<string, any>) =>
      api<PricingConfigResponse>("/api/factory/oligo/pricing", {
        method: "PUT",
        json: { config: nextConfig, reason: "Cập nhật bảng giá Oligo" },
      }),
    onSuccess: (saved) => {
      setDraft(JSON.parse(JSON.stringify(saved.config)));
      qc.invalidateQueries({ queryKey: ["factory", "oligo-pricing-config"] });
    },
  });

  // Instant Quote Calculator State
  const [calc, setCalc] = useState({
    sequence: "/FAM/CCTCTKCATCCTGCTGCTATGCCTCATC/BHQ1/",
    scale: "100NMOL",
    purification: "HPLC",
    format: "LYOPHILIZED",
    classification: "DNA",
    pricing_type: "auto",
    price_percentage: "85",
    custom_unit_price: "0",
  });

  const quoteMut = useMutation({
    mutationFn: () =>
      api<QuoteResult>("/api/factory/oligo/pricing", {
        method: "POST",
        json: {
          sequence: calc.sequence,
          scale: calc.scale,
          purification: calc.purification,
          format: calc.format,
          classification: calc.classification,
          pricing_type: calc.pricing_type,
          price_percentage: Number(calc.price_percentage) || 100,
          custom_unit_price: Number(calc.custom_unit_price) || 0,
        },
      }),
  });

  useEffect(() => {
    if (calc.sequence.trim()) {
      quoteMut.mutate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateNestedPrice = (path: string[], val: string) => {
    if (!draft) return;
    const next = JSON.parse(JSON.stringify(draft));
    let cur = next;
    for (let i = 0; i < path.length - 1; i++) {
      if (!cur[path[i]] || typeof cur[path[i]] !== "object") cur[path[i]] = {};
      cur = cur[path[i]];
    }
    cur[path[path.length - 1]] = Number(val.replace(/[^0-9.-]/g, "")) || 0;
    setDraft(next);
  };

  return (
    <div className="flex flex-col gap-3">
      <ErrorNote error={cfgQuery.error ?? saveCfg.error} />
      {/* Công cụ Báo giá & Tính tiền Tổng hợp Oligo Tức thì */}
      <Card title="🧮 Công Cụ Tính Tiền Tổng Hợp Oligo & Báo Giá Tức Thì">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6 items-end">
          <div className="sm:col-span-2 lg:col-span-2">
            <Field label="Trình tự 5' → 3' (Hỗ trợ cả /FAM/.../BHQ1/ hoặc [FAM]...[BHQ1], LNA +A, 2'-OMe MA)">
              <input
                className={`${inputClass} font-mono`}
                value={calc.sequence}
                onChange={(e) => setCalc({ ...calc, sequence: e.target.value })}
                placeholder="/FAM/CCTCTKCATCCTGCTGCTATGCCTCATC/BHQ1/"
              />
            </Field>
          </div>
          <Field label="Thang / Nồng độ">
            <select
              className={inputClass}
              value={calc.scale}
              onChange={(e) => setCalc({ ...calc, scale: e.target.value })}
            >
              {scales.data?.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.label} ({s.code})
                </option>
              ))}
            </select>
          </Field>
          <Field label="Tinh sạch">
            <select
              className={inputClass}
              value={calc.purification}
              onChange={(e) => setCalc({ ...calc, purification: e.target.value })}
            >
              {Object.entries(PURIFICATION).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Dạng giao">
            <select
              className={inputClass}
              value={calc.format}
              onChange={(e) => setCalc({ ...calc, format: e.target.value })}
            >
              {Object.entries(FORMAT).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Phân loại sản phẩm">
            <select
              className={inputClass}
              value={calc.classification}
              onChange={(e) => setCalc({ ...calc, classification: e.target.value })}
            >
              <option value="DNA">Primer / Probe (DNA/RNA)</option>
              <option value="Amplicon (Linear)">Amplicon Linear (&gt;60bp)</option>
              <option value="Amplicon (Plasmid)">Amplicon Plasmid</option>
            </select>
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5 items-end mt-3">
          <Field label="Chế độ tính giá đơn hàng">
            <select
              className={inputClass}
              value={calc.pricing_type}
              onChange={(e) => setCalc({ ...calc, pricing_type: e.target.value })}
            >
              <option value="auto">Giá End (100% bảng giá chuẩn)</option>
              <option value="percentage">Giá Dealer / Chiết khấu theo %</option>
              <option value="custom">Đơn giá tự do / base</option>
              <option value="demo">Đơn hàng Demo (0 VNĐ)</option>
            </select>
          </Field>
          {calc.pricing_type === "percentage" && (
            <Field label="Tỷ lệ % so với Giá End">
              <input
                type="number"
                className={inputClass}
                value={calc.price_percentage}
                onChange={(e) => setCalc({ ...calc, price_percentage: e.target.value })}
              />
            </Field>
          )}
          {calc.pricing_type === "custom" && (
            <Field label="Đơn giá tự nhập (VNĐ / base)">
              <input
                type="number"
                className={inputClass}
                value={calc.custom_unit_price}
                onChange={(e) => setCalc({ ...calc, custom_unit_price: e.target.value })}
              />
            </Field>
          )}
          <div>
            <Button onClick={() => quoteMut.mutate()} disabled={quoteMut.isPending || !calc.sequence.trim()}>
              {quoteMut.isPending ? "Đang tính…" : "🧮 Tính giá trình tự"}
            </Button>
          </div>
        </div>

        <ErrorNote error={quoteMut.error} />

        {quoteMut.data && (
          <div className="mt-3 p-3 rounded-xl bg-slate-50 dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800 space-y-2.5 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-3">
                <span>
                  Trình tự báo giá: <code className="font-mono font-bold text-sky-700 dark:text-sky-300">{calc.sequence}</code>
                </span>
                {quoteMut.data.skips_std_base && (
                  <span className="px-2 py-0.5 rounded bg-indigo-100 dark:bg-indigo-950/80 text-indigo-800 dark:text-indigo-300 font-bold text-[11px]">
                    ✨ Áp dụng quy tắc Probe huỳnh quang ABT (Gói giá Probe đã bao gồm base chuẩn &amp; tinh sạch HPLC)
                  </span>
                )}
              </div>
              <div className="flex items-center gap-4">
                <div>
                  Đơn giá Base chuẩn: <b className="text-slate-900 dark:text-white">{Number(quoteMut.data.unit_price).toLocaleString("vi-VN")} đ/nt</b>
                </div>
                <div className="px-3 py-1 rounded-xl bg-emerald-600 text-white font-extrabold text-sm">
                  Thành tiền: {Number(quoteMut.data.total_price).toLocaleString("vi-VN")} VNĐ
                </div>
              </div>
            </div>

            <Table head={["Mã hàng hóa đơn", "Hạng mục tính tiền", "Đơn vị", "Số lượng", "Đơn giá (VNĐ)", "Thành tiền (VNĐ)"]}>
              {quoteMut.data.lines.map((l, idx) => (
                <tr key={idx}>
                  <td className="py-1.5 pr-3 font-mono font-bold text-sky-700 dark:text-sky-400">{l.code}</td>
                  <td className="py-1.5 pr-3 font-medium">{l.name}</td>
                  <td className="py-1.5 pr-3 text-slate-500">{l.unit}</td>
                  <td className="py-1.5 pr-3 text-right font-mono">{l.qty}</td>
                  <td className="py-1.5 pr-3 text-right font-mono">{Number(l.unit_price).toLocaleString("vi-VN")} đ</td>
                  <td className="py-1.5 pr-3 text-right font-mono font-bold text-emerald-700 dark:text-emerald-400">
                    {Number(l.amount).toLocaleString("vi-VN")} đ
                  </td>
                </tr>
              ))}
            </Table>
          </div>
        )}
      </Card>

      {/* 3. Bảng giá cấu hình chi tiết */}
      {draft && (
        <Card
          title="💰 Cấu Hình Bảng Giá Tổng Hợp Oligo, Probe, Biến Đổi, Tinh Sạch & Amplicon"
          actions={
            canManage ? (
              <Button onClick={() => saveCfg.mutate(draft)} disabled={saveCfg.isPending}>
                {saveCfg.isPending ? "Đang lưu…" : "💾 Lưu cấu hình bảng giá"}
              </Button>
            ) : undefined
          }
        >
          <div className="flex flex-wrap items-center gap-1.5 mb-3 border-b border-slate-200 dark:border-slate-800 pb-2">
            {[
              ["BASE", "1. Giá Base chuẩn & LNA / 2'-OMe"],
              ["PROBE", "2. Đầu dò đánh dấu kép (Dual-labeled Probes)"],
              ["MOD", "3. Biến đổi đầu 5', đầu 3' & Nội mạch"],
              ["PUR_AMP", "4. Tinh sạch, Đông khô & Amplicon"],
              ["CATALOG", "5. Danh mục Mã hàng Hóa đơn (OLG-...)"],
            ].map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setMatrixTab(k as any)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                  matrixTab === k
                    ? "bg-sky-700 text-white"
                    : "bg-slate-100 dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {matrixTab === "BASE" && (
            <div className="space-y-4">
              <div>
                <div className="text-xs font-bold text-slate-700 dark:text-slate-200 mb-2">
                  A. Đơn giá Base chuẩn theo độ dài chuỗi &amp; thang tổng hợp (VNĐ / base)
                </div>
                <Table head={["Độ dài chuỗi", ...SCALE_COLS]}>
                  {[
                    ["6-14", "Từ 6 – 14 base (Ngắn)"],
                    ["15-34", "Từ 15 – 34 base (Tiêu chuẩn)"],
                    ["35-60", "Từ 35 – 60 base (Dài)"],
                    ["61-120", "Từ 61 – 120 base (Siêu dài)"],
                  ].map(([tierKey, tierLabel]) => (
                    <tr key={tierKey}>
                      <td className="py-1.5 pr-3 font-semibold text-xs">{tierLabel}</td>
                      {SCALE_COLS.map((sc) => (
                        <td key={sc} className="py-1.5 pr-2">
                          <input
                            className={`${inputClass} text-right font-mono text-xs`}
                            disabled={!canManage}
                            value={draft.scales?.[sc]?.base_standard?.[tierKey] ?? 0}
                            onChange={(e) => updateNestedPrice(["scales", sc, "base_standard", tierKey], e.target.value)}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </Table>
              </div>

              <div>
                <div className="text-xs font-bold text-slate-700 dark:text-slate-200 mb-2">
                  B. Phụ phí Base biến đổi LNA (+A/+C/+G/+T) &amp; 2&apos;-O-Methyl (MA/MC/MG/MT) (VNĐ / điểm biến đổi)
                </div>
                <Table head={["Loại Base biến đổi", ...SCALE_COLS]}>
                  {["+A", "+C", "+G", "+T", "MA", "MC", "MG", "MT"].map((modKey) => (
                    <tr key={modKey}>
                      <td className="py-1.5 pr-3 font-mono font-bold text-xs text-sky-700 dark:text-sky-400">{modKey}</td>
                      {SCALE_COLS.map((sc) => (
                        <td key={sc} className="py-1.5 pr-2">
                          <input
                            className={`${inputClass} text-right font-mono text-xs`}
                            disabled={!canManage}
                            value={draft.scales?.[sc]?.base_modified?.[modKey] ?? 0}
                            onChange={(e) => updateNestedPrice(["scales", sc, "base_modified", modKey], e.target.value)}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </Table>
              </div>
            </div>
          )}

          {matrixTab === "PROBE" && (
            <div>
              <div className="text-xs font-bold text-slate-700 dark:text-slate-200 mb-2">
                Bảng giá Đầu dò đánh dấu kép (Dual-labeled Probes 5&apos; Reporter + 3&apos; Quencher — Đã bao gồm Base &amp; Tinh sạch HPLC)
              </div>
              <Table head={["Tổ hợp 5' / 3' Probe", ...DUAL_SCALE_COLS]}>
                {Object.keys(draft.dual_modification_pricing ?? {}).map((probeKey) => (
                  <tr key={probeKey}>
                    <td className="py-1.5 pr-3 font-mono font-bold text-xs text-indigo-700 dark:text-indigo-300">{probeKey}</td>
                    {DUAL_SCALE_COLS.map((sc) => (
                      <td key={sc} className="py-1.5 pr-2">
                        <input
                          className={`${inputClass} text-right font-mono text-xs`}
                          disabled={!canManage}
                          value={draft.dual_modification_pricing?.[probeKey]?.[sc] ?? 0}
                          onChange={(e) => updateNestedPrice(["dual_modification_pricing", probeKey, sc], e.target.value)}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </Table>
            </div>
          )}

          {matrixTab === "MOD" && (
            <div className="space-y-4">
              {[
                ["modifications_5prime", "A. Biến đổi đầu 5' (5' Modifications)"],
                ["modifications_3prime", "B. Biến đổi đầu 3' (3' Modifications)"],
                ["modifications_internal", "C. Biến đổi nội mạch (Internal Modifications)"],
              ].map(([sectionKey, sectionTitle]) => (
                <div key={sectionKey}>
                  <div className="text-xs font-bold text-slate-700 dark:text-slate-200 mb-2">{sectionTitle}</div>
                  <Table head={["Mã Modification", ...SCALE_COLS]}>
                    {Object.keys(draft[sectionKey] ?? {}).map((modKey) => {
                      const entry = draft[sectionKey]?.[modKey];
                      const isPerScale = entry && typeof entry === "object";
                      return (
                        <tr key={modKey}>
                          <td className="py-1.5 pr-3 font-mono font-bold text-xs">{modKey}</td>
                          {SCALE_COLS.map((sc) => (
                            <td key={sc} className="py-1.5 pr-2">
                              <input
                                className={`${inputClass} text-right font-mono text-xs`}
                                disabled={!canManage}
                                value={isPerScale ? (entry[sc] ?? 0) : Number(entry ?? 0)}
                                onChange={(e) =>
                                  isPerScale
                                    ? updateNestedPrice([sectionKey, modKey, sc], e.target.value)
                                    : updateNestedPrice([sectionKey, modKey], e.target.value)
                                }
                              />
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                  </Table>
                </div>
              ))}
            </div>
          )}

          {matrixTab === "PUR_AMP" && (
            <div className="space-y-4">
              <div>
                <div className="text-xs font-bold text-slate-700 dark:text-slate-200 mb-2">
                  A. Phí Tinh sạch (Desalt / OPC / PAGE / HPLC) theo thang tổng hợp (VNĐ)
                </div>
                <Table head={["Phương pháp Tinh sạch", ...SCALE_COLS]}>
                  {Object.keys(draft.purification_pricing ?? {}).map((purKey) => (
                    <tr key={purKey}>
                      <td className="py-1.5 pr-3 font-bold text-xs">{purKey}</td>
                      {SCALE_COLS.map((sc) => (
                        <td key={sc} className="py-1.5 pr-2">
                          <input
                            className={`${inputClass} text-right font-mono text-xs`}
                            disabled={!canManage}
                            value={draft.purification_pricing?.[purKey]?.[sc] ?? 0}
                            onChange={(e) => updateNestedPrice(["purification_pricing", purKey, sc], e.target.value)}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </Table>
              </div>

              <div>
                <div className="text-xs font-bold text-slate-700 dark:text-slate-200 mb-2">
                  B. Phụ phí Sấy Đông Khô (Lyophilization) &amp; Bảng giá Amplicon (Linear / Plasmid)
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <Field label="Phụ phí Sấy Đông Khô (VNĐ/ống)">
                    <input
                      className={`${inputClass} font-mono`}
                      disabled={!canManage}
                      value={
                        typeof draft.lyophilization_pricing === "number"
                          ? draft.lyophilization_pricing
                          : draft.lyophilization_pricing?.["100nmol"] ?? 0
                      }
                      onChange={(e) => updateNestedPrice(["lyophilization_pricing"], e.target.value)}
                    />
                  </Field>
                  <Field label="Amplicon (Linear) (VNĐ/bp)">
                    <input
                      className={`${inputClass} font-mono`}
                      disabled={!canManage}
                      value={draft.amplicon_pricing?.["Amplicon (Linear)"] ?? 8000}
                      onChange={(e) => updateNestedPrice(["amplicon_pricing", "Amplicon (Linear)"], e.target.value)}
                    />
                  </Field>
                  <Field label="Amplicon (Plasmid) (VNĐ/bp)">
                    <input
                      className={`${inputClass} font-mono`}
                      disabled={!canManage}
                      value={draft.amplicon_pricing?.["Amplicon (Plasmid)"] ?? 9000}
                      onChange={(e) => updateNestedPrice(["amplicon_pricing", "Amplicon (Plasmid)"], e.target.value)}
                    />
                  </Field>
                  <Field label="Độ dài Amplicon tối đa (bp)">
                    <input
                      className={`${inputClass} font-mono`}
                      disabled={!canManage}
                      value={draft.amplicon_pricing?.max_length ?? 120}
                      onChange={(e) => updateNestedPrice(["amplicon_pricing", "max_length"], e.target.value)}
                    />
                  </Field>
                </div>
              </div>
            </div>
          )}

          {matrixTab === "CATALOG" && (
            <Table head={["Mã hàng hóa đơn", "Tên hạng mục trên báo giá / hóa đơn VAT", "Đơn vị tính", "Khóa cấu hình"]}>
              {(cfgQuery.data?.catalog ?? []).map((it, idx) => (
                <tr key={it.key || idx}>
                  <td className="py-1.5 pr-3 font-mono font-bold text-xs text-sky-700 dark:text-sky-400">{it.code}</td>
                  <td className="py-1.5 pr-3 text-xs">{it.name}</td>
                  <td className="py-1.5 pr-3 text-xs text-slate-500">{it.unit}</td>
                  <td className="py-1.5 pr-3 font-mono text-[11px] text-slate-400">{it.key}</td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}
    </div>
  );
}

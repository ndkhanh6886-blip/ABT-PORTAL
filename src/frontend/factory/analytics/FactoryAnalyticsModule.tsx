"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { api, escHtml, fmtQty } from "../api";
import { Button, Card, Empty, ErrorNote, Field, inputClass, StatusBadge } from "../ui";

type AnalyticsSubTab = "scorecard_rbe" | "spc_pareto_pdca" | "forecast_whatif" | "genealogy_bio_iso";

export function FactoryAnalyticsModule() {
  const [tab, setTab] = useState<AnalyticsSubTab>("scorecard_rbe");
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyKey, setBusyKey] = useState<string>("");
  const [error, setError] = useState<unknown>(null);
  const [banner, setBanner] = useState<string>("");

  // Tab 1 filters
  const [rbeFilter, setRbeFilter] = useState<"ALL" | "ZERO_EXCEPTION" | "EXCEPTION">("ALL");

  // Tab 2 SPC state
  const [selectedSpcId, setSelectedSpcId] = useState<string>("");
  const [showAddSpcForm, setShowAddSpcForm] = useState(false);
  const [spcForm, setSpcForm] = useState({
    batch_or_lot_code: "",
    measured_value: "",
    analyst_name: "",
    notes: "",
  });

  // Tab 3 What-If Simulator state
  const [simForm, setSimForm] = useState({
    item_id: "",
    order_qty: "150",
    needed_by_date: "",
  });
  const [simResult, setSimResult] = useState<any | null>(null);

  // Tab 4 Genealogy & Freeze-Thaw state
  const [selectedLotId, setSelectedLotId] = useState<string>("");
  const [lotSearch, setLotSearch] = useState<string>("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api<any>("/api/factory/analytics");
      setData(res);
      if (res.spc_series?.length && !selectedSpcId) {
        setSelectedSpcId(res.spc_series[0].id);
      }
      if (res.simulatable_products?.length && !simForm.item_id) {
        setSimForm((f) => ({
          ...f,
          item_id: res.simulatable_products[0].item_id,
          needed_by_date: res.today || "",
        }));
      }
      if (res.bio_lots?.length && !selectedLotId) {
        const withEdges = res.bio_lots.find((l: any) => l.downstream_count > 0 || l.upstream_count > 0);
        setSelectedLotId((withEdges ?? res.bio_lots[0]).id);
      }
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, [selectedSpcId, simForm.item_id, selectedLotId]);

  useEffect(() => {
    load();
  }, [load]);

  const activeSpc = useMemo(() => {
    if (!data?.spc_series?.length) return null;
    return data.spc_series.find((s: any) => s.id === selectedSpcId) ?? data.spc_series[0];
  }, [data, selectedSpcId]);

  const filteredRbeBatches = useMemo(() => {
    const list = data?.review_by_exception_batches ?? [];
    if (rbeFilter === "ZERO_EXCEPTION") return list.filter((b: any) => b.rbe_status === "ZERO_EXCEPTION");
    if (rbeFilter === "EXCEPTION") return list.filter((b: any) => b.rbe_status !== "ZERO_EXCEPTION");
    return list;
  }, [data, rbeFilter]);

  const filteredBioLots = useMemo(() => {
    const list = data?.bio_lots ?? [];
    const q = lotSearch.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (l: any) =>
        String(l.lot_code ?? "").toLowerCase().includes(q) ||
        String(l.item_code ?? "").toLowerCase().includes(q) ||
        String(l.item_name ?? "").toLowerCase().includes(q)
    );
  }, [data, lotSearch]);

  const selectedLotObj = useMemo(() => {
    return (data?.bio_lots ?? []).find((l: any) => l.id === selectedLotId) ?? null;
  }, [data, selectedLotId]);

  const selectedLotGenealogy = useMemo(() => {
    const edges = data?.genealogy_edges ?? [];
    if (!selectedLotId) return { upstream: [], downstream: [] };
    return {
      upstream: edges.filter((e: any) => e.child_lot_id === selectedLotId),
      downstream: edges.filter((e: any) => e.parent_lot_id === selectedLotId),
    };
  }, [data, selectedLotId]);

  async function runAction(key: string, body: Record<string, any>, successMsg: string) {
    setBusyKey(key);
    setError(null);
    setBanner("");
    try {
      const res = await api<any>("/api/factory/analytics", {
        method: "POST",
        body: JSON.stringify(body),
      });
      setBanner(successMsg);
      await load();
      return res;
    } catch (e) {
      setError(e);
      return null;
    } finally {
      setBusyKey("");
    }
  }

  async function handleRunSimulation(e: React.FormEvent) {
    e.preventDefault();
    if (!simForm.item_id) return;
    setBusyKey("simulate");
    setError(null);
    try {
      const res = await api<any>("/api/factory/analytics", {
        method: "POST",
        body: JSON.stringify({
          op: "simulate_what_if",
          item_id: simForm.item_id,
          order_qty: Number(simForm.order_qty || 100),
          needed_by_date: simForm.needed_by_date || undefined,
        }),
      });
      setSimResult(res);
    } catch (err) {
      setError(err);
    } finally {
      setBusyKey("");
    }
  }

  function handlePrintIsoReport() {
    if (!data?.iso13485_management_review) return;
    const rev = data.iso13485_management_review;
    const w = window.open("", "_blank", "width=980,height=760");
    if (!w) return;
    const rowsHtml = (rev.sections ?? [])
      .map(
        (s: any) => `
        <tr>
          <td style="padding:10px;border:1px solid #cbd5e1;font-weight:700;">${escHtml(s.clause)}</td>
          <td style="padding:10px;border:1px solid #cbd5e1;text-align:center;">${s.status === "GOOD" ? "ĐẠT CHUẨN" : "CẦN LƯU Ý"}</td>
          <td style="padding:10px;border:1px solid #cbd5e1;">${escHtml(s.summary)}</td>
          <td style="padding:10px;border:1px solid #cbd5e1;color:#0f172a;font-weight:600;">${escHtml(s.recommended_decision)}</td>
        </tr>`
      )
      .join("");
    const deptHtml = (data.department_scorecards ?? [])
      .map(
        (d: any) => `
        <tr>
          <td style="padding:8px;border:1px solid #cbd5e1;font-weight:700;">${escHtml(d.dept_code)} — ${escHtml(d.dept_name)}</td>
          <td style="padding:8px;border:1px solid #cbd5e1;text-align:center;font-weight:700;">${escHtml(d.health_score)}/100</td>
          <td style="padding:8px;border:1px solid #cbd5e1;">${escHtml(d.primary_kpi_label)}: <b>${escHtml(d.primary_kpi_value)}</b> (Mục tiêu ${escHtml(d.target_label)})</td>
          <td style="padding:8px;border:1px solid #cbd5e1;">${escHtml(d.forecast_note)}</td>
        </tr>`
      )
      .join("");
    w.document.write(`
      <html>
        <head>
          <title>Báo Cáo Xem Xét Của Lãnh Đạo ISO 13485:2016 — ABT Biolab</title>
        </head>
        <body style="font-family:Segoe UI,Arial,sans-serif;padding:28px;color:#0f172a;">
          <h2 style="margin:0 0 4px 0;">CÔNG TY Y SINH ABT — HỆ THỐNG QUẢN LÝ CHẤT LƯỢNG ISO 13485:2016</h2>
          <h3 style="margin:0 0 16px 0;color:#0369a1;">BIÊN BẢN & BÁO CÁO XEM XÉT CỦA LÃNH ĐẠO (MANAGEMENT REVIEW §5.6)</h3>
          <p style="margin:4px 0 16px 0;font-size:13px;">Kỳ báo cáo: <b>${escHtml(rev.review_period)}</b> · Điểm sức khỏe vận hành toàn nhà máy: <b>${escHtml(rev.overall_health_score)}/100</b></p>
          <h4>I. BẢNG ĐIỂM HIỆU SUẤT KPI & SLA 8 PHÒNG BAN</h4>
          <table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:20px;">
            <thead>
              <tr style="background:#f1f5f9;">
                <th style="padding:8px;border:1px solid #cbd5e1;text-align:left;">Phòng ban</th>
                <th style="padding:8px;border:1px solid #cbd5e1;">Điểm Health</th>
                <th style="padding:8px;border:1px solid #cbd5e1;text-align:left;">Chỉ số KPI Cốt lõi</th>
                <th style="padding:8px;border:1px solid #cbd5e1;text-align:left;">Nhận định & Dự báo 30/60/90 ngày</th>
              </tr>
            </thead>
            <tbody>${deptHtml}</tbody>
          </table>
          <h4>II. NỘI DUNG XEM XÉT THEO ĐIỀU KHOẢN ISO 13485:2016 §5.6</h4>
          <table style="width:100%;border-collapse:collapse;font-size:12px;">
            <thead>
              <tr style="background:#f1f5f9;">
                <th style="padding:10px;border:1px solid #cbd5e1;text-align:left;">Điều khoản ISO 13485</th>
                <th style="padding:10px;border:1px solid #cbd5e1;">Đánh giá</th>
                <th style="padding:10px;border:1px solid #cbd5e1;text-align:left;">Số liệu Thống kê & Phân tích Thực tế</th>
                <th style="padding:10px;border:1px solid #cbd5e1;text-align:left;">Quyết định Cải tiến & Phân bổ Nguồn lực</th>
              </tr>
            </thead>
            <tbody>${rowsHtml}</tbody>
          </table>
          <div style="margin-top:32px;display:flex;justify-content:space-between;font-size:13px;">
            <div><b>Đại diện Lãnh đạo Chất lượng (QMR / QA Manager)</b><br/><br/><br/>___________________________</div>
            <div><b>Ban Giám đốc Phê duyệt (Director)</b><br/><br/><br/>___________________________</div>
          </div>
          <script>window.print();</script>
        </body>
      </html>
    `);
    w.document.close();
  }

  const zeroExCount = (data?.review_by_exception_batches ?? []).filter((b: any) => b.rbe_status === "ZERO_EXCEPTION").length;
  const totalBatchesCount = (data?.review_by_exception_batches ?? []).length;
  const criticalStockoutCount = (data?.material_runout_forecast ?? []).filter(
    (m: any) => m.risk_status === "CRITICAL_STOCKOUT" || m.risk_status === "REORDER_NOW"
  ).length;
  const spcAlertCount = (data?.spc_series ?? []).filter((s: any) => s.latest_status !== "IN_CONTROL").length;

  return (
    <div className="space-y-4">
      {/* Compact Header & KPI Ribbon */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-extrabold bg-sky-100 text-sky-800 dark:bg-sky-950/60 dark:text-sky-300">
                ISO 13485 §8.4 & §5.6 · BI · SPC · MRP · 360° GENEALOGY
              </span>
              <h1 className="text-base sm:text-lg font-extrabold text-slate-900 dark:text-white">
                Trung Tâm Phân Tích Dữ Liệu, Cải Tiến Hệ Thống & Dự Báo Đa Phòng Ban
              </h1>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Tổng hợp dữ liệu thời gian thực từ 8 phân hệ · Duyệt lô theo ngoại lệ (RbE) · Kiểm soát thống kê SPC Levey-Jennings · Mô phỏng What-If ATP/CTP & Truy xuất phả hệ 360°
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={handlePrintIsoReport}>
              🖨️ Xuất Báo cáo Xem xét Lãnh đạo ISO 13485
            </Button>
            <Button variant="secondary" onClick={load} disabled={loading}>
              {loading ? "Đang đồng bộ..." : "↻ Làm mới số liệu"}
            </Button>
          </div>
        </div>

        {/* 4 Executive Summary Pills */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 mt-3">
          <div className="rounded-xl border border-emerald-200 dark:border-emerald-900/50 bg-emerald-50/60 dark:bg-emerald-950/20 px-3 py-2">
            <div className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
              Điểm Sức Khỏe Toàn Nhà Máy (8 Phòng Ban)
            </div>
            <div className="text-lg font-extrabold text-emerald-800 dark:text-emerald-200 mt-0.5">
              {data?.overall_health_score ?? 92}/100{" "}
              <span className="text-xs font-semibold text-emerald-600">· Chuẩn SLA</span>
            </div>
          </div>
          <div className="rounded-xl border border-sky-200 dark:border-sky-900/50 bg-sky-50/60 dark:bg-sky-950/20 px-3 py-2">
            <div className="text-[11px] font-semibold text-sky-700 dark:text-sky-300">
              Lô Đạt Chuẩn Zero-Exception (RbE)
            </div>
            <div className="text-lg font-extrabold text-sky-800 dark:text-sky-200 mt-0.5">
              {zeroExCount}/{totalBatchesCount} lô{" "}
              <span className="text-xs font-semibold text-sky-600">· Sẵn sàng duyệt nhanh</span>
            </div>
          </div>
          <div className="rounded-xl border border-amber-200 dark:border-amber-900/50 bg-amber-50/60 dark:bg-amber-950/20 px-3 py-2">
            <div className="text-[11px] font-semibold text-amber-700 dark:text-amber-300">
              Cảnh Báo Sớm SPC (Westgard Rules)
            </div>
            <div className="text-lg font-extrabold text-amber-800 dark:text-amber-200 mt-0.5">
              {spcAlertCount} chuỗi{" "}
              <span className="text-xs font-semibold text-amber-600">· Phát hiện trôi chuẩn sớm</span>
            </div>
          </div>
          <div className="rounded-xl border border-rose-200 dark:border-rose-900/50 bg-rose-50/60 dark:bg-rose-950/20 px-3 py-2">
            <div className="text-[11px] font-semibold text-rose-700 dark:text-rose-300">
              Dự Báo Vật Tư Cần Đặt Mua (Run-out ≤ Lead Time)
            </div>
            <div className="text-lg font-extrabold text-rose-800 dark:text-rose-200 mt-0.5">
              {criticalStockoutCount} mã NVL{" "}
              <span className="text-xs font-semibold text-rose-600">· 1-Click Tạo PR Dự báo</span>
            </div>
          </div>
        </div>

        {/* Navigation Sub-tabs */}
        <div className="mt-3 pt-3 border-t border-slate-200 dark:border-slate-800 flex flex-wrap gap-1.5">
          {[
            {
              id: "scorecard_rbe" as const,
              label: "🏆 1. Bảng Điểm KPI, Duyệt Lô RbE & Giá Thành",
            },
            {
              id: "spc_pareto_pdca" as const,
              label: "📈 2. Kiểm Soát SPC, Pareto 80/20 & Cải Tiến",
            },
            {
              id: "forecast_whatif" as const,
              label: "🔮 3. Dự Báo 30/60/90 Ngày & Mô Phỏng What-If",
            },
            {
              id: "genealogy_bio_iso" as const,
              label: "🧬 4. Phả Hệ Lô 360°, Rã Đông & Báo Cáo ISO",
            },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors cursor-pointer ${
                tab === t.id
                  ? "bg-sky-700 text-white shadow-xs"
                  : "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <ErrorNote error={error} />
      {banner && (
        <div className="rounded-xl border border-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 dark:border-emerald-800 px-3.5 py-2 text-xs font-semibold text-emerald-800 dark:text-emerald-200 flex items-center justify-between">
          <span>✅ {banner}</span>
          <button onClick={() => setBanner("")} className="text-emerald-700 hover:underline ml-3">
            Đóng
          </button>
        </div>
      )}

      {/* =====================================================================
          TAB 1: BALANCED SCORECARD 8 DEPARTMENTS + REVIEW-BY-EXCEPTION & COSTING
         ===================================================================== */}
      {tab === "scorecard_rbe" && (
        <div className="space-y-4">
          <Card
            title="Bảng Điểm Cân Bằng & Chỉ Số SLA Thực Tế Của 8 Phòng Ban (Real-time Balanced Scorecard)"
            actions={
              <span className="text-[11px] text-slate-500">
                Bấm vào từng phòng ban để đi tới phân hệ điều hành tương ứng
              </span>
            }
          >
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
              {(data?.department_scorecards ?? []).map((d: any) => (
                <div
                  key={d.dept_code}
                  className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/60 p-3 flex flex-col justify-between hover:border-sky-400 transition-colors"
                >
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="px-2 py-0.5 rounded-md text-[10px] font-extrabold bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                        {d.dept_code}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded-full text-[11px] font-extrabold ${
                          d.health_score >= 90
                            ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
                            : "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
                        }`}
                      >
                        Health: {d.health_score}/100
                      </span>
                    </div>
                    <div className="font-bold text-xs text-slate-900 dark:text-white mt-1.5">
                      {d.dept_name}
                    </div>
                    <div className="mt-2 rounded-lg bg-white dark:bg-slate-950 border border-slate-200/80 dark:border-slate-800 p-2">
                      <div className="text-[10px] text-slate-500">{d.primary_kpi_label}</div>
                      <div className="flex items-baseline justify-between mt-0.5">
                        <span className="text-base font-extrabold text-sky-700 dark:text-sky-400">
                          {d.primary_kpi_value}
                        </span>
                        <span className="text-[10px] font-semibold text-slate-400">
                          Mục tiêu: {d.target_label}
                        </span>
                      </div>
                    </div>
                    <div className="mt-2 space-y-1">
                      {(d.metrics ?? []).map((m: any, i: number) => (
                        <div key={i} className="flex items-center justify-between text-[11px]">
                          <span className="text-slate-500">{m.label}:</span>
                          <span className="font-semibold text-slate-800 dark:text-slate-200">{m.value}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="mt-2.5 pt-2 border-t border-slate-200/80 dark:border-slate-800">
                    <div className="text-[11px] text-slate-600 dark:text-slate-400 italic leading-snug">
                      💡 {d.forecast_note}
                    </div>
                    <button
                      onClick={() =>
                        window.dispatchEvent(new CustomEvent("tbr-navigate", { detail: { tab: d.dept_key } }))
                      }
                      className="mt-2 w-full text-center py-1 rounded-lg bg-sky-50 hover:bg-sky-100 dark:bg-sky-950/50 dark:hover:bg-sky-900/60 text-sky-700 dark:text-sky-300 text-[11px] font-bold cursor-pointer transition-colors"
                    >
                      Mở phân hệ {d.dept_code} ➔
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card
            title="Công Nghệ Duyệt Hồ Sơ Lô Theo Ngoại Lệ (Review-by-Exception — RbE) & Giá Thành Thực Tế Theo Lô (Actual Batch Costing)"
            actions={
              <div className="flex items-center gap-1.5">
                {[
                  { id: "ALL" as const, label: `Tất cả (${totalBatchesCount})` },
                  { id: "ZERO_EXCEPTION" as const, label: `🟢 Zero-Exception (${zeroExCount})` },
                  {
                    id: "EXCEPTION" as const,
                    label: `🔴 Có Cảnh báo Ngoại lệ (${totalBatchesCount - zeroExCount})`,
                  },
                ].map((f) => (
                  <button
                    key={f.id}
                    onClick={() => setRbeFilter(f.id)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-bold cursor-pointer ${
                      rbeFilter === f.id
                        ? "bg-sky-700 text-white"
                        : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300"
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            }
          >
            {filteredRbeBatches.length === 0 ? (
              <Empty text="Không có hồ sơ lô nào khớp bộ lọc." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 text-left text-[11px] uppercase text-slate-400">
                      <th className="py-2 pr-3">Mã Lệnh / Lô</th>
                      <th className="py-2 pr-3">Sản phẩm</th>
                      <th className="py-2 pr-3">SL Đạt / KH</th>
                      <th className="py-2 pr-3">Đánh giá Ngoại lệ (Review-by-Exception)</th>
                      <th className="py-2 pr-3 text-right">Giá vốn Chuẩn/ĐV</th>
                      <th className="py-2 pr-3 text-right">Giá vốn Thực tế/ĐV</th>
                      <th className="py-2 pr-3 text-right">Lệch Giá thành</th>
                      <th className="py-2 text-right">Hành động 1-Click</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                    {filteredRbeBatches.map((b: any) => (
                      <tr key={b.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/30">
                        <td className="py-2.5 pr-3">
                          <div className="font-mono font-bold text-slate-900 dark:text-white">{b.code}</div>
                          <div className="text-[11px] text-slate-500">
                            {b.batch_domain} · Lô: <span className="font-mono">{b.lot_code ?? "—"}</span> ·{" "}
                            <StatusBadge status={b.status} />
                          </div>
                        </td>
                        <td className="py-2.5 pr-3">
                          <div className="font-semibold text-slate-800 dark:text-slate-200">{b.product_name}</div>
                          <div className="text-[11px] text-slate-500 font-mono">{b.product_code}</div>
                        </td>
                        <td className="py-2.5 pr-3 font-mono">
                          <b>{fmtQty(b.good_qty)}</b> / {fmtQty(b.planned_qty)} {b.uom}
                        </td>
                        <td className="py-2.5 pr-3">
                          {b.rbe_status === "ZERO_EXCEPTION" ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300">
                              🟢 Zero-Exception (Đạt chuẩn 100% · Lệch BOM {b.max_bom_variance_pct.toFixed(1)}%)
                            </span>
                          ) : (
                            <div className="space-y-1">
                              <span
                                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold ${
                                  b.rbe_status === "CRITICAL_EXCEPTION"
                                    ? "bg-rose-100 text-rose-800 dark:bg-rose-950/70 dark:text-rose-300"
                                    : "bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300"
                                }`}
                              >
                                ⚠️ {b.exception_count} Ngoại lệ cần QA thẩm định
                              </span>
                              <ul className="list-disc list-inside text-[11px] text-rose-700 dark:text-rose-300">
                                {(b.exceptions ?? []).map((ex: string, idx: number) => (
                                  <li key={idx}>{ex}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </td>
                        <td className="py-2.5 pr-3 text-right font-mono text-slate-600 dark:text-slate-400">
                          {Number(b.costing?.std_unit_cost ?? 0).toLocaleString("vi-VN")} đ
                        </td>
                        <td className="py-2.5 pr-3 text-right font-mono">
                          <div className="font-bold text-slate-900 dark:text-white">
                            {Number(b.costing?.actual_unit_cost ?? 0).toLocaleString("vi-VN")} đ
                          </div>
                          <div className="text-[10px] text-slate-400">
                            Tổng lô: {Number(b.costing?.actual_total_cost ?? 0).toLocaleString("vi-VN")} đ
                          </div>
                        </td>
                        <td className="py-2.5 pr-3 text-right font-mono">
                          <span
                            className={`px-2 py-0.5 rounded-md text-[11px] font-bold ${
                              Number(b.costing?.cost_variance_pct) > 5
                                ? "bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300"
                                : "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
                            }`}
                          >
                            {Number(b.costing?.cost_variance_pct) > 0 ? "+" : ""}
                            {b.costing?.cost_variance_pct}%
                          </span>
                        </td>
                        <td className="py-2.5 text-right">
                          {b.rbe_status === "ZERO_EXCEPTION" ? (
                            <Button
                              variant="primary"
                              disabled={busyKey === `rbe-${b.id}` || b.status === "COMPLETED" || b.status === "READY"}
                              onClick={() =>
                                runAction(
                                  `rbe-${b.id}`,
                                  {
                                    op: "fast_track_release",
                                    batch_id: b.id,
                                    batch_domain: b.batch_domain,
                                  },
                                  `Đã duyệt xuất xưởng nhanh (Fast-Track RbE) cho lô ${b.code}!`
                                )
                              }
                            >
                              {b.status === "COMPLETED" || b.status === "READY"
                                ? "✓ Đã giải phóng"
                                : "⚡ Duyệt Nhanh RbE"}
                            </Button>
                          ) : (
                            <Button
                              variant="secondary"
                              disabled={busyKey === `capa-rbe-${b.id}`}
                              onClick={() =>
                                runAction(
                                  `capa-rbe-${b.id}`,
                                  {
                                    op: "create_capa",
                                    title: `[RbE Exception] Thẩm định ngoại lệ lô ${b.code} (${b.product_code})`,
                                    source_module: b.batch_domain,
                                    severity: b.rbe_status === "CRITICAL_EXCEPTION" ? "CRITICAL" : "HIGH",
                                    root_cause: (b.exceptions ?? []).join("; "),
                                    corrective_action: `Rà soát hồ sơ EBR/DHR của lô ${b.code}, ký bù kiểm tra kép và đánh giá độ lệch vật tư`,
                                    preventive_action: "Chuẩn hóa checklist Line Clearance & khóa bước tự động trên hệ thống",
                                  },
                                  `Đã khởi tạo hồ sơ CAPA thẩm định ngoại lệ cho lô ${b.code}!`
                                )
                              }
                            >
                              🛡️ Mở CAPA Thẩm định
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}

      {/* =====================================================================
          TAB 2: SPC LEVEY-JENNINGS + PARETO 80/20 + BOM VARIANCE & BOTTLENECK
         ===================================================================== */}
      {tab === "spc_pareto_pdca" && (
        <div className="space-y-4">
          <Card
            title="Biểu Đồ Kiểm Soát Thống Kê SPC (Levey-Jennings Chart ±1SD, ±2SD, ±3SD & Quy Tắc Westgard)"
            actions={
              <div className="flex flex-wrap items-center gap-2">
                <select
                  className={inputClass + " !w-auto text-xs font-bold"}
                  value={activeSpc?.id ?? ""}
                  onChange={(e) => setSelectedSpcId(e.target.value)}
                >
                  {(data?.spc_series ?? []).map((s: any) => (
                    <option key={s.id} value={s.id}>
                      [{s.department}] {s.name} ({s.latest_rule})
                    </option>
                  ))}
                </select>
                <Button variant="secondary" onClick={() => setShowAddSpcForm((v) => !v)}>
                  {showAddSpcForm ? "Đóng form" : "+ Ghi nhận điểm đo QC mới"}
                </Button>
              </div>
            }
          >
            {showAddSpcForm && activeSpc && (
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  const res = await runAction(
                    "add-spc",
                    {
                      op: "add_spc_point",
                      series_id: activeSpc.id,
                      batch_or_lot_code: spcForm.batch_or_lot_code,
                      measured_value: Number(spcForm.measured_value),
                      analyst_name: spcForm.analyst_name || undefined,
                      notes: spcForm.notes || undefined,
                    },
                    `Đã ghi nhận điểm đo SPC cho lô ${spcForm.batch_or_lot_code} và kiểm tra quy tắc Westgard!`
                  );
                  if (res) {
                    setSpcForm({ batch_or_lot_code: "", measured_value: "", analyst_name: "", notes: "" });
                    setShowAddSpcForm(false);
                  }
                }}
                className="mb-4 rounded-xl border border-sky-200 dark:border-sky-900 bg-sky-50/50 dark:bg-sky-950/20 p-3 grid grid-cols-1 sm:grid-cols-5 gap-2.5 items-end"
              >
                <Field label="Mã Lô / Mẻ QC">
                  <input
                    required
                    className={inputClass}
                    placeholder="VD: MO2610-0006"
                    value={spcForm.batch_or_lot_code}
                    onChange={(e) => setSpcForm({ ...spcForm, batch_or_lot_code: e.target.value })}
                  />
                </Field>
                <Field label={`Giá trị đo (${activeSpc.unit})`}>
                  <input
                    required
                    type="number"
                    step="0.01"
                    className={inputClass}
                    placeholder={`Mean: ${activeSpc.target_mean}`}
                    value={spcForm.measured_value}
                    onChange={(e) => setSpcForm({ ...spcForm, measured_value: e.target.value })}
                  />
                </Field>
                <Field label="Kiểm nghiệm viên">
                  <input
                    className={inputClass}
                    placeholder="Tên KTV QC"
                    value={spcForm.analyst_name}
                    onChange={(e) => setSpcForm({ ...spcForm, analyst_name: e.target.value })}
                  />
                </Field>
                <Field label="Ghi chú mẫu chuẩn">
                  <input
                    className={inputClass}
                    placeholder="Ghi chú lô hóa chất..."
                    value={spcForm.notes}
                    onChange={(e) => setSpcForm({ ...spcForm, notes: e.target.value })}
                  />
                </Field>
                <div className="flex gap-2">
                  <Button type="submit" variant="primary" disabled={busyKey === "add-spc"}>
                    Lưu & Chấm Westgard
                  </Button>
                </div>
              </form>
            )}

            {activeSpc ? (
              <div className="space-y-3">
                {/* Status & Westgard Rule Alert Banner */}
                <div
                  className={`rounded-xl border p-3 flex flex-wrap items-center justify-between gap-3 ${
                    activeSpc.latest_status === "OUT_OF_CONTROL"
                      ? "border-rose-300 bg-rose-50 dark:bg-rose-950/40 dark:border-rose-800"
                      : activeSpc.latest_status === "WARNING"
                        ? "border-amber-300 bg-amber-50 dark:bg-amber-950/40 dark:border-amber-800"
                        : "border-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 dark:border-emerald-800"
                  }`}
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-extrabold text-xs uppercase px-2 py-0.5 rounded bg-white/80 dark:bg-slate-900">
                        Quy tắc Westgard: {activeSpc.latest_rule}
                      </span>
                      <span className="font-bold text-xs text-slate-900 dark:text-white">
                        {activeSpc.latest_summary}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-600 dark:text-slate-300 mt-1">
                      Giá trị đích (Target Mean): <b>{activeSpc.target_mean} {activeSpc.unit}</b> · Độ lệch chuẩn (1SD):{" "}
                      <b>±{activeSpc.sd_value} {activeSpc.unit}</b> · Trung bình thực nghiệm:{" "}
                      <b>{activeSpc.empirical_mean} {activeSpc.unit}</b> (CV%: {activeSpc.cv_pct}%) · Thiết bị:{" "}
                      <b>{activeSpc.instrument_code}</b> · Mẫu chuẩn: <b>{activeSpc.standard_code}</b>
                    </div>
                  </div>
                  {activeSpc.latest_status !== "IN_CONTROL" && (
                    <Button
                      variant="danger"
                      disabled={busyKey === `spc-capa-${activeSpc.id}`}
                      onClick={() =>
                        runAction(
                          `spc-capa-${activeSpc.id}`,
                          {
                            op: "create_capa",
                            title: `[SPC Pre-OOS Warning ${activeSpc.latest_rule}] Xử lý xu hướng trôi ${activeSpc.name}`,
                            source_module: activeSpc.department,
                            severity: activeSpc.latest_status === "OUT_OF_CONTROL" ? "CRITICAL" : "HIGH",
                            root_cause: activeSpc.latest_summary,
                            corrective_action: `Kiểm tra lại mẫu chuẩn ${activeSpc.standard_code}, hiệu chuẩn thiết bị ${activeSpc.instrument_code} và rà soát hoạt tính lô Enzyme/Hóa chất`,
                            preventive_action: "Thiết lập ngưỡng cảnh báo sớm 4-1s / Trend-5 trước khi chạm giới hạn OOS",
                          },
                          `Đã tạo phiếu CAPA phòng ngừa sớm từ cảnh báo SPC (${activeSpc.latest_rule})!`
                        )
                      }
                    >
                      🛡️ 1-Click Mở CAPA Phòng Ngừa Sớm (Pre-OOS)
                    </Button>
                  )}
                </div>

                {/* SVG Levey-Jennings Control Chart */}
                {(() => {
                  const pts = activeSpc.points ?? [];
                  const mean = Number(activeSpc.target_mean);
                  const sd = Number(activeSpc.sd_value);
                  const w = 860;
                  const h = 230;
                  const padL = 62;
                  const padR = 30;
                  const padT = 20;
                  const padB = 34;
                  const plotW = w - padL - padR;
                  const plotH = h - padT - padB;
                  const zToY = (z: number) => {
                    const clamped = Math.max(-3.6, Math.min(3.6, z));
                    return padT + ((3.6 - clamped) / 7.2) * plotH;
                  };
                  const idxToX = (i: number) =>
                    pts.length <= 1 ? padL + plotW / 2 : padL + (i / (pts.length - 1)) * plotW;

                  const polylinePoints = pts
                    .map((p: any, i: number) => `${idxToX(i)},${zToY((p.measured_value - mean) / sd)}`)
                    .join(" ");

                  return (
                    <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-950 p-3">
                      <svg viewBox={`0 0 ${w} ${h}`} className="w-full min-w-[680px] h-56">
                        {/* Horizontal SD guide lines */}
                        {[
                          { z: 3, label: `+3SD (${(mean + 3 * sd).toFixed(2)})`, color: "#f43f5e", dash: "4 3" },
                          { z: 2, label: `+2SD (${(mean + 2 * sd).toFixed(2)})`, color: "#f59e0b", dash: "4 3" },
                          { z: 1, label: `+1SD (${(mean + 1 * sd).toFixed(2)})`, color: "#10b981", dash: "2 3" },
                          { z: 0, label: `Mean (${mean.toFixed(2)})`, color: "#38bdf8", dash: "" },
                          { z: -1, label: `-1SD (${(mean - 1 * sd).toFixed(2)})`, color: "#10b981", dash: "2 3" },
                          { z: -2, label: `-2SD (${(mean - 2 * sd).toFixed(2)})`, color: "#f59e0b", dash: "4 3" },
                          { z: -3, label: `-3SD (${(mean - 3 * sd).toFixed(2)})`, color: "#f43f5e", dash: "4 3" },
                        ].map((g) => (
                          <g key={g.z}>
                            <line
                              x1={padL}
                              y1={zToY(g.z)}
                              x2={w - padR}
                              y2={zToY(g.z)}
                              stroke={g.color}
                              strokeWidth={g.z === 0 ? 1.8 : 1}
                              strokeDasharray={g.dash}
                              opacity={0.75}
                            />
                            <text
                              x={padL - 6}
                              y={zToY(g.z) + 3}
                              textAnchor="end"
                              fontSize="9.5"
                              fill={g.color}
                              fontFamily="monospace"
                            >
                              {g.label}
                            </text>
                          </g>
                        ))}

                        {/* Connecting line */}
                        {pts.length > 1 && (
                          <polyline
                            fill="none"
                            stroke="#38bdf8"
                            strokeWidth="2.2"
                            points={polylinePoints}
                          />
                        )}

                        {/* Plotted points */}
                        {pts.map((p: any, i: number) => {
                          const z = (p.measured_value - mean) / sd;
                          const cx = idxToX(i);
                          const cy = zToY(z);
                          const ptColor =
                            p.westgard_status === "OUT_OF_CONTROL"
                              ? "#f43f5e"
                              : p.westgard_status === "WARNING"
                                ? "#f59e0b"
                                : "#22c55e";
                          return (
                            <g key={p.id}>
                              <circle cx={cx} cy={cy} r={5} fill={ptColor} stroke="#0f172a" strokeWidth="1.5" />
                              <text
                                x={cx}
                                y={cy - 8}
                                textAnchor="middle"
                                fontSize="9.5"
                                fill="#f8fafc"
                                fontFamily="monospace"
                              >
                                {p.measured_value}
                              </text>
                              <text
                                x={cx}
                                y={h - 10}
                                textAnchor="middle"
                                fontSize="9"
                                fill="#94a3b8"
                                fontFamily="monospace"
                              >
                                {p.batch_or_lot_code}
                              </text>
                            </g>
                          );
                        })}
                      </svg>
                    </div>
                  );
                })()}
              </div>
            ) : (
              <Empty text="Chưa có chuỗi kiểm soát SPC." />
            )}
          </Card>

          {/* Pareto 80/20 & BOM Variance side-by-side */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            <div className="lg:col-span-6">
              <Card title="Phân Tích Pareto 80/20 Nguyên Nhân Gốc (5M) & 1-Click Mở CAPA">
                <div className="space-y-2.5">
                  {(data?.pareto_root_causes ?? []).map((item: any) => (
                    <div
                      key={item.category_code}
                      className="rounded-xl border border-slate-200 dark:border-slate-800 p-3 bg-slate-50/50 dark:bg-slate-900/40"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <span className="px-2 py-0.5 rounded text-[10px] font-extrabold bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300 mr-1.5">
                            {item.m_group}
                          </span>
                          <span className="font-bold text-xs text-slate-900 dark:text-white">{item.label}</span>
                        </div>
                        <span className="font-mono text-xs font-extrabold text-slate-700 dark:text-slate-200 whitespace-nowrap">
                          {item.count} sự cố ({item.share_pct}% · Tích lũy {item.cumulative_pct}%)
                        </span>
                      </div>
                      <div className="w-full h-2 rounded-full bg-slate-200 dark:bg-slate-800 mt-2 overflow-hidden">
                        <div
                          className={`h-full rounded-full ${
                            item.is_vital_few ? "bg-rose-500" : "bg-sky-500"
                          }`}
                          style={{ width: `${Math.min(100, item.share_pct * 1.8)}%` }}
                        />
                      </div>
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <div className="text-[11px] text-slate-600 dark:text-slate-400">
                          <b>Đề xuất PDCA:</b> {item.recommended_capa}
                        </div>
                        <Button
                          variant="secondary"
                          disabled={busyKey === `pareto-${item.category_code}`}
                          onClick={() =>
                            runAction(
                              `pareto-${item.category_code}`,
                              {
                                op: "create_capa",
                                title: `[Pareto 80/20 - ${item.m_group}] ${item.label}`,
                                source_module: "QMS",
                                severity: item.is_vital_few ? "HIGH" : "MEDIUM",
                                root_cause: item.label,
                                corrective_action: item.recommended_capa,
                                preventive_action: "Đánh giá hiệu quả cải tiến sau 3 lô sản xuất liên tiếp",
                              },
                              `Đã tạo phiếu CAPA cải tiến cho nhóm nguyên nhân ${item.m_group}!`
                            )
                          }
                        >
                          🛡️ 1-Click Mở CAPA
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            </div>

            <div className="lg:col-span-6 space-y-4">
              <Card title="Phân Tích Độ Lệch Định Mức (BOM Variance) & Hiệu Chỉnh Hao Hụt 1-Click">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-800 text-left text-[11px] uppercase text-slate-400">
                        <th className="py-2 pr-2">BOM / Vật tư</th>
                        <th className="py-2 pr-2 text-right">Hao hụt BOM</th>
                        <th className="py-2 pr-2 text-right">Thực tế lệch</th>
                        <th className="py-2 pr-2 text-right">Gợi ý mới</th>
                        <th className="py-2 text-right">Cập nhật</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                      {(data?.bom_variance_rows ?? []).map((r: any) => (
                        <tr key={r.bom_line_id}>
                          <td className="py-2 pr-2">
                            <div className="font-semibold text-slate-800 dark:text-slate-200">{r.item_name}</div>
                            <div className="text-[10px] text-slate-500 font-mono">
                              {r.bom_code} · {r.item_code} ({r.qty_per_base} {r.uom})
                            </div>
                          </td>
                          <td className="py-2 pr-2 text-right font-mono">{r.current_scrap_pct}%</td>
                          <td className="py-2 pr-2 text-right font-mono">
                            <span
                              className={
                                Math.abs(r.observed_variance_pct) > 4
                                  ? "text-rose-600 font-bold"
                                  : "text-slate-600 dark:text-slate-300"
                              }
                            >
                              {r.observed_variance_pct > 0 ? "+" : ""}
                              {r.observed_variance_pct}%
                            </span>
                          </td>
                          <td className="py-2 pr-2 text-right font-mono font-bold text-sky-700 dark:text-sky-400">
                            {r.recommended_scrap_pct}%
                          </td>
                          <td className="py-2 text-right">
                            <Button
                              variant="secondary"
                              disabled={busyKey === `bom-${r.bom_line_id}`}
                              onClick={() =>
                                runAction(
                                  `bom-${r.bom_line_id}`,
                                  {
                                    op: "adjust_bom_scrap",
                                    bom_line_id: r.bom_line_id,
                                    new_scrap_pct: r.recommended_scrap_pct,
                                  },
                                  `Đã cập nhật hệ số hao hụt BOM cho ${r.item_code} thành ${r.recommended_scrap_pct}%!`
                                )
                              }
                            >
                              ⚙️ Cập nhật BOM
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>

              <Card title="Radar Chẩn Đoán Nút Thắt Cổ Chai Quy Trình (Process Bottleneck Radar)">
                <div className="space-y-2">
                  {(data?.bottlenecks ?? []).map((b: any) => (
                    <div
                      key={b.stage_code}
                      className="rounded-xl border border-slate-200 dark:border-slate-800 p-2.5 flex items-center justify-between gap-3"
                    >
                      <div>
                        <div className="text-xs font-bold text-slate-900 dark:text-white">
                          [{b.department}] {b.stage_name}
                        </div>
                        <div className="text-[11px] text-slate-500 mt-0.5">
                          Thời gian chờ TB: <b className="text-rose-600">{b.avg_wait_hours}h</b> (SLA: {b.sla_hours}h) ·
                          Tồn đọng: <b>{b.backlog_count} hồ sơ</b> · Giải pháp: <i>{b.recommended_action}</i>
                        </div>
                      </div>
                      <StatusBadge status={b.impact_level} />
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          TAB 3: 30/60/90-DAY PREDICTIVE FORECASTING & WHAT-IF ATP/CTP SIMULATOR
         ===================================================================== */}
      {tab === "forecast_whatif" && (
        <div className="space-y-4">
          {/* What-If Order & Capacity Simulator */}
          <Card title="Bộ Mô Phỏng Năng Lực Đáp Ứng Đơn Hàng & Kịch Bản What-If (ATP / CTP Simulator)">
            <form
              onSubmit={handleRunSimulation}
              className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end bg-slate-50 dark:bg-slate-900/50 p-3 rounded-xl border border-slate-200 dark:border-slate-800"
            >
              <Field label="Chọn Sản phẩm (Kit IVD / Máy Thiết bị / Oligo)">
                <select
                  className={inputClass}
                  value={simForm.item_id}
                  onChange={(e) => setSimForm({ ...simForm, item_id: e.target.value })}
                >
                  {(data?.simulatable_products ?? []).map((p: any) => (
                    <option key={p.item_id} value={p.item_id}>
                      [{p.product_domain}] {p.code} — {p.name} (Tồn TP: {fmtQty(p.fg_available_qty)} {p.uom})
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Số lượng dự kiến đặt (Order Qty)">
                <input
                  type="number"
                  min="1"
                  required
                  className={inputClass}
                  value={simForm.order_qty}
                  onChange={(e) => setSimForm({ ...simForm, order_qty: e.target.value })}
                />
              </Field>
              <Field label="Ngày khách hàng cần (Target Date)">
                <input
                  type="date"
                  className={inputClass}
                  value={simForm.needed_by_date}
                  onChange={(e) => setSimForm({ ...simForm, needed_by_date: e.target.value })}
                />
              </Field>
              <div>
                <Button type="submit" variant="primary" disabled={busyKey === "simulate"}>
                  {busyKey === "simulate" ? "Đang nổ BOM..." : "⚡ Chạy Mô Phỏng ATP / CTP"}
                </Button>
              </div>
            </form>

            {simResult && (
              <div className="mt-4 space-y-3">
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3">
                    <div className="text-[11px] text-slate-500">Tồn Thành Phẩm Đáp Ứng Ngay (ATP)</div>
                    <div className="text-base font-extrabold text-slate-900 dark:text-white mt-0.5">
                      {fmtQty(simResult.fg_available_qty)} / {fmtQty(simResult.order_qty)} {simResult.product.uom} (
                      {simResult.fg_coverage_pct}%)
                    </div>
                    <div className="text-[11px] text-sky-600 mt-0.5">
                      Cần sản xuất thêm: <b>{fmtQty(simResult.net_to_produce)} {simResult.product.uom}</b>
                    </div>
                  </div>
                  <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3">
                    <div className="text-[11px] text-slate-500">Tình Trạng Nguyên Vật Liệu (BOM Explosion)</div>
                    <div className="text-base font-extrabold text-slate-900 dark:text-white mt-0.5">
                      {simResult.shortage_count === 0 ? (
                        <span className="text-emerald-600">Đủ 100% NVL tại kho</span>
                      ) : (
                        <span className="text-rose-600">Thiếu {simResult.shortage_count} mã NVL</span>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-500 mt-0.5">
                      Chờ mua NVL tối đa: <b>{simResult.max_procurement_wait_days} ngày</b>
                    </div>
                  </div>
                  <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3">
                    <div className="text-[11px] text-slate-500">Ngày Giao Khả Thi Sớm Nhất (CTP Date)</div>
                    <div className="text-base font-extrabold text-sky-700 dark:text-sky-400 mt-0.5">
                      Ca thường: {simResult.ctp_date_normal}
                    </div>
                    <div className="text-[11px] text-emerald-600 font-semibold mt-0.5">
                      ⚡ Tăng ca: {simResult.ctp_date_overtime} ({simResult.can_meet_target_overtime ? "Kịp hạn khách cần" : "Cần đàm phán lại hạn giao"})
                    </div>
                  </div>
                  <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3 flex flex-col justify-between">
                    <div>
                      <div className="text-[11px] text-slate-500">Dự Toán Chi Phí Sản Xuất Lô</div>
                      <div className="text-base font-extrabold text-slate-900 dark:text-white mt-0.5">
                        {Number(simResult.estimated_total_cost).toLocaleString("vi-VN")} đ
                      </div>
                    </div>
                    {simResult.shortage_count > 0 && (
                      <Button
                        variant="primary"
                        disabled={busyKey === "sim-pr"}
                        onClick={() => {
                          const shortItems = (simResult.bom_lines ?? [])
                            .filter((l: any) => l.shortage_qty > 0)
                            .map((l: any) => ({
                              item_id: l.item_id,
                              qty: Math.ceil(l.shortage_qty),
                              uom: l.uom,
                              est_price: l.std_unit_cost,
                            }));
                          runAction(
                            "sim-pr",
                            {
                              op: "create_forecast_pr",
                              items: shortItems,
                              reason: `[Kịch bản What-If ATP/CTP] Mua toàn bộ NVL thiếu cho đơn dự kiến ${simResult.order_qty} ${simResult.product.uom} ${simResult.product.code}`,
                            },
                            `Đã phát hành PR mua toàn bộ ${shortItems.length} mã NVL thiếu cho kịch bản What-If!`
                          );
                        }}
                      >
                        🛒 1-Click Mua Toàn Bộ NVL Thiếu
                      </Button>
                    )}
                  </div>
                </div>

                {/* BOM Explosion Detail Table */}
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-800 text-left text-[11px] uppercase text-slate-400">
                        <th className="py-1.5 pr-3">Mã NVL / Linh kiện</th>
                        <th className="py-1.5 pr-3">Tên Vật tư</th>
                        <th className="py-1.5 pr-3 text-right">Định mức/ĐV</th>
                        <th className="py-1.5 pr-3 text-right">Tổng cần dùng</th>
                        <th className="py-1.5 pr-3 text-right">Tồn khả dụng (A1)</th>
                        <th className="py-1.5 pr-3 text-right">Lượng thiếu hụt</th>
                        <th className="py-1.5 pr-3 text-right">Lead-time NCC</th>
                        <th className="py-1.5 text-right">Trạng thái</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                      {(simResult.bom_lines ?? []).map((l: any, i: number) => (
                        <tr key={i}>
                          <td className="py-1.5 pr-3 font-mono font-bold">{l.item_code}</td>
                          <td className="py-1.5 pr-3">{l.item_name}</td>
                          <td className="py-1.5 pr-3 text-right font-mono">
                            {fmtQty(l.qty_per_unit)} {l.uom}
                          </td>
                          <td className="py-1.5 pr-3 text-right font-mono font-bold">
                            {fmtQty(l.required_qty)} {l.uom}
                          </td>
                          <td className="py-1.5 pr-3 text-right font-mono text-emerald-700 dark:text-emerald-400">
                            {fmtQty(l.available_qty)} {l.uom}
                          </td>
                          <td className="py-1.5 pr-3 text-right font-mono font-bold text-rose-600">
                            {l.shortage_qty > 0 ? `${fmtQty(l.shortage_qty)} ${l.uom}` : "0"}
                          </td>
                          <td className="py-1.5 pr-3 text-right font-mono">{l.lead_time_days} ngày</td>
                          <td className="py-1.5 text-right">
                            <StatusBadge status={l.status} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </Card>

          {/* 30/60/90-day Material Run-out Date & Dynamic ROP */}
          <Card title="Dự Báo Ngày Cạn Vật Tư 30/60/90 Ngày (Material Run-Out Date) & Ngưỡng Tồn Kho Động (Dynamic ROP)">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-left text-[11px] uppercase text-slate-400">
                    <th className="py-2 pr-3">Mã & Tên Vật Tư</th>
                    <th className="py-2 pr-3 text-right">Tồn A1 + BT + PO</th>
                    <th className="py-2 pr-3 text-right">Tốc độ đốt/ngày</th>
                    <th className="py-2 pr-3 text-right">Ngày cạn dự kiến</th>
                    <th className="py-2 pr-3 text-right">Nhu cầu 30 / 60 / 90d</th>
                    <th className="py-2 pr-3 text-right">Min Stock (Hiện tại ➔ Động)</th>
                    <th className="py-2 text-right">Hành động Dự báo 1-Click</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                  {(data?.material_runout_forecast ?? []).slice(0, 15).map((m: any) => (
                    <tr key={m.item_id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/30">
                      <td className="py-2 pr-3">
                        <div className="font-semibold text-slate-900 dark:text-white">{m.item_name}</div>
                        <div className="text-[11px] text-slate-500 font-mono">
                          {m.item_code} · Lead-time NCC: {m.lead_time_days} ngày
                        </div>
                      </td>
                      <td className="py-2 pr-3 text-right font-mono">
                        <b>{fmtQty(m.effective_supply)}</b> {m.uom}
                        <div className="text-[10px] text-slate-400">
                          A1:{fmtQty(m.avail_a1_qty)} · BT:{fmtQty(m.quarantine_bt_qty)} · PO:{fmtQty(m.open_po_qty)}
                        </div>
                      </td>
                      <td className="py-2 pr-3 text-right font-mono">
                        {m.daily_burn_rate} {m.uom}/ngày
                      </td>
                      <td className="py-2 pr-3 text-right">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${
                            m.risk_status === "CRITICAL_STOCKOUT"
                              ? "bg-rose-100 text-rose-800 dark:bg-rose-950/70 dark:text-rose-300"
                              : m.risk_status === "REORDER_NOW"
                                ? "bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300"
                                : "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300"
                          }`}
                        >
                          Còn {m.runout_days} ngày ({m.runout_date})
                        </span>
                      </td>
                      <td className="py-2 pr-3 text-right font-mono text-[11px]">
                        {m.demand_30d} / {m.demand_60d} / {m.demand_90d} {m.uom}
                      </td>
                      <td className="py-2 pr-3 text-right font-mono">
                        {fmtQty(m.min_safety_stock)} ➔{" "}
                        <b className="text-sky-700 dark:text-sky-400">{fmtQty(m.dynamic_min_stock)}</b> {m.uom}
                      </td>
                      <td className="py-2 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <Button
                            variant="secondary"
                            disabled={busyKey === `rop-${m.item_id}`}
                            onClick={() =>
                              runAction(
                                `rop-${m.item_id}`,
                                {
                                  op: "update_dynamic_rop",
                                  item_id: m.item_id,
                                  new_min_safety_stock: m.dynamic_min_stock,
                                },
                                `Đã cập nhật Min Safety Stock động cho ${m.item_code} thành ${m.dynamic_min_stock} ${m.uom}!`
                              )
                            }
                          >
                            📈 Cập nhật ROP
                          </Button>
                          <Button
                            variant="primary"
                            disabled={busyKey === `pr-${m.item_id}`}
                            onClick={() =>
                              runAction(
                                `pr-${m.item_id}`,
                                {
                                  op: "create_forecast_pr",
                                  items: [
                                    {
                                      item_id: m.item_id,
                                      qty: m.recommended_pr_qty,
                                      uom: m.uom,
                                      est_price: m.std_unit_cost,
                                    },
                                  ],
                                  reason: `[Dự báo MRP 30/60/90 ngày] Đặt mua dự phòng ${m.item_code} (Dự kiến cạn sau ${m.runout_days} ngày, Lead-time ${m.lead_time_days} ngày)`,
                                },
                                `Đã phát hành PR Dự báo (${m.recommended_pr_qty} ${m.uom}) cho mã ${m.item_code}!`
                              )
                            }
                          >
                            🛒 Tạo PR ({m.recommended_pr_qty})
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Capacity Load Forecast */}
          <Card title="Dự Báo Tải Công Suất Nhà Máy 30 / 60 / 90 Ngày (Factory Capacity Planning)">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {(data?.capacity_forecast ?? []).map((c: any) => (
                <div
                  key={c.resource_code}
                  className="rounded-xl border border-slate-200 dark:border-slate-800 p-3 bg-slate-50/40 dark:bg-slate-900/40"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-900 dark:text-white">
                      [{c.department}] {c.resource_name}
                    </span>
                    <StatusBadge status={c.bottleneck_risk} />
                  </div>
                  <div className="grid grid-cols-3 gap-2 mt-2.5 text-center">
                    {[
                      { label: "Tải 30 ngày tới", val: c.load_30d_pct },
                      { label: "Tải 60 ngày tới", val: c.load_60d_pct },
                      { label: "Tải 90 ngày tới", val: c.load_90d_pct },
                    ].map((b) => (
                      <div
                        key={b.label}
                        className="rounded-lg bg-white dark:bg-slate-950 border border-slate-200/70 dark:border-slate-800 p-2"
                      >
                        <div className="text-[10px] text-slate-500">{b.label}</div>
                        <div
                          className={`text-sm font-extrabold mt-0.5 ${
                            b.val >= 85 ? "text-rose-600" : b.val >= 75 ? "text-amber-600" : "text-emerald-600"
                          }`}
                        >
                          {b.val}%
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="text-[11px] text-slate-600 dark:text-slate-400 mt-2">
                    💡 <b>Khuyến nghị điều độ:</b> {c.recommendation}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}

      {/* =====================================================================
          TAB 4: 360° LOT GENEALOGY + FREEZE-THAW BIO-GUARD + ISO 13485 REVIEW
         ===================================================================== */}
      {tab === "genealogy_bio_iso" && (
        <div className="space-y-4">
          {/* 360° Bi-directional Lot Genealogy Tree & 1-Click Cascade Quarantine */}
          <Card
            title="Cây Truy Xuất Phả Hệ Lô 2 Chiều 360° (Upstream ➔ Downstream) & Phong Tỏa Liên Hoàn 1 Chạm (Cascade Quarantine)"
            actions={
              <div className="flex items-center gap-2">
                <select
                  className={inputClass + " !w-auto text-xs font-bold"}
                  value={selectedLotId}
                  onChange={(e) => setSelectedLotId(e.target.value)}
                >
                  {(data?.bio_lots ?? []).map((l: any) => (
                    <option key={l.id} value={l.id}>
                      Lô {l.lot_code} — {l.item_code} ({l.item_name}) [{l.status}]
                    </option>
                  ))}
                </select>
                {selectedLotObj && (
                  <Button
                    variant="danger"
                    disabled={busyKey === `quarantine-${selectedLotObj.id}`}
                    onClick={() =>
                      runAction(
                        `quarantine-${selectedLotObj.id}`,
                        {
                          op: "cascade_quarantine",
                          lot_id: selectedLotObj.id,
                          reason: `Phát hiện cảnh báo chất lượng trên lô ${selectedLotObj.lot_code} (${selectedLotObj.item_code}) — Phong tỏa khẩn cấp toàn bộ lô thành phẩm liên đới`,
                        },
                        `Đã phong tỏa liên hoàn (ON_HOLD) lô ${selectedLotObj.lot_code} cùng toàn bộ lô liên đới và khởi tạo NCR!`
                      )
                    }
                  >
                    🔒 Phong Tỏa Liên Hoàn Chuỗi Lô & Mở NCR
                  </Button>
                )}
              </div>
            }
          >
            {selectedLotObj && (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 items-stretch">
                {/* Upstream Parents */}
                <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3 bg-slate-50/50 dark:bg-slate-900/40">
                  <div className="text-xs font-extrabold uppercase text-slate-500 mb-2">
                    ⬅️ Chiều Ngược (Upstream: Lô NVL / Bán TP cấu thành)
                  </div>
                  {selectedLotGenealogy.upstream.length === 0 ? (
                    <div className="text-xs text-slate-500 italic py-4">
                      Đây là Lô nguyên vật liệu gốc nhập từ Nhà cung cấp / Đầu kỳ (không có lô cha).
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {selectedLotGenealogy.upstream.map((u: any) => (
                        <div
                          key={u.id}
                          onClick={() => setSelectedLotId(u.parent_lot_id)}
                          className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-2.5 cursor-pointer hover:border-sky-400"
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-mono font-bold text-xs text-sky-700 dark:text-sky-400">
                              {u.parent_lot_code}
                            </span>
                            <StatusBadge status={u.parent_lot_status} />
                          </div>
                          <div className="text-xs font-semibold mt-0.5">
                            {u.parent_item_code} — {u.parent_item_name}
                          </div>
                          <div className="text-[11px] text-slate-500">
                            SL sử dụng: {fmtQty(u.qty_used)} {u.uom}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Center Focal Lot */}
                <div className="rounded-xl border-2 border-sky-500 bg-sky-50/40 dark:bg-sky-950/20 p-3 flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-extrabold uppercase text-sky-700 dark:text-sky-300">
                        🎯 Lô Đang Truy Xuất 360°
                      </span>
                      <StatusBadge status={selectedLotObj.status} />
                    </div>
                    <div className="text-base font-extrabold font-mono text-slate-900 dark:text-white mt-1">
                      {selectedLotObj.lot_code}
                    </div>
                    <div className="text-xs font-bold text-slate-700 dark:text-slate-200 mt-0.5">
                      {selectedLotObj.item_code} — {selectedLotObj.item_name}
                    </div>
                    <div className="mt-2 space-y-1 text-xs text-slate-600 dark:text-slate-300">
                      <div>
                        • Tồn hiện tại: <b>{fmtQty(selectedLotObj.qty_on_hand)} {selectedLotObj.uom}</b>
                      </div>
                      <div>
                        • Bảo quản: <b>{selectedLotObj.storage_temp}</b> · HSD:{" "}
                        <b>{selectedLotObj.expiry_date ?? "—"}</b>
                      </div>
                      <div>
                        • Chu kỳ rã đông:{" "}
                        <b>
                          {selectedLotObj.freeze_thaw_count}/{selectedLotObj.max_freeze_thaw} lần
                        </b>
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 pt-2 border-t border-sky-200 dark:border-sky-900 text-[11px] text-slate-500">
                    Bấm vào bất kỳ lô nào ở cột trái/phải để dịch chuyển tâm phả hệ.
                  </div>
                </div>

                {/* Downstream Children */}
                <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3 bg-slate-50/50 dark:bg-slate-900/40">
                  <div className="text-xs font-extrabold uppercase text-slate-500 mb-2">
                    ➡️ Chiều Xuôi (Downstream: Lô Thành phẩm / Lệnh SX đã dùng)
                  </div>
                  {selectedLotGenealogy.downstream.length === 0 ? (
                    <div className="text-xs text-slate-500 italic py-4">
                      Lô này chưa cấp phát vào lô thành phẩm downstream nào (hoặc bản thân là Thành phẩm cuối).
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {selectedLotGenealogy.downstream.map((c: any) => (
                        <div
                          key={c.id}
                          onClick={() => setSelectedLotId(c.child_lot_id)}
                          className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-2.5 cursor-pointer hover:border-sky-400"
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-mono font-bold text-xs text-sky-700 dark:text-sky-400">
                              {c.child_lot_code}
                            </span>
                            <StatusBadge status={c.child_lot_status} />
                          </div>
                          <div className="text-xs font-semibold mt-0.5">
                            {c.child_item_code} — {c.child_item_name}
                          </div>
                          <div className="text-[11px] text-slate-500">
                            Lệnh SX: <b>{c.production_order_code ?? "EBR-LINKED"}</b> · Tiêu hao: {fmtQty(c.qty_used)}{" "}
                            {c.uom}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </Card>

          {/* Bio-Specific Inventory Intelligence: Freeze-Thaw Counter */}
          <Card
            title="Kiểm Soát Đặc Thù Sinh Học: Bộ Đếm Chu Kỳ Rã Đông (❄️ Freeze-Thaw Counter) & Cảnh Báo Suy Giảm Hoạt Tính Enzyme/Oligo"
            actions={
              <input
                className={inputClass + " !w-56 text-xs"}
                placeholder="Tìm mã lô / tên sinh phẩm..."
                value={lotSearch}
                onChange={(e) => setLotSearch(e.target.value)}
              />
            }
          >
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-left text-[11px] uppercase text-slate-400">
                    <th className="py-2 pr-3">Mã Lô</th>
                    <th className="py-2 pr-3">Sinh phẩm / Vật tư</th>
                    <th className="py-2 pr-3">Nhiệt độ & HSD</th>
                    <th className="py-2 pr-3">Chu kỳ Rã đông (Freeze-Thaw)</th>
                    <th className="py-2 pr-3">Lần rã đông gần nhất</th>
                    <th className="py-2 pr-3">Trạng thái Lô</th>
                    <th className="py-2 text-right">Ghi nhận Rã đông</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                  {filteredBioLots.slice(0, 15).map((l: any) => {
                    const ratio = Math.min(100, Math.round((l.freeze_thaw_count / Math.max(1, l.max_freeze_thaw)) * 100));
                    const atLimit = l.freeze_thaw_count >= l.max_freeze_thaw;
                    return (
                      <tr key={l.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/30">
                        <td className="py-2 pr-3 font-mono font-bold text-slate-900 dark:text-white">{l.lot_code}</td>
                        <td className="py-2 pr-3">
                          <div className="font-semibold">{l.item_name}</div>
                          <div className="text-[10px] text-slate-500 font-mono">
                            {l.item_code} · Tồn: {fmtQty(l.qty_on_hand)} {l.uom}
                          </div>
                        </td>
                        <td className="py-2 pr-3">
                          <span className="px-2 py-0.5 rounded bg-sky-50 dark:bg-sky-950/60 text-sky-700 dark:text-sky-300 font-mono text-[11px] font-bold">
                            ❄️ {l.storage_temp}
                          </span>
                          <div className="text-[10px] text-slate-500 mt-0.5">HSD: {l.expiry_date ?? "—"}</div>
                        </td>
                        <td className="py-2 pr-3">
                          <div className="flex items-center gap-2">
                            <span
                              className={`font-mono font-extrabold ${
                                atLimit ? "text-rose-600" : "text-slate-800 dark:text-slate-200"
                              }`}
                            >
                              {l.freeze_thaw_count} / {l.max_freeze_thaw} lần
                            </span>
                            {atLimit && (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300">
                                Chạm ngưỡng tối đa!
                              </span>
                            )}
                          </div>
                          <div className="w-32 h-1.5 rounded-full bg-slate-200 dark:bg-slate-800 mt-1 overflow-hidden">
                            <div
                              className={`h-full rounded-full ${
                                atLimit ? "bg-rose-500" : ratio >= 65 ? "bg-amber-500" : "bg-sky-500"
                              }`}
                              style={{ width: `${ratio}%` }}
                            />
                          </div>
                        </td>
                        <td className="py-2 pr-3 text-[11px] text-slate-500">
                          {l.last_thaw_at ? `${l.last_thaw_at.slice(0, 16)} (${l.last_thaw_by ?? "Lab"})` : "Chưa rã đông"}
                        </td>
                        <td className="py-2 pr-3">
                          <StatusBadge status={l.status} />
                        </td>
                        <td className="py-2 text-right">
                          <Button
                            variant="secondary"
                            disabled={busyKey === `ft-${l.id}`}
                            onClick={() =>
                              runAction(
                                `ft-${l.id}`,
                                {
                                  op: "record_freeze_thaw",
                                  lot_id: l.id,
                                  increment: 1,
                                },
                                `Đã ghi nhận +1 chu kỳ rã đông cho lô ${l.lot_code} (Tự động khóa ON_HOLD nếu vượt ngưỡng cho phép)!`
                              )
                            }
                          >
                            ❄️ +1 Rã đông
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          {/* ISO 13485 §5.6 Management Review Generator */}
          <Card
            title="Báo Cáo Họp Xem Xét Của Lãnh Đạo Tự Động (ISO 13485:2016 §5.6 Management Review Generator)"
            actions={
              <Button variant="primary" onClick={handlePrintIsoReport}>
                🖨️ In / Xuất Báo Cáo Xem Xét Lãnh Đạo ISO 13485
              </Button>
            }
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {(data?.iso13485_management_review?.sections ?? []).map((s: any, idx: number) => (
                <div
                  key={idx}
                  className="rounded-xl border border-slate-200 dark:border-slate-800 p-3 bg-slate-50/50 dark:bg-slate-900/40"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-xs text-sky-800 dark:text-sky-300">{s.clause}</span>
                    <StatusBadge status={s.status} />
                  </div>
                  <p className="text-xs text-slate-700 dark:text-slate-300 mt-1.5 leading-relaxed">{s.summary}</p>
                  <div className="mt-2 pt-2 border-t border-slate-200/70 dark:border-slate-800 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
                    🎯 Quyết định & Hành động: {s.recommended_decision}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

export default FactoryAnalyticsModule;

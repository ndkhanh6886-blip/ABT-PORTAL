"use client";

import React, { useCallback, useEffect, useState } from "react";
import { ActionBar } from "../actions";
import { api, fmtDate, fmtDateTime, fmtQty } from "../api";
import { printKitCoaCertificate } from "../coa";
import { type QcFormsConfig } from "../qcSignatures";
import { Button, Card, Empty, ErrorNote, Field, inputClass, StatusBadge, Table } from "../ui";
import { QcDocumentPreview } from "../qa/QcDocumentPreview";
import { ACTION_LABELS, type KitOptions } from "./shared";

export function QualityTraceView({ options }: { options: KitOptions }) {
  const [subTab, setSubTab] = useState<"genealogy" | "retain" | "stability" | "coa">("genealogy");
  const [selectedLotId, setSelectedLotId] = useState<string>(options.lots[0]?.id ?? "");
  const [traceData, setTraceData] = useState<any | null>(null);
  const [retains, setRetains] = useState<any[]>([]);
  const [studies, setStudies] = useState<any[]>([]);
  const [coas, setCoas] = useState<any[]>([]);
  const [qcFormsConfig, setQcFormsConfig] = useState<Partial<QcFormsConfig> | null>(null);
  const [selectedCoa, setSelectedCoa] = useState<any | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [showCreateRetain, setShowCreateRetain] = useState(false);
  const [showCreateStability, setShowCreateStability] = useState(false);

  const [retForm, setRetForm] = useState({
    org_unit_id: options.units[0]?.id ?? "",
    lot_id: "",
    qty: "2",
    uom: "KIT",
    storage_condition: "-20°C",
  });

  const [stbForm, setStbForm] = useState({
    org_unit_id: options.units[0]?.id ?? "",
    lot_id: "",
    study_type: "REAL_TIME",
    storage_condition: "-20°C ± 5°C",
    protocol_ref: "STB-PROT-2026-01",
  });

  const [tpForm, setTpForm] = useState<Record<string, { result: string; summary: string }>>({});

  const loadQuality = useCallback(async () => {
    setError(null);
    try {
      const res = await api<{
        retain_samples: any[];
        stability_studies: any[];
        coas: any[];
        qc_forms_config?: Partial<QcFormsConfig>;
      }>("/api/factory/kit/quality");
      setRetains(res.retain_samples);
      setStudies(res.stability_studies);
      setCoas(res.coas);
      setQcFormsConfig(res.qc_forms_config ?? null);
    } catch (e) {
      setError(e);
    }
  }, []);

  const loadTrace = useCallback(async (lotId: string) => {
    if (!lotId) return;
    setError(null);
    try {
      setTraceData(await api(`/api/factory/kit/genealogy?lot_id=${lotId}`));
    } catch (e) {
      setError(e);
    }
  }, []);

  useEffect(() => {
    loadQuality();
  }, [loadQuality]);

  useEffect(() => {
    if (selectedLotId) loadTrace(selectedLotId);
  }, [selectedLotId, loadTrace]);

  const handleCreateRetain = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await api("/api/factory/kit/quality", {
        method: "POST",
        idempotent: true,
        json: {
          kind: "retain_sample",
          org_unit_id: retForm.org_unit_id || options.units[0]?.id,
          lot_id: retForm.lot_id,
          qty: Number(retForm.qty),
          uom: retForm.uom,
          storage_condition: retForm.storage_condition,
        },
      });
      setShowCreateRetain(false);
      await loadQuality();
    } catch (err) {
      setError(err);
    }
  };

  const handleCreateStability = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await api("/api/factory/kit/quality", {
        method: "POST",
        idempotent: true,
        json: {
          kind: "stability_study",
          org_unit_id: stbForm.org_unit_id || options.units[0]?.id,
          lot_id: stbForm.lot_id,
          study_type: stbForm.study_type,
          storage_condition: stbForm.storage_condition,
          protocol_ref: stbForm.protocol_ref,
        },
      });
      setShowCreateStability(false);
      await loadQuality();
    } catch (err) {
      setError(err);
    }
  };

  const handleRecordTimepoint = async (studyId: string, tpId: string) => {
    const entry = tpForm[tpId] ?? { result: "PASS", summary: "Ct đạt chuẩn trong ngưỡng ±0.5 chu kỳ" };
    setError(null);
    try {
      await api("/api/factory/kit/quality", {
        method: "POST",
        json: {
          kind: "stability_timepoint",
          study_id: studyId,
          timepoint_id: tpId,
          result: entry.result,
          summary: entry.summary,
        },
      });
      await loadQuality();
    } catch (err) {
      setError(err);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Button variant={subTab === "genealogy" ? "primary" : "ghost"} onClick={() => setSubTab("genealogy")}>
          Truy xuất phả hệ Lô 2 chiều
        </Button>
        <Button variant={subTab === "coa" ? "primary" : "ghost"} onClick={() => setSubTab("coa")}>
          Chứng nhận COA do QC cấp ({coas.length})
        </Button>
        <Button variant={subTab === "retain" ? "primary" : "ghost"} onClick={() => setSubTab("retain")}>
          Mẫu lưu đối chứng ({retains.length})
        </Button>
        <Button variant={subTab === "stability" ? "primary" : "ghost"} onClick={() => setSubTab("stability")}>
          Độ ổn định — Stability ({studies.length})
        </Button>
      </div>

      <ErrorNote error={error} />

      {subTab === "genealogy" && (
        <div className="space-y-4">
          <Card title="Chọn Lô thành phẩm Kit hoặc Lô nguyên vật liệu / Oligo để truy xuất 2 chiều">
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex-1 min-w-[280px]">
                <Field label="Lô cần tra cứu phả hệ (Thành phẩm Kit ↔ Bán thành phẩm / Oligo / Hóa chất)">
                  <select
                    className={inputClass}
                    value={selectedLotId}
                    onChange={(e) => setSelectedLotId(e.target.value)}
                  >
                    <option value="">-- Chọn mã lô --</option>
                    {options.lots.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.code} — {l.item_code} ({l.item_name}) [{l.status}]
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <Button onClick={() => loadTrace(selectedLotId)}>Truy xuất ngay</Button>
              {selectedLotId && (
                <Button
                  variant="danger"
                  onClick={async () => {
                    try {
                      await api("/api/factory/analytics", {
                        method: "POST",
                        body: JSON.stringify({
                          op: "cascade_quarantine",
                          lot_id: selectedLotId,
                          reason: "Phong tỏa liên hoàn (Cascade Quarantine) từ màn hình Truy xuất Phả hệ 2 chiều",
                        }),
                      });
                      await loadTrace(selectedLotId);
                    } catch (err) {
                      setError(err);
                    }
                  }}
                >
                  🔒 Phong tỏa Liên hoàn (Cascade Quarantine) &amp; Mở NCR
                </Button>
              )}
            </div>
          </Card>

          {traceData && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Card
                title={`1. Truy ngược (Upstream): Lô nguyên liệu / Bán TP cấu thành nên lô ${traceData.lot.code}`}
              >
                {traceData.upstream_parents.length === 0 ? (
                  <Empty>
                    Không có lô nguyên liệu đầu vào nào được ghi nhận cho lô này (hoặc đây là lô nguyên liệu gốc).
                  </Empty>
                ) : (
                  <Table head={["Lô thành phần", "Mã VT / Bán TP", "SL sử dụng", "Lệnh SX / Rework", "HSD lô gốc"]}>
                    {traceData.upstream_parents.map((p: any) => (
                      <tr key={p.id}>
                        <td className="px-3 py-2 font-mono text-xs font-semibold">
                          <button
                            type="button"
                            className="text-amber-800 underline"
                            onClick={() => setSelectedLotId(p.parent_lot_id)}
                          >
                            {p.parent_lot_code}
                          </button>
                        </td>
                        <td className="px-3 py-2 text-xs">
                          {p.parent_item_code} — {p.parent_item_name}
                        </td>
                        <td className="px-3 py-2 text-xs">
                          {fmtQty(p.qty_used)} {p.uom}
                        </td>
                        <td className="px-3 py-2 font-mono text-xs">{p.rework_code ?? p.order_code ?? "-"}</td>
                        <td className="px-3 py-2 text-xs">{fmtDate(p.parent_expiry_date)}</td>
                      </tr>
                    ))}
                  </Table>
                )}
              </Card>

              <Card
                title={`2. Truy xuôi (Downstream): Các lô thành phẩm Kit đã sử dụng lô ${traceData.lot.code}`}
              >
                {traceData.downstream_children.length === 0 ? (
                  <Empty>Lô này chưa được cấp phát vào lô thành phẩm Kit nào.</Empty>
                ) : (
                  <Table head={["Lô Kit đầu ra", "Sản phẩm Kit", "SL tiêu hao", "Lệnh SX / Rework", "Trạng thái lô"]}>
                    {traceData.downstream_children.map((c: any) => (
                      <tr key={c.id}>
                        <td className="px-3 py-2 font-mono text-xs font-semibold">
                          <button
                            type="button"
                            className="text-amber-800 underline"
                            onClick={() => setSelectedLotId(c.child_lot_id)}
                          >
                            {c.child_lot_code}
                          </button>
                        </td>
                        <td className="px-3 py-2 text-xs">
                          {c.child_item_code} — {c.child_item_name}
                        </td>
                        <td className="px-3 py-2 text-xs">
                          {fmtQty(c.qty_used)} {c.uom}
                        </td>
                        <td className="px-3 py-2 font-mono text-xs">{c.rework_code ?? c.order_code ?? "-"}</td>
                        <td className="px-3 py-2">
                          <StatusBadge status={c.child_lot_status} />
                        </td>
                      </tr>
                    ))}
                  </Table>
                )}
              </Card>
            </div>
          )}
        </div>
      )}

      {subTab === "coa" && (
        <div className="space-y-4">
          <Card title="Chứng nhận phân tích xuất xưởng (COA — Do Phòng QA/QC cấp phát tại Tab QC & ánh xạ tự động sang Sản xuất Kit)">
            {coas.length === 0 ? (
              <Empty>
                Chưa có COA nào được Phòng QA/QC cấp phát. Khi Phòng QA/QC duyệt Đạt phiếu kiểm nghiệm tại Tab Quản lý Chất lượng (QA/QC), COA sẽ tự động được cấp và ánh xạ sang đây.
              </Empty>
            ) : (
              <Table
                head={["Số COA (Do QC cấp)", "Phiếu QC gốc", "Mã Lô Kit", "Sản phẩm", "NSX → HSD", "Quy cách / pH", "SL Đạt", "QA/QC Ký Cấp & Bản in"]}
              >
                {coas.map((c) => (
                  <tr key={c.id}>
                    <td className="px-3 py-2 font-mono text-xs font-bold text-emerald-700 dark:text-emerald-400">{c.code}</td>
                    <td className="px-3 py-2 font-mono text-xs">
                      <div className="font-semibold text-sky-700 dark:text-sky-400">{c.qc_test_code || "QC-AUTO"}</div>
                      {c.spec_code && <div className="text-[11px] text-stone-500">{c.spec_code}</div>}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs font-semibold">{c.lot_code}</td>
                    <td className="px-3 py-2 text-xs">
                      <div className="font-medium text-stone-800 dark:text-slate-200">
                        {c.product_code} — {c.product_name}
                      </div>
                      <div className="text-stone-500">{c.qc_summary}</div>
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {fmtDate(c.mfg_date)} → {fmtDate(c.expiry_date)}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      <div>{c.tests_per_kit} test/Kit</div>
                      {c.actual_ph && <div className="font-mono text-emerald-700">pH: {c.actual_ph}</div>}
                    </td>
                    <td className="px-3 py-2 text-xs font-semibold">
                      {fmtQty(c.good_qty)} {c.uom}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {c.analyst_name && <div className="text-stone-500">KN: {c.analyst_name}</div>}
                      <div className="font-semibold text-emerald-700 dark:text-emerald-400">Duyệt: {c.issued_by_name}</div>
                      <div className="text-stone-500 mb-1">{fmtDateTime(c.issued_at)}</div>
                      <div className="flex flex-wrap gap-1 mt-1">
                        <Button variant="ghost" onClick={() => setSelectedCoa(c)}>
                          📄 Xem &amp; Xuất COA (VI / EN)
                        </Button>
                        <Button variant="ghost" onClick={() => printKitCoaCertificate(c, qcFormsConfig, "VI")}>
                          🇻🇳 Việt
                        </Button>
                        <Button variant="ghost" onClick={() => printKitCoaCertificate(c, qcFormsConfig, "EN")}>
                          🇬🇧 EN
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>

          {selectedCoa && (
            <Card
              title={`Chứng nhận Phân tích Xuất xưởng — ${selectedCoa.code} (BM-QC-COA-01 · Ánh xạ từ Phòng QA/QC)`}
              actions={
                <Button variant="ghost" onClick={() => setSelectedCoa(null)}>
                  Đóng
                </Button>
              }
            >
              <QcDocumentPreview kind="COA" data={selectedCoa} formsConfig={qcFormsConfig} />
            </Card>
          )}
        </div>
      )}

      {subTab === "retain" && (
        <Card
          title="Danh sách Mẫu lưu đối chứng (Lưu tối thiểu HSD + 12 tháng)"
          actions={
            <Button onClick={() => setShowCreateRetain((v) => !v)}>
              {showCreateRetain ? "Đóng form đăng ký" : "+ Đăng ký Mẫu lưu đối chứng"}
            </Button>
          }
        >
          {showCreateRetain && (
            <form onSubmit={handleCreateRetain} className="mb-4 p-3.5 rounded-xl border border-stone-200 dark:border-slate-800 bg-stone-50/70 dark:bg-slate-950/60 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-stone-800 dark:text-slate-200">Đăng ký Mẫu lưu đối chứng mới</span>
                <Button type="button" variant="ghost" onClick={() => setShowCreateRetain(false)}>
                  Hủy
                </Button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-5 gap-2 items-end">
                <Field label="Phòng quản lý">
                  <select
                    className={inputClass}
                    value={retForm.org_unit_id}
                    onChange={(e) => setRetForm({ ...retForm, org_unit_id: e.target.value })}
                    required
                  >
                    {options.units.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.code} — {u.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <div className="md:col-span-2">
                  <Field label="Lô thành phẩm Kit">
                    <select
                      className={inputClass}
                      value={retForm.lot_id}
                      onChange={(e) => {
                        const lotId = e.target.value;
                        const lot = options.lots.find((l) => l.id === lotId);
                        const item = lot ? options.items.find((i) => i.code === lot.item_code) : undefined;
                        setRetForm({
                          ...retForm,
                          lot_id: lotId,
                          uom: item?.base_uom || retForm.uom || "KIT",
                        });
                      }}
                      required
                    >
                      <option value="">-- Chọn lô Kit --</option>
                      {options.lots.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.code} — {l.item_code} (HSD: {fmtDate(l.expiry_date)})
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
                <Field label="SL lưu & ĐVT">
                  <div className="flex gap-1">
                    <input
                      type="number"
                      step="any"
                      className={inputClass}
                      value={retForm.qty}
                      onChange={(e) => setRetForm({ ...retForm, qty: e.target.value })}
                      required
                    />
                    <input
                      className={`${inputClass} w-20`}
                      value={retForm.uom}
                      onChange={(e) => setRetForm({ ...retForm, uom: e.target.value })}
                      required
                    />
                  </div>
                </Field>
                <Field label="Nhiệt độ lưu & Lưu">
                  <div className="flex gap-1">
                    <input
                      className={inputClass}
                      value={retForm.storage_condition}
                      onChange={(e) => setRetForm({ ...retForm, storage_condition: e.target.value })}
                      required
                    />
                    <Button type="submit">Lưu mẫu</Button>
                  </div>
                </Field>
              </div>
            </form>
          )}
          {retains.length === 0 ? (
            <Empty>Chưa có mẫu lưu đối chứng nào.</Empty>
          ) : (
            <Table
              head={["Mã mẫu", "Lô Kit & Sản phẩm", "SL lưu", "Bảo quản", "Hạn lưu tối thiểu", "Trạng thái", "Thao tác"]}
            >
              {retains.map((r) => (
                <tr key={r.id}>
                  <td className="px-3 py-2 font-mono text-xs font-semibold">{r.code}</td>
                  <td className="px-3 py-2 text-xs">
                    <div className="font-mono font-semibold">{r.lot_code}</div>
                    <div className="text-stone-500">
                      {r.product_code} — {r.product_name}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {fmtQty(r.qty)} {r.uom}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{r.storage_condition}</td>
                  <td className="px-3 py-2 text-xs">{fmtDate(r.retain_until)}</td>
                  <td className="px-3 py-2">
                    <StatusBadge status={r.status} />
                  </td>
                  <td className="px-3 py-2">
                    <ActionBar
                      endpoint={`/api/factory/kit/quality/${r.id}/actions`}
                      version={r.version}
                      actions={r.allowed_actions}
                      labels={ACTION_LABELS}
                      extraPayload={{ entity: "retain_sample" }}
                      onDone={loadQuality}
                    />
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}

      {subTab === "stability" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="text-xs text-stone-600 dark:text-slate-400">
              Theo dõi độ ổn định thời gian thực (Real-time), lão hóa cấp tốc (Accelerated) và sau mở nắp (In-use) qua các mốc T0, 3M, 6M, 9M, 12M.
            </div>
            <Button onClick={() => setShowCreateStability((v) => !v)}>
              {showCreateStability ? "Đóng form tạo đề cương" : "+ Tạo Đề cương Độ ổn định"}
            </Button>
          </div>

          {showCreateStability && (
            <Card title="Tạo Đề cương theo dõi độ ổn định (Stability)">
              <form onSubmit={handleCreateStability} className="grid grid-cols-1 md:grid-cols-6 gap-2 items-end">
                <Field label="Phòng quản lý">
                  <select
                    className={inputClass}
                    value={stbForm.org_unit_id}
                    onChange={(e) => setStbForm({ ...stbForm, org_unit_id: e.target.value })}
                    required
                  >
                    {options.units.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.code} — {u.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <div className="md:col-span-2">
                  <Field label="Lô thành phẩm Kit">
                    <select
                      className={inputClass}
                      value={stbForm.lot_id}
                      onChange={(e) => setStbForm({ ...stbForm, lot_id: e.target.value })}
                      required
                    >
                      <option value="">-- Chọn lô Kit --</option>
                      {options.lots.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.code} — {l.item_code}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
                <Field label="Loại nghiên cứu">
                  <select
                    className={inputClass}
                    value={stbForm.study_type}
                    onChange={(e) => setStbForm({ ...stbForm, study_type: e.target.value })}
                  >
                    <option value="REAL_TIME">Thời gian thực (Real-time)</option>
                    <option value="ACCELERATED">Lão hóa cấp tốc (Accelerated)</option>
                    <option value="IN_USE">Độ ổn định sau mở nắp (In-use)</option>
                  </select>
                </Field>
                <Field label="Điều kiện & Mã đề cương">
                  <div className="flex gap-1">
                    <input
                      className={inputClass}
                      value={stbForm.storage_condition}
                      onChange={(e) => setStbForm({ ...stbForm, storage_condition: e.target.value })}
                      required
                    />
                    <input
                      className={inputClass}
                      value={stbForm.protocol_ref}
                      onChange={(e) => setStbForm({ ...stbForm, protocol_ref: e.target.value })}
                      required
                    />
                  </div>
                </Field>
                <Button type="submit">Khởi tạo Đề cương</Button>
              </form>
            </Card>
          )}

          {studies.length === 0 ? (
            <Card title="Đề cương độ ổn định">
              <Empty>Chưa có đề cương độ ổn định nào. Nhấn &ldquo;+ Tạo Đề cương Độ ổn định&rdquo; ở góc phải trên để khởi tạo.</Empty>
            </Card>
          ) : (
            studies.map((st) => (
              <Card
                key={st.id}
                title={`${st.code} — Lô ${st.lot_code} (${st.product_code}) · ${st.study_type} (${st.storage_condition})`}
                actions={<StatusBadge status={st.status} />}
              >
                <Table head={["Mốc kiểm tra", "Ngày đến hạn", "Kết quả", "Tóm tắt số liệu Ct / Độ nhạy", "Cập nhật"]}>
                  {(st.timepoints || []).map((tp: any) => {
                    const entry = tpForm[tp.id] ?? {
                      result: tp.result === "PENDING" ? "PASS" : tp.result,
                      summary: tp.summary ?? "Đạt độ nhạy LOD & ΔCt < 0.5",
                    };
                    return (
                      <tr key={tp.id}>
                        <td className="px-3 py-2 font-mono text-xs font-semibold">{tp.label}</td>
                        <td className="px-3 py-2 text-xs">{fmtDate(tp.due_date)}</td>
                        <td className="px-3 py-2">
                          <StatusBadge status={tp.result} />
                        </td>
                        <td className="px-3 py-2 text-xs">
                          <input
                            className={inputClass}
                            value={entry.summary}
                            onChange={(e) =>
                              setTpForm((prev) => ({
                                ...prev,
                                [tp.id]: { ...entry, summary: e.target.value },
                              }))
                            }
                          />
                        </td>
                        <td className="px-3 py-2 text-xs">
                          <div className="flex items-center gap-1">
                            <select
                              className={`${inputClass} w-24`}
                              value={entry.result}
                              onChange={(e) =>
                                setTpForm((prev) => ({
                                  ...prev,
                                  [tp.id]: { ...entry, result: e.target.value },
                                }))
                              }
                            >
                              <option value="PASS">PASS</option>
                              <option value="FAIL">FAIL</option>
                            </select>
                            <Button variant="ghost" onClick={() => handleRecordTimepoint(st.id, tp.id)}>
                              Lưu mốc
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </Table>
                <div className="mt-3">
                  <ActionBar
                    endpoint={`/api/factory/kit/quality/${st.id}/actions`}
                    version={st.version}
                    actions={st.allowed_actions}
                    labels={ACTION_LABELS}
                    extraPayload={{ entity: "stability_study" }}
                    onDone={loadQuality}
                  />
                </div>
              </Card>
            ))
          )}
        </div>
      )}
    </div>
  );
}

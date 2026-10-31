"use client";

import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, fmtDate, fmtQty } from "../api";
import { Button, Card, Empty, ErrorNote, Field, inputClass, StatusBadge, Table } from "../ui";

const METHOD_CATEGORY_LABEL: Record<string, string> = {
  QPCR_ASSAY: "Sinh học phân tử — Real-time qPCR / PCR",
  HPLC_CHROMATOGRAPHY: "Sắc ký lỏng hiệu năng cao (RP-HPLC / IEX)",
  PAGE_ELECTROPHORESIS: "Điện di Gel (PAGE / Agarose)",
  UV_VIS_OD: "Quang phổ UV-Vis / Đo mật độ quang OD260/280",
  ELECTRICAL_SAFETY: "An toàn điện & Hiệu năng Thiết bị (IEC 61010)",
  MECHANICAL_DIMENSIONAL: "Đo kiểm Cơ khí chính xác & Ngoại quan",
  PHYSICOCHEMICAL: "Hóa lý cơ bản (Đo pH, Độ dẫn điện, Độ nhớt)",
};

export function QcMethodsRetentionView() {
  const qc = useQueryClient();
  const [subView, setSubView] = useState<"methods" | "retention">("methods");
  const [addingMethod, setAddingMethod] = useState(false);
  const [addingRetention, setAddingRetention] = useState(false);
  const [selectedMethod, setSelectedMethod] = useState<any | null>(null);
  const [stabilityNotice, setStabilityNotice] = useState<string | null>(null);

  // Method form state
  const [mCode, setMCode] = useState("");
  const [mName, setMName] = useState("");
  const [mCat, setMCat] = useState("QPCR_ASSAY");
  const [mInst, setMInst] = useState("Hệ thống Real-time PCR 96 giếng (Bio-Rad CFX96 / ABT Q96)");
  const [mPrinciple, setMPrinciple] = useState("");
  const [mSuitability, setMSuitability] = useState("Chứng dương Ct trong khoảng 25.0–27.0; Chứng âm NTC không lên tín hiệu; R² ≥ 0.990");
  const [mRepeatCv, setMRepeatCv] = useState("≤ 1.8%");
  const [mReprodCv, setMReprodCv] = useState("≤ 2.5%");
  const [mLod, setMLod] = useState("10 copies/phản ứng");
  const [mStepsText, setMStepsText] = useState(
    "Bước 1: Rã đông bộ mẫu chuẩn và thuốc thử trên block lạnh 2-8°C\nBước 2: Pha MasterMix và chia 20 µL vào từng giếng quang học\nBước 3: Nạp 5 µL mẫu chuẩn Dương, Chứng âm và Mẫu thử (lặp lại 3 giếng)\nBước 4: Chạy chu trình nhiệt qPCR 40 chu kỳ và phân tích ngưỡng Ct"
  );

  // Retention form state
  const [retItemId, setRetItemId] = useState("");
  const [retCategory, setRetCategory] = useState("FINISHED_KIT");
  const [retQty, setRetQty] = useState("3");
  const [retUom, setRetUom] = useState("kit");
  const [retTemp, setRetTemp] = useState("-20°C");
  const [retLoc, setRetLoc] = useState("KHO-QA · Tủ Mẫu Lưu R1 (Khay M2)");
  const [retNotes, setRetNotes] = useState("");

  const qaOps = useQuery({
    queryKey: ["factory", "qa-ops"],
    queryFn: () => api<any>("/api/factory/qms/ops"),
  });
  const itemsQuery = useQuery({
    queryKey: ["factory", "qa", "master-items"],
    queryFn: () => api<{ rows: { id: string; code: string; name: string; base_uom: string; item_type: string }[] }>("/api/factory/master/items?page_size=200"),
  });

  const saveMethodMut = useMutation({
    mutationFn: () => {
      const steps = mStepsText
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((line, i) => ({
          step_no: i + 1,
          title: `Bước ${i + 1}`,
          detail: line.replace(/^Bước\s*\d+\s*:\s*/i, ""),
        }));
      return api("/api/factory/qms/ops", {
        method: "POST",
        json: {
          op: "save_qc_method",
          code: mCode || undefined,
          name: mName,
          category: mCat,
          instrument_type: mInst,
          principle: mPrinciple,
          sop_steps: steps,
          suitability_criteria: mSuitability,
          validation_summary: {
            repeatability_cv_pct: mRepeatCv,
            reproducibility_cv_pct: mReprodCv,
            lod_value: mLod,
            specificity_pct: "100%",
            linearity_r2: "0.998",
            validated_date: new Date().toISOString().slice(0, 10),
          },
          status: "EFFECTIVE",
        },
      });
    },
    onSuccess: () => {
      setAddingMethod(false);
      setMCode("");
      setMName("");
      setMPrinciple("");
      qc.invalidateQueries({ queryKey: ["factory", "qa-ops"] });
    },
  });

  const saveRetentionMut = useMutation({
    mutationFn: () =>
      api("/api/factory/qms/ops", {
        method: "POST",
        json: {
          op: "save_retention_sample",
          item_id: retItemId,
          sample_category: retCategory,
          qty_retained: Number(retQty),
          uom: retUom,
          storage_temp: retTemp,
          storage_location: retLoc,
          notes: retNotes || null,
        },
      }),
    onSuccess: () => {
      setAddingRetention(false);
      setRetNotes("");
      qc.invalidateQueries({ queryKey: ["factory", "qa-ops"] });
    },
  });

  const triggerStabilityMut = useMutation({
    mutationFn: (payload: { retention_id: string; timepoint_month: number }) =>
      api<{ test_code: string; retention_code: string }>("/api/factory/qms/ops", {
        method: "POST",
        json: { op: "trigger_stability_test", ...payload },
      }),
    onSuccess: (res) => {
      setStabilityNotice(`🧪 Đã khởi tạo Phiếu QC Độ ổn định ${res.test_code} từ Mẫu lưu ${res.retention_code}! Vui lòng mở tab '1. Tiếp nhận & Phiếu QC' để nhập kết quả.`);
      qc.invalidateQueries({ queryKey: ["factory", "qa-ops"] });
      qc.invalidateQueries({ queryKey: ["factory", "qc-tests"] });
    },
  });

  const methods: any[] = qaOps.data?.methods ?? [];
  const retentions: any[] = qaOps.data?.retention_samples ?? [];
  const allItems = itemsQuery.data?.rows ?? [];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <Button variant={subView === "methods" ? "primary" : "ghost"} onClick={() => setSubView("methods")}>
          🔬 1. Thư viện Phương pháp Kiểm nghiệm & Hồ sơ Thẩm định ({methods.length})
        </Button>
        <Button variant={subView === "retention" ? "primary" : "ghost"} onClick={() => setSubView("retention")}>
          ❄️ 2. Sổ Quản lý Mẫu lưu QC & Chương trình Độ ổn định ({retentions.length})
        </Button>
      </div>

      {subView === "methods" && (
        <>
          {selectedMethod && (
            <Card
              title={`Phương pháp ${selectedMethod.code} (v${selectedMethod.version_no}) — ${selectedMethod.name}`}
              actions={<Button variant="ghost" onClick={() => setSelectedMethod(null)}>Đóng</Button>}
            >
              <div className="flex flex-col gap-3 text-xs">
                <div className="grid gap-2 sm:grid-cols-3 p-3 rounded-xl bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800">
                  <div><b>Nhóm kỹ thuật:</b> {METHOD_CATEGORY_LABEL[selectedMethod.category] ?? selectedMethod.category}</div>
                  <div><b>Hệ thống thiết bị:</b> {selectedMethod.instrument_type || "—"}</div>
                  <div><b>Tiêu chí hợp lệ mẻ chạy (System Suitability):</b> {selectedMethod.suitability_criteria || "—"}</div>
                </div>
                {selectedMethod.principle && (
                  <div>
                    <b>Nguyên lý phương pháp:</b> {selectedMethod.principle}
                  </div>
                )}
                <div>
                  <b className="block mb-1">Các bước thao tác chuẩn (SOP Kiểm nghiệm):</b>
                  <ol className="list-decimal list-inside space-y-1 pl-1">
                    {(Array.isArray(selectedMethod.sop_steps) ? selectedMethod.sop_steps : []).map((st: any, idx: number) => (
                      <li key={idx}>
                        <b>{st.title}:</b> {st.detail}
                      </li>
                    ))}
                  </ol>
                </div>
                {selectedMethod.validation_summary && (
                  <div className="p-3 rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/40 dark:bg-emerald-950/20">
                    <div className="font-bold text-emerald-800 dark:text-emerald-300 mb-1">
                      ✓ Tóm tắt Hồ sơ Thẩm định Phương pháp (Method Validation Summary — ISO 13485 / GLP)
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                      <div>Độ lặp lại (%CV): <b>{selectedMethod.validation_summary.repeatability_cv_pct || "—"}</b></div>
                      <div>Độ tái lập (%CV): <b>{selectedMethod.validation_summary.reproducibility_cv_pct || "—"}</b></div>
                      <div>Giới hạn phát hiện (LoD): <b>{selectedMethod.validation_summary.lod_value || "—"}</b></div>
                      <div>Độ đặc hiệu: <b>{selectedMethod.validation_summary.specificity_pct || "100%"}</b></div>
                      <div>Tuyến tính ($R^2$): <b>{selectedMethod.validation_summary.linearity_r2 || "—"}</b></div>
                    </div>
                  </div>
                )}
              </div>
            </Card>
          )}

          <Card
            title="🔬 Thư viện Phương pháp Kiểm nghiệm & Thẩm định Phương pháp (QC Analytical Methods)"
            actions={<Button onClick={() => setAddingMethod(!addingMethod)}>+ Xây dựng Phương pháp Kiểm nghiệm mới</Button>}
          >
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
              Chuẩn hóa quy trình phân tích chất lượng (SOP Kiểm nghiệm), thiết bị đo, tiêu chí hợp lệ của mẻ chạy (System Suitability) và thông số thẩm định phương pháp trước khi gắn vào các Tiêu chuẩn QC.
            </p>
            <ErrorNote error={qaOps.error ?? saveMethodMut.error} />

            {addingMethod && (
              <form
                className="grid gap-3 sm:grid-cols-3 p-3 mb-3 rounded-xl border border-sky-200 dark:border-sky-900 bg-sky-50/40 dark:bg-sky-950/20 text-xs"
                onSubmit={(e) => {
                  e.preventDefault();
                  saveMethodMut.mutate();
                }}
              >
                <Field label="Mã Phương pháp (tự sinh nếu để trống)">
                  <input className={`${inputClass} font-mono`} value={mCode} onChange={(e) => setMCode(e.target.value)} placeholder="VD: MTH-PCR-005" />
                </Field>
                <div className="sm:col-span-2">
                  <Field label="Tên Phương pháp Kiểm nghiệm *">
                    <input
                      className={inputClass}
                      value={mName}
                      onChange={(e) => setMName(e.target.value)}
                      placeholder="VD: Phương pháp định lượng & kiểm tra LoD Kit Real-time PCR trên hệ thống 96 giếng"
                      required
                    />
                  </Field>
                </div>
                <Field label="Nhóm Kỹ thuật Phân tích *">
                  <select className={inputClass} value={mCat} onChange={(e) => setMCat(e.target.value)}>
                    {Object.entries(METHOD_CATEGORY_LABEL).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </select>
                </Field>
                <div className="sm:col-span-2">
                  <Field label="Thiết bị & Dụng cụ chuẩn sử dụng">
                    <input className={inputClass} value={mInst} onChange={(e) => setMInst(e.target.value)} />
                  </Field>
                </div>
                <div className="sm:col-span-3">
                  <Field label="Tiêu chí Hợp lệ của Mẻ chạy (System Suitability Criteria) *">
                    <input className={inputClass} value={mSuitability} onChange={(e) => setMSuitability(e.target.value)} required />
                  </Field>
                </div>
                <Field label="Độ lặp lại thẩm định (%CV)">
                  <input className={inputClass} value={mRepeatCv} onChange={(e) => setMRepeatCv(e.target.value)} />
                </Field>
                <Field label="Độ tái lập liên KNV (%CV)">
                  <input className={inputClass} value={mReprodCv} onChange={(e) => setMReprodCv(e.target.value)} />
                </Field>
                <Field label="Giới hạn phát hiện / Độ nhạy (LoD)">
                  <input className={inputClass} value={mLod} onChange={(e) => setMLod(e.target.value)} />
                </Field>
                <div className="sm:col-span-3">
                  <Field label="Các bước tiến hành SOP Kiểm nghiệm (Mỗi dòng 1 bước) *">
                    <textarea className={`${inputClass} h-24`} value={mStepsText} onChange={(e) => setMStepsText(e.target.value)} required />
                  </Field>
                </div>
                <div className="sm:col-span-3 flex justify-end gap-2">
                  <Button type="button" variant="ghost" onClick={() => setAddingMethod(false)}>Hủy</Button>
                  <Button type="submit" disabled={saveMethodMut.isPending}>Phê duyệt & Ban hành Phương pháp QC</Button>
                </div>
              </form>
            )}

            {methods.length === 0 ? (
              <Empty>Chưa có phương pháp kiểm nghiệm nào.</Empty>
            ) : (
              <Table head={["Mã PP", "Tên Phương pháp Kiểm nghiệm", "Nhóm kỹ thuật", "Thiết bị chính", "Thông số Thẩm định (CV% / LoD)", "Trạng thái", "Chi tiết SOP"]}>
                {methods.map((m) => (
                  <tr key={m.id} className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50" onClick={() => setSelectedMethod(m)}>
                    <td className="py-2 pr-3 font-mono font-bold text-sky-700 dark:text-sky-400">{m.code}</td>
                    <td className="py-2 pr-3 font-semibold">{m.name}</td>
                    <td className="py-2 pr-3 text-xs">{METHOD_CATEGORY_LABEL[m.category] ?? m.category}</td>
                    <td className="py-2 pr-3 text-xs">{m.instrument_type || "—"}</td>
                    <td className="py-2 pr-3 font-mono text-xs">
                      CV: {m.validation_summary?.repeatability_cv_pct || "≤2%"} · LoD: {m.validation_summary?.lod_value || "Đạt"}
                    </td>
                    <td className="py-2 pr-3">
                      <StatusBadge status="RELEASED" label="Đã thẩm định (EFFECTIVE)" />
                    </td>
                    <td className="py-2 pr-3">
                      <Button variant="ghost" onClick={() => setSelectedMethod(m)}>Xem SOP</Button>
                    </td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>
        </>
      )}

      {subView === "retention" && (
        <Card
          title="❄️ Sổ Quản lý Mẫu lưu QC (Retention Samples) & Chương trình Độ ổn định (Stability Study)"
          actions={
            <Button
              onClick={() => {
                setAddingRetention(!addingRetention);
                if (!retItemId && allItems[0]) setRetItemId(allItems[0].id);
              }}
            >
              + Nhập Mẫu lưu QC mới
            </Button>
          }
        >
          <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
            Lưu trữ mẫu đối chứng của từng lô nguyên vật liệu chính và từng lô thành phẩm xuất xưởng tại Tủ mẫu lưu QA/QC, phục vụ truy vết khiếu nại và lấy mẫu kiểm tra độ ổn định định kỳ (0, 3, 6, 9, 12, 24 tháng).
          </p>
          <ErrorNote error={saveRetentionMut.error ?? triggerStabilityMut.error} />

          {stabilityNotice && (
            <div className="p-2.5 mb-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 text-xs font-semibold">
              {stabilityNotice}
            </div>
          )}

          {addingRetention && (
            <form
              className="grid gap-3 sm:grid-cols-3 p-3 mb-3 rounded-xl border border-sky-200 dark:border-sky-900 bg-sky-50/40 dark:bg-sky-950/20 text-xs"
              onSubmit={(e) => {
                e.preventDefault();
                saveRetentionMut.mutate();
              }}
            >
              <div className="sm:col-span-2">
                <Field label="Vật tư / Bán thành phẩm / Thành phẩm lưu mẫu *">
                  <select className={inputClass} value={retItemId} onChange={(e) => setRetItemId(e.target.value)} required>
                    <option value="">-- Chọn mã hàng --</option>
                    {allItems.map((it) => (
                      <option key={it.id} value={it.id}>
                        {it.code} — {it.name} ({it.base_uom})
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <Field label="Phân loại mẫu lưu">
                <select className={inputClass} value={retCategory} onChange={(e) => setRetCategory(e.target.value)}>
                  <option value="FINISHED_KIT">Thành phẩm Kit IVD</option>
                  <option value="SEMI_FINISHED">Bán thành phẩm Pha chế</option>
                  <option value="RAW_MATERIAL">Nguyên vật liệu / Enzyme gốc</option>
                  <option value="OLIGO">Oligo / Probe chuẩn</option>
                </select>
              </Field>
              <Field label="Số lượng lưu *">
                <input type="number" step="any" min="0.1" className={inputClass} value={retQty} onChange={(e) => setRetQty(e.target.value)} required />
              </Field>
              <Field label="Đơn vị tính">
                <input className={inputClass} value={retUom} onChange={(e) => setRetUom(e.target.value)} />
              </Field>
              <Field label="Nhiệt độ & Vị trí bảo quản">
                <input className={inputClass} value={retLoc} onChange={(e) => setRetLoc(e.target.value)} />
              </Field>
              <div className="sm:col-span-3">
                <Field label="Ghi chú lịch kiểm tra độ ổn định">
                  <input className={inputClass} value={retNotes} onChange={(e) => setRetNotes(e.target.value)} placeholder="VD: Kiểm tra hoạt tính qPCR ở các mốc 3, 6, 12, 18, 24 tháng" />
                </Field>
              </div>
              <div className="sm:col-span-3 flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setAddingRetention(false)}>Hủy</Button>
                <Button type="submit" disabled={saveRetentionMut.isPending}>Lưu vào Tủ Mẫu Lưu QA/QC</Button>
              </div>
            </form>
          )}

          {retentions.length === 0 ? (
            <Empty>Chưa có mẫu lưu QC nào.</Empty>
          ) : (
            <Table head={["Mã Mẫu lưu", "Số Lô (Lot)", "Sản phẩm / Vật tư", "Lượng lưu", "Điều kiện · Vị trí", "Ngày lưu · Lưu đến", "Mốc Độ ổn định", "Trạng thái", "Kiểm định Độ ổn định"]}>
              {retentions.map((r) => (
                <tr key={r.id}>
                  <td className="py-2 pr-3 font-mono font-bold text-sky-700 dark:text-sky-400">{r.code}</td>
                  <td className="py-2 pr-3 font-mono">{r.lot_code || "—"}</td>
                  <td className="py-2 pr-3">
                    <div className="font-semibold">{r.item_code} — {r.item_name}</div>
                    {r.notes && <div className="text-[11px] text-slate-500">{r.notes}</div>}
                  </td>
                  <td className="py-2 pr-3 font-mono font-semibold">
                    {fmtQty(r.qty_retained)} {r.uom}
                  </td>
                  <td className="py-2 pr-3 text-xs">
                    <b>{r.storage_temp}</b> · {r.storage_location}
                  </td>
                  <td className="py-2 pr-3 text-xs whitespace-nowrap">
                    <div>Lưu: {fmtDate(r.retained_date)}</div>
                    <div className="text-slate-400">Đến: {fmtDate(r.retain_until_date)}</div>
                  </td>
                  <td className="py-2 pr-3 font-mono text-xs">
                    {(r.stability_months ?? [0, 3, 6, 9, 12, 24]).join(", ")} tháng
                  </td>
                  <td className="py-2 pr-3">
                    <StatusBadge
                      status={r.status === "STORED" ? "RELEASED" : "PENDING_QC"}
                      label={r.status === "STORED" ? "Đang lưu trữ" : "Đang kiểm Stability"}
                    />
                  </td>
                  <td className="py-2 pr-3">
                    <div className="flex gap-1">
                      {[3, 6, 12].map((m) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => triggerStabilityMut.mutate({ retention_id: r.id, timepoint_month: m })}
                          disabled={triggerStabilityMut.isPending}
                          className="px-2 py-1 rounded-lg bg-sky-50 dark:bg-sky-950/60 border border-sky-200 dark:border-sky-800 text-sky-700 dark:text-sky-300 text-[11px] font-bold hover:bg-sky-100 cursor-pointer"
                        >
                          🧪 Mốc {m}M
                        </button>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}
    </div>
  );
}

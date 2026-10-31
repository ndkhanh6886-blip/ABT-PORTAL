"use client";

import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, fmtDate } from "../api";
import { Button, Card, Empty, ErrorNote, Field, inputClass, StatusBadge, Table } from "../ui";

const STD_TYPE_LABEL: Record<string, string> = {
  POSITIVE_CONTROL: "Chứng dương chuẩn (Positive Control)",
  NEGATIVE_CONTROL: "Chứng âm chuẩn (Negative Control / NTC)",
  LOD_PANEL: "Bộ Panel Độ nhạy / Giới hạn phát hiện (LoD Panel)",
  SPECIFICITY_PANEL: "Bộ Panel Độ đặc hiệu (Cross-Reactivity Panel)",
  INTERNAL_CONTROL: "Chuẩn nội (Internal Control IC)",
  CALIBRATOR: "Mẫu hiệu chuẩn định lượng (Calibrator)",
  CHEMICAL_STD: "Chất chuẩn sắc ký / Khối phổ (HPLC / MS Standard)",
};

const DOMAIN_LABEL: Record<string, string> = {
  KIT: "Kit Chẩn đoán IVD / PCR",
  OLIGO: "Oligo / Primer / Probe",
  DEVICE: "Thiết bị Y sinh",
  RAW_MATERIAL: "Nguyên vật liệu / Hóa chất",
  ALL: "Dùng chung toàn phòng QC",
};

export function ReferenceStandardsView() {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [typeFilter, setTypeFilter] = useState("");

  // Form state
  const [name, setName] = useState("");
  const [stdType, setStdType] = useState("POSITIVE_CONTROL");
  const [domain, setDomain] = useState("KIT");
  const [lotNo, setLotNo] = useState("");
  const [sourceStrain, setSourceStrain] = useState("");
  const [concentration, setConcentration] = useState("10^4 copies/µL");
  const [targetMetric, setTargetMetric] = useState("Ct Value (FAM)");
  const [targetVal, setTargetVal] = useState("26.0");
  const [lowerLim, setLowerLim] = useState("25.0");
  const [upperLim, setUpperLim] = useState("27.0");
  const [unit, setUnit] = useState("Ct");
  const [storageLoc, setStorageLoc] = useState("KHO-QA · Tủ âm sâu -80°C (Khay S1)");
  const [aliquotsTotal, setAliquotsTotal] = useState("50");
  const [maxFt, setMaxFt] = useState("3");
  const [expiryDate, setExpiryDate] = useState("");
  const [notes, setNotes] = useState("");

  const qaOps = useQuery({
    queryKey: ["factory", "qa-ops"],
    queryFn: () => api<any>("/api/factory/qms/ops"),
  });

  const saveMut = useMutation({
    mutationFn: () =>
      api("/api/factory/qms/ops", {
        method: "POST",
        json: {
          op: "save_reference_standard",
          name,
          standard_type: stdType,
          target_domain: domain,
          lot_no: lotNo,
          source_strain: sourceStrain || null,
          concentration: concentration || null,
          target_metric: targetMetric,
          target_value: targetVal !== "" ? Number(targetVal) : null,
          lower_limit: lowerLim !== "" ? Number(lowerLim) : null,
          upper_limit: upperLim !== "" ? Number(upperLim) : null,
          unit,
          storage_location: storageLoc,
          aliquots_total: Number(aliquotsTotal),
          max_freeze_thaw: Number(maxFt),
          expiry_date: expiryDate || null,
          notes: notes || null,
        },
      }),
    onSuccess: () => {
      setAdding(false);
      setName("");
      setLotNo("");
      setSourceStrain("");
      setNotes("");
      qc.invalidateQueries({ queryKey: ["factory", "qa-ops"] });
    },
  });

  const standards: any[] = qaOps.data?.standards ?? [];
  const usages: any[] = qaOps.data?.standard_usages ?? [];
  const filtered = typeFilter ? standards.filter((s) => s.standard_type === typeFilter) : standards;

  return (
    <div className="flex flex-col gap-3">
      <Card
        title="🧬 Quản lý Bộ Mẫu Chuẩn & Panel Đối Chiếu Kiểm Nghiệm (Reference Standards & Control Panels)"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <select className={`${inputClass} w-64`} value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
              <option value="">Tất cả loại Bộ mẫu chuẩn</option>
              {Object.entries(STD_TYPE_LABEL).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
            <Button onClick={() => setAdding(!adding)}>+ Khai báo Lô Bộ Mẫu Chuẩn mới</Button>
          </div>
        }
      >
        <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
          Quản lý vòng đời các bộ mẫu chuẩn nội bộ & quốc tế (Chứng dương/âm, Panel độ nhạy LoD, Panel đặc hiệu, Chất chuẩn HPLC/MS), kiểm soát số ống phân liều (Aliquot), số chu kỳ rã đông (Freeze-Thaw) và ngưỡng chấp nhận System Suitability cho từng mẻ chạy QC.
        </p>
        <ErrorNote error={qaOps.error ?? saveMut.error} />

        {adding && (
          <form
            className="grid gap-3 sm:grid-cols-4 p-3 mb-3 rounded-xl border border-indigo-200 dark:border-indigo-900 bg-indigo-50/40 dark:bg-indigo-950/20 text-xs"
            onSubmit={(e) => {
              e.preventDefault();
              saveMut.mutate();
            }}
          >
            <div className="sm:col-span-2">
              <Field label="Tên Bộ mẫu chuẩn / Chủng đối chiếu *">
                <input
                  className={inputClass}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="VD: Mẫu chuẩn Dương Plasmid HBV DNA chuẩn hóa WHO (10^4 copies/µL)"
                  required
                />
              </Field>
            </div>
            <Field label="Phân loại Mẫu chuẩn *">
              <select className={inputClass} value={stdType} onChange={(e) => setStdType(e.target.value)}>
                {Object.entries(STD_TYPE_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </Field>
            <Field label="Nhóm sản phẩm áp dụng">
              <select className={inputClass} value={domain} onChange={(e) => setDomain(e.target.value)}>
                {Object.entries(DOMAIN_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </Field>
            <Field label="Số Lô mẫu chuẩn (Lot No) *">
              <input className={`${inputClass} font-mono`} value={lotNo} onChange={(e) => setLotNo(e.target.value)} placeholder="VD: STD-HBV-2601" required />
            </Field>
            <Field label="Chủng gốc / Nguồn chuẩn">
              <input className={inputClass} value={sourceStrain} onChange={(e) => setSourceStrain(e.target.value)} placeholder="VD: ATCC / NIBSC / Plasmid pUC57-HBV" />
            </Field>
            <Field label="Nồng độ chuẩn">
              <input className={inputClass} value={concentration} onChange={(e) => setConcentration(e.target.value)} placeholder="VD: 10^4 copies/µL" />
            </Field>
            <Field label="Chỉ số kiểm soát (Metric) *">
              <input className={inputClass} value={targetMetric} onChange={(e) => setTargetMetric(e.target.value)} placeholder="VD: Ct Value (FAM)" required />
            </Field>
            <Field label="Giá trị Mục tiêu (Target)">
              <input type="number" step="any" className={inputClass} value={targetVal} onChange={(e) => setTargetVal(e.target.value)} />
            </Field>
            <Field label="Giới hạn Dưới (Min)">
              <input type="number" step="any" className={inputClass} value={lowerLim} onChange={(e) => setLowerLim(e.target.value)} />
            </Field>
            <Field label="Giới hạn Trên (Max)">
              <input type="number" step="any" className={inputClass} value={upperLim} onChange={(e) => setUpperLim(e.target.value)} />
            </Field>
            <Field label="Đơn vị (Ct / OD / %)">
              <input className={inputClass} value={unit} onChange={(e) => setUnit(e.target.value)} />
            </Field>
            <Field label="Số ống chia lẻ (Aliquots)">
              <input type="number" min="1" className={inputClass} value={aliquotsTotal} onChange={(e) => setAliquotsTotal(e.target.value)} />
            </Field>
            <Field label="Số lần Rã đông tối đa">
              <input type="number" min="1" className={inputClass} value={maxFt} onChange={(e) => setMaxFt(e.target.value)} />
            </Field>
            <Field label="Vị trí Tủ bảo quản">
              <input className={inputClass} value={storageLoc} onChange={(e) => setStorageLoc(e.target.value)} />
            </Field>
            <Field label="Hạn sử dụng mẫu chuẩn">
              <input type="date" className={inputClass} value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} />
            </Field>
            <div className="sm:col-span-4 flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setAdding(false)}>Hủy</Button>
              <Button type="submit" disabled={saveMut.isPending}>Lưu Bộ Mẫu Chuẩn vào Hệ Thống QC</Button>
            </div>
          </form>
        )}

        {filtered.length === 0 ? (
          <Empty>Chưa có bộ mẫu chuẩn nào.</Empty>
        ) : (
          <Table head={["Mã & Lô Chuẩn", "Tên Bộ Mẫu Chuẩn & Nguồn gốc", "Phân loại", "Nồng độ", "Ngưỡng Hợp Lệ (Target ± Range)", "Tồn ống Aliquot", "Rã đông (Freeze-Thaw)", "Vị trí · Hạn dùng", "Trạng thái"]}>
            {filtered.map((s) => {
              const ftOver = Number(s.current_freeze_thaw) >= Number(s.max_freeze_thaw);
              return (
                <tr key={s.id}>
                  <td className="py-2 pr-3 font-mono">
                    <div className="font-bold text-indigo-700 dark:text-indigo-400">{s.code}</div>
                    <div className="text-[11px] text-slate-500">Lot: {s.lot_no}</div>
                  </td>
                  <td className="py-2 pr-3">
                    <div className="font-semibold">{s.name}</div>
                    {s.source_strain && <div className="text-[11px] text-slate-500">Nguồn: {s.source_strain}</div>}
                  </td>
                  <td className="py-2 pr-3 text-xs">{STD_TYPE_LABEL[s.standard_type] ?? s.standard_type}</td>
                  <td className="py-2 pr-3 font-mono text-xs">{s.concentration || "—"}</td>
                  <td className="py-2 pr-3 font-mono text-xs">
                    <b>{s.target_metric}:</b> {s.target_value != null ? Number(s.target_value) : "—"}{" "}
                    <span className="text-slate-500">
                      [{s.lower_limit != null ? Number(s.lower_limit) : "—"} ÷ {s.upper_limit != null ? Number(s.upper_limit) : "—"}] {s.unit || ""}
                    </span>
                  </td>
                  <td className="py-2 pr-3 font-mono">
                    <b>{s.aliquots_remaining}</b> / {s.aliquots_total} ống
                  </td>
                  <td className="py-2 pr-3 font-mono">
                    <span className={ftOver ? "text-rose-600 font-bold" : ""}>
                      {s.current_freeze_thaw} / {s.max_freeze_thaw} lần
                    </span>
                  </td>
                  <td className="py-2 pr-3 text-xs">
                    <div>{s.storage_location}</div>
                    <div className="text-slate-400">HSD: {fmtDate(s.expiry_date)}</div>
                  </td>
                  <td className="py-2 pr-3">
                    <StatusBadge
                      status={s.status === "ACTIVE" ? "RELEASED" : s.status === "DEPLETED" ? "EXPIRED" : "REJECTED"}
                      label={s.status === "ACTIVE" ? "Đang hiệu lực" : s.status === "DEPLETED" ? "Đã hết ống" : s.status}
                    />
                  </td>
                </tr>
              );
            })}
          </Table>
        )}
      </Card>

      {/* Usage & Control Chart History */}
      <Card title="📈 Nhật ký Sử dụng Mẫu Chuẩn & Theo dõi Độ ổn định Mẻ chạy (Levey-Jennings / Control Log)">
        {usages.length === 0 ? (
          <Empty>Chưa có bản ghi chạy đối chiếu mẫu chuẩn nào.</Empty>
        ) : (
          <Table head={["Thời gian", "Phiếu QC", "Mã Mẫu Chuẩn", "Tên Mẫu Chuẩn", "Khoảng Cho Phép", "Giá trị Đo được", "Kết luận Mẻ chạy", "Người thực hiện"]}>
            {usages.map((u) => (
              <tr key={u.id}>
                <td className="py-2 pr-3 whitespace-nowrap">{fmtDate(u.used_at)}</td>
                <td className="py-2 pr-3 font-mono font-semibold text-sky-700 dark:text-sky-400">{u.test_code || "Chạy chuẩn định kỳ"}</td>
                <td className="py-2 pr-3 font-mono font-semibold">{u.standard_code}</td>
                <td className="py-2 pr-3">{u.standard_name}</td>
                <td className="py-2 pr-3 font-mono">
                  [{u.lower_limit != null ? Number(u.lower_limit) : "—"} ÷ {u.upper_limit != null ? Number(u.upper_limit) : "—"}] {u.unit || ""}
                </td>
                <td className="py-2 pr-3 font-mono font-bold">
                  {u.measured_value != null ? `${Number(u.measured_value)} ${u.unit || ""}` : u.measured_text || "Đạt"}
                </td>
                <td className="py-2 pr-3">
                  <StatusBadge
                    status={u.passed ? "RELEASED" : "REJECTED"}
                    label={u.passed ? "ĐẠT CHUẨN (VALID)" : "LỆCH CHUẨN (OOC)"}
                  />
                </td>
                <td className="py-2 pr-3">{u.user_name || "—"}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}

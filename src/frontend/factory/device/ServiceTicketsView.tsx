"use client";

import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ActionBar, type AllowedAction } from "../actions";
import { api, fmtDate, fmtVnd } from "../api";
import { Button, Card, Empty, ErrorNote, Field, inputClass, StatusBadge, Table } from "../ui";
import { DepartmentEquipmentView } from "../asset/DepartmentEquipmentView";
import { TICKET_STATUS, useDeviceOptions } from "./shared";

const TICKET_ACTION_LABELS: Record<string, string> = {
  diagnose: "Tiếp nhận chẩn đoán (Chuyển máy sang UNDER_SERVICE)",
  await_parts: "Chờ linh kiện thay thế",
  start_repair: "Bắt đầu sửa chữa / bảo trì",
  resolve: "Xác nhận đã khắc phục xong (RESOLVED)",
  close: "Ký nghiệm thu & Đóng phiếu dịch vụ",
  cancel: "Hủy phiếu",
};

const TICKET_TYPE_LABELS: Record<string, string> = {
  WARRANTY: "Bảo hành miễn phí",
  REPAIR: "Sửa chữa dịch vụ",
  PREVENTIVE: "Bảo trì / Hiệu chuẩn định kỳ",
  COMPLAINT: "Khiếu nại chất lượng (ISO 13485 §8.2.2)",
  INSTALLATION: "Lắp đặt & hướng dẫn vận hành",
};

interface ServiceData {
  tickets: {
    id: string;
    code: string;
    unit_id: string;
    serial_no: string;
    customer_name: string | null;
    warranty_end: string | null;
    model_code: string;
    model_name: string;
    ticket_type: string;
    reported_at: string;
    symptom: string;
    diagnosis: string | null;
    resolution: string | null;
    is_warranty: boolean;
    service_cost: number;
    capa_evaluated: boolean;
    capa_required: boolean;
    deviation_id: string | null;
    deviation_code: string | null;
    status: string;
    version: number;
    actions: AllowedAction[];
  }[];
  schedules: {
    id: string;
    unit_id: string;
    serial_no: string;
    customer_name: string | null;
    model_code: string;
    model_name: string;
    interval_months: number;
    last_service_at: string | null;
    next_due: string;
    is_overdue: boolean;
  }[];
}

export function ServiceTicketsView() {
  const qc = useQueryClient();
  const opts = useDeviceOptions();
  const [serviceMode, setServiceMode] = useState<"INTERNAL_LAB" | "CUSTOMER_RMA">("INTERNAL_LAB");
  const svc = useQuery({
    queryKey: ["factory", "device", "service-tickets"],
    queryFn: () => api<ServiceData>("/api/factory/device/service-tickets"),
  });

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const [form, setForm] = useState({
    unit_id: "",
    ticket_type: "WARRANTY",
    symptom: "",
    service_cost: "0",
  });

  const [resolutionText, setResolutionText] = useState("Đã thay thế linh kiện và hiệu chuẩn lại đạt chuẩn xuất xưởng");
  const [diagnosisText, setDiagnosisText] = useState("Hao mòn linh kiện theo chu kỳ vận hành");

  const [capaForm, setCapaForm] = useState({
    capa_required: true,
    root_cause: "Lô linh kiện nguồn cung cấp có sai số nhiệt",
    corrective_action: "Mở CAPA rà soát lô linh kiện cùng đợt nhập",
    notes: "Cần mở hồ sơ sai lệch/CAPA theo ISO 13485 §8.2.2",
  });

  const [partForm, setPartForm] = useState({
    warehouse_id: "",
    item_id: "",
    component_serial: "",
    qty: "1",
  });

  const refreshAll = () => {
    qc.invalidateQueries({ queryKey: ["factory", "device", "service-tickets"] });
    qc.invalidateQueries({ queryKey: ["factory", "device", "options"] });
  };

  const createMut = useMutation({
    mutationFn: () =>
      api("/api/factory/device/service-tickets", {
        method: "POST",
        body: JSON.stringify({
          org_unit_id: opts.data?.units[0]?.id,
          unit_id: form.unit_id,
          ticket_type: form.ticket_type,
          symptom: form.symptom,
          service_cost: Number(form.service_cost),
        }),
      }),
    onSuccess: () => {
      setShowCreate(false);
      refreshAll();
    },
  });

  const actMut = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api(`/api/factory/device/service-tickets/${selectedId}/actions`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: () => refreshAll(),
  });

  const selected = (svc.data?.tickets ?? []).find((t) => t.id === selectedId) ?? null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-2">
        <div className="flex flex-wrap gap-1.5">
          <Button
            variant={serviceMode === "INTERNAL_LAB" ? "primary" : "ghost"}
            onClick={() => setServiceMode("INTERNAL_LAB")}
          >
            🏭 Bảo trì &amp; Hiệu chuẩn Thiết bị Nhà máy (R&amp;D · Kit · Oligo · QC)
          </Button>
          <Button
            variant={serviceMode === "CUSTOMER_RMA" ? "primary" : "ghost"}
            onClick={() => setServiceMode("CUSTOMER_RMA")}
          >
            🏥 Bảo hành &amp; Sửa chữa Máy Thương mại Khách hàng (RMA / Field Service)
          </Button>
        </div>
      </div>

      {serviceMode === "INTERNAL_LAB" ? (
        <DepartmentEquipmentView
          deptLabel="Toàn Nhà máy (R&D · Sản xuất Kit · Oligo · QA/QC)"
          isEngineeringHub
        />
      ) : (
      <>
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
        <div className={`${selected ? "lg:col-span-5" : "lg:col-span-12"} flex flex-col gap-3`}>
          <Card
            title="Phiếu Bảo hành, Sửa chữa & Khiếu nại (Service Tickets)"
            actions={
              <Button
                onClick={() => {
                  setForm((s) => ({ ...s, unit_id: opts.data?.serial_units[0]?.id ?? "" }));
                  setShowCreate((v) => !v);
                }}
              >
                + Tiếp nhận phiếu
              </Button>
            }
          >
            {showCreate && (
              <div className="mb-4 p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 flex flex-col gap-2.5">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <Field label="Thiết bị theo số Serial">
                    <select
                      className={inputClass}
                      value={form.unit_id}
                      onChange={(e) => setForm({ ...form, unit_id: e.target.value })}
                    >
                      <option value="">-- Chọn Serial máy --</option>
                      {(opts.data?.serial_units ?? []).map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.serial_no} — {u.model_code} (BH đến: {fmtDate(u.warranty_end)})
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Phân loại phiếu">
                    <select
                      className={inputClass}
                      value={form.ticket_type}
                      onChange={(e) => setForm({ ...form, ticket_type: e.target.value })}
                    >
                      {Object.entries(TICKET_TYPE_LABELS).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Phí dịch vụ dự kiến (Tự về 0đ nếu còn hạn BH)">
                    <input
                      type="number"
                      min={0}
                      className={inputClass}
                      value={form.service_cost}
                      onChange={(e) => setForm({ ...form, service_cost: e.target.value })}
                    />
                  </Field>
                </div>
                <Field label="Mô tả triệu chứng / Phản ánh của khách hàng">
                  <textarea
                    rows={2}
                    className={inputClass}
                    value={form.symptom}
                    onChange={(e) => setForm({ ...form, symptom: e.target.value })}
                  />
                </Field>
                <ErrorNote error={createMut.error} />
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" onClick={() => setShowCreate(false)}>
                    Hủy
                  </Button>
                  <Button
                    disabled={!form.unit_id || !form.symptom || createMut.isPending}
                    onClick={() => createMut.mutate()}
                  >
                    Tạo phiếu dịch vụ
                  </Button>
                </div>
              </div>
            )}

            {svc.data && svc.data.tickets.length > 0 ? (
              <Table head={["Số phiếu", "Serial máy", "Loại", "Bảo hành / Phí", "Trạng thái"]}>
                {svc.data.tickets.map((r) => {
                  const st = TICKET_STATUS[r.status] ?? ["PENDING_QC", r.status];
                  return (
                    <tr
                      key={r.id}
                      onClick={() => setSelectedId(r.id)}
                      className={`cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/60 ${
                        selectedId === r.id ? "bg-sky-50/70 dark:bg-sky-950/30 font-semibold" : ""
                      }`}
                    >
                      <td className="py-2 pr-3 font-mono font-bold">{r.code}</td>
                      <td className="py-2 pr-3">
                        {r.serial_no} <span className="text-slate-400">({r.model_code})</span>
                      </td>
                      <td className="py-2 pr-3">{TICKET_TYPE_LABELS[r.ticket_type] ?? r.ticket_type}</td>
                      <td className="py-2 pr-3">{r.is_warranty ? "Trong BH (0 ₫)" : fmtVnd(r.service_cost)}</td>
                      <td className="py-2 pr-3">
                        <StatusBadge status={st[0]} label={st[1]} />
                      </td>
                    </tr>
                  );
                })}
              </Table>
            ) : (
              <Empty>Chưa có phiếu dịch vụ kỹ thuật nào.</Empty>
            )}
          </Card>
        </div>

        {selected && (
          <div className="lg:col-span-7 flex flex-col gap-3">
            <Card
              title={`Xử lý kỹ thuật phiếu ${selected.code} — Serial ${selected.serial_no}`}
              actions={
                <div className="flex flex-wrap items-center gap-2">
                  <ActionBar
                    endpoint={`/api/factory/device/service-tickets/${selected.id}/actions`}
                    version={selected.version}
                    actions={selected.actions}
                    labels={TICKET_ACTION_LABELS}
                    extraPayload={(act) =>
                      act === "resolve"
                        ? { diagnosis: diagnosisText, resolution: resolutionText }
                        : act === "start_repair" || act === "await_parts"
                          ? { diagnosis: diagnosisText }
                          : undefined
                    }
                    onDone={refreshAll}
                  />
                  <Button variant="ghost" onClick={() => setSelectedId(null)}>
                    Đóng chi tiết
                  </Button>
                </div>
              }
            >
              <div className="flex flex-col gap-3">
                <div className="text-xs text-slate-700 dark:text-slate-300 space-y-1">
                  <div>
                    <strong>Khách hàng:</strong> {selected.customer_name ?? "—"} ·{" "}
                    <strong>Hạn bảo hành máy:</strong> {fmtDate(selected.warranty_end)} ·{" "}
                    <strong>Chế độ:</strong> {selected.is_warranty ? "Miễn phí bảo hành" : fmtVnd(selected.service_cost)}
                  </div>
                  <div>
                    <strong>Triệu chứng / Mô tả sự cố:</strong> {selected.symptom}
                  </div>
                </div>

                <ErrorNote error={actMut.error} />

                {["DIAGNOSING", "AWAITING_PARTS", "IN_REPAIR"].includes(selected.status) && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <Field label="Chẩn đoán kỹ thuật (Diagnosis)">
                      <input
                        className={inputClass}
                        value={diagnosisText}
                        onChange={(e) => setDiagnosisText(e.target.value)}
                      />
                    </Field>
                    <Field label="Biện pháp khắc phục & Kết quả kiểm tra lại (Resolution)">
                      <input
                        className={inputClass}
                        value={resolutionText}
                        onChange={(e) => setResolutionText(e.target.value)}
                      />
                    </Field>
                  </div>
                )}

                {!["CLOSED", "CANCELLED"].includes(selected.status) && (
                  <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 flex flex-col gap-2.5">
                    <h4 className="text-xs font-bold text-slate-700 dark:text-slate-200">
                      Xuất kho linh kiện thay thế (Tự động ghi bổ sung vào DHR của Serial {selected.serial_no})
                    </h4>
                    <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5">
                      <Field label="Kho xuất">
                        <select
                          className={inputClass}
                          value={partForm.warehouse_id}
                          onChange={(e) => setPartForm({ ...partForm, warehouse_id: e.target.value })}
                        >
                          <option value="">-- Chọn kho --</option>
                          {(opts.data?.warehouses ?? []).map((w) => (
                            <option key={w.id} value={w.id}>
                              {w.code} — {w.name}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Linh kiện thay thế">
                        <select
                          className={inputClass}
                          value={partForm.item_id}
                          onChange={(e) => setPartForm({ ...partForm, item_id: e.target.value })}
                        >
                          <option value="">-- Chọn linh kiện --</option>
                          {(opts.data?.items ?? []).map((it) => (
                            <option key={it.id} value={it.id}>
                              {it.code} — {it.name}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Số lượng">
                        <input
                          type="number"
                          min={1}
                          className={inputClass}
                          value={partForm.qty}
                          onChange={(e) => setPartForm({ ...partForm, qty: e.target.value })}
                        />
                      </Field>
                      <Field label="Serial linh kiện mới">
                        <input
                          className={inputClass}
                          value={partForm.component_serial}
                          onChange={(e) => setPartForm({ ...partForm, component_serial: e.target.value })}
                          placeholder="VD: PCB-REP-01"
                        />
                      </Field>
                    </div>
                    <div className="flex justify-end">
                      <Button
                        disabled={!partForm.item_id || actMut.isPending}
                        onClick={() => {
                          const it = (opts.data?.items ?? []).find((x) => x.id === partForm.item_id);
                          actMut.mutate({
                            action: "replace_part",
                            warehouse_id: partForm.warehouse_id || opts.data?.warehouses[0]?.id,
                            item_id: partForm.item_id,
                            qty: Number(partForm.qty),
                            uom: it?.base_uom ?? "pcs",
                            component_serial: partForm.component_serial || null,
                          });
                        }}
                      >
                        Xuất kho linh kiện &amp; Ghi vào DHR
                      </Button>
                    </div>
                  </div>
                )}

                {selected.ticket_type === "COMPLAINT" && (
                  <div className="p-3 rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50/60 dark:bg-amber-950/30 flex flex-col gap-2.5">
                    <h4 className="text-xs font-bold text-amber-800 dark:text-amber-300">
                      Đánh giá CAPA cho Khiếu nại chất lượng (ISO 13485 §8.2.2 — Bắt buộc trước khi đóng phiếu)
                    </h4>
                    <div className="text-xs">
                      Trạng thái:{" "}
                      <strong>
                        {selected.capa_evaluated
                          ? selected.capa_required
                            ? `CẦN MỞ CAPA (Hồ sơ sai lệch: ${selected.deviation_code ?? "Đã tạo"})`
                            : "Đã đánh giá: Không cần mở CAPA"
                          : "CHƯA ĐÁNH GIÁ"}
                      </strong>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      <Field label="Quyết định CAPA">
                        <select
                          className={inputClass}
                          value={capaForm.capa_required ? "YES" : "NO"}
                          onChange={(e) => setCapaForm({ ...capaForm, capa_required: e.target.value === "YES" })}
                        >
                          <option value="YES">Cần mở CAPA (Tự động tạo hồ sơ sai lệch QMS)</option>
                          <option value="NO">Không cần mở CAPA (Ghi rõ thuyết minh)</option>
                        </select>
                      </Field>
                      <Field label="Nhận định đánh giá CAPA">
                        <input
                          className={inputClass}
                          value={capaForm.notes}
                          onChange={(e) => setCapaForm({ ...capaForm, notes: e.target.value })}
                        />
                      </Field>
                    </div>
                    <div className="flex justify-end">
                      <Button
                        disabled={actMut.isPending}
                        onClick={() =>
                          actMut.mutate({
                            action: "evaluate_capa",
                            capa_required: capaForm.capa_required,
                            root_cause: capaForm.root_cause,
                            corrective_action: capaForm.corrective_action,
                            notes: capaForm.notes,
                          })
                        }
                      >
                        Lưu quyết định đánh giá CAPA
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </Card>
          </div>
        )}
      </div>

      <Card title="Lịch bảo trì & Hiệu chuẩn định kỳ tại khách hàng (Preventive Maintenance Schedules)">
        {svc.data && svc.data.schedules.length > 0 ? (
          <Table head={["Số Serial", "Dòng thiết bị", "Khách hàng", "Chu kỳ", "Lần bảo trì gần nhất", "Hạn bảo trì tiếp theo"]}>
            {svc.data.schedules.map((s) => (
              <tr key={s.id}>
                <td className="py-2 pr-3 font-mono font-bold">{s.serial_no}</td>
                <td className="py-2 pr-3">
                  {s.model_code} — {s.model_name}
                </td>
                <td className="py-2 pr-3">{s.customer_name ?? "—"}</td>
                <td className="py-2 pr-3">{s.interval_months} tháng/lần</td>
                <td className="py-2 pr-3">{fmtDate(s.last_service_at)}</td>
                <td className="py-2 pr-3 font-bold">
                  {fmtDate(s.next_due)} {s.is_overdue && <span className="text-rose-600 ml-1">(Quá hạn)</span>}
                </td>
              </tr>
            ))}
          </Table>
        ) : (
          <Empty>Khi bàn giao máy (DELIVERED), lịch bảo trì định kỳ 6 tháng/lần sẽ tự động được khởi tạo tại đây.</Empty>
        )}
      </Card>
      </>
      )}
    </div>
  );
}

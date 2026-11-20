"use client";

import React, { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, fmtDate, useFactoryMe } from "../api";
import { Button, Card, Empty, ErrorNote, Field, inputClass, StatusBadge, Table } from "../ui";
import { EQUIPMENT_CATEGORY_PRESETS, WORK_CENTER_PRESETS } from "../kit/shared";

const ASSET_TYPE_LABELS: Record<string, string> = {
  PCR: "Máy Real-time PCR / Luân nhiệt",
  HPLC: "Hệ thống Sắc ký HPLC",
  SYNTHESIZER: "Máy tổng hợp Oligo",
  CENTRIFUGE: "Máy ly tâm lạnh / tốc độ cao",
  FREEZER: "Tủ âm sâu (-20°C / -80°C) & Tủ mát",
  BALANCE: "Cân phân tích / Máy đo pH chuẩn",
  SPECTROPHOTOMETER: "Máy quang phổ (NanoDrop / OD)",
  MASS_SPEC: "Hệ thống Khối phổ (LC-MS)",
  OTHER: "Tủ ATSH / Robot chiết rót / Thiết bị khác",
};

const ASSET_STATUS_BADGE: Record<string, [string, string]> = {
  IN_SERVICE: ["RELEASED", "Đang hoạt động"],
  UNDER_MAINTENANCE: ["QUARANTINE", "Đang bảo trì / Tạm ngừng"],
  OUT_OF_CALIBRATION: ["REJECTED", "Quá hạn hiệu chuẩn"],
  RETIRED: ["EXPIRED", "Ngừng sử dụng"],
};

const EVENT_KIND_LABELS: Record<string, string> = {
  MAINTENANCE: "Bảo trì định kỳ (PM)",
  CALIBRATION: "Hiệu chuẩn định kỳ",
  REPAIR: "Sửa chữa / Báo hỏng khẩn",
  CLEANING: "Vệ sinh / Khử nhiễm",
  QUALIFICATION: "Thẩm định IQ / OQ / PQ",
};

const EVENT_STATUS_BADGE: Record<string, [string, string]> = {
  PLANNED: ["QUARANTINE", "Chờ Kỹ thuật xử lý"],
  DONE: ["RELEASED", "Kỹ thuật đã hoàn thành"],
  CANCELLED: ["EXPIRED", "Đã hủy"],
};

const today = () => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);

function daysUntil(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null;
  const target = new Date(String(dateStr).slice(0, 10) + "T00:00:00Z").getTime();
  const now = new Date(today() + "T00:00:00Z").getTime();
  return Math.round((target - now) / 86_400_000);
}

export interface DepartmentEquipmentViewProps {
  /** Department code e.g. 'P-RD', 'P-KIT', 'P-QA', 'P-OLIGO', or undefined for all departments (Engineering Hub) */
  deptCode?: string;
  deptLabel: string;
  /** Whether this view is inside Engineering & Technology ('P-DEVICE') acting as the central maintenance dispatcher */
  isEngineeringHub?: boolean;
}

export function DepartmentEquipmentView({
  deptCode,
  deptLabel,
  isEngineeringHub = false,
}: DepartmentEquipmentViewProps) {
  const qc = useQueryClient();
  const me = useFactoryMe();
  const canManageAsset = Boolean(me.data?.is_root || me.data?.permissions?.includes("asset.manage"));
  const [filterDept, setFilterDept] = useState<string>(deptCode ?? "");
  const [showAddAsset, setShowAddAsset] = useState(false);
  const [editingAsset, setEditingAsset] = useState<any | null>(null);
  const [editAssetForm, setEditAssetForm] = useState({
    code: "",
    name: "",
    asset_type: "OTHER",
    equipment_category: "",
    location: "",
    manufacturer: "",
    model: "",
    serial_no: "",
    next_calibration_due: "",
    status: "IN_SERVICE",
    reason: "Cập nhật thông số thiết bị",
  });
  const [showDueList, setShowDueList] = useState(false);
  const [requestAsset, setRequestAsset] = useState<any | null>(null);
  const [completeEvent, setCompleteEvent] = useState<any | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("PLANNED");
  const [assetSearch, setAssetSearch] = useState<string>("");
  const [locationFilter, setLocationFilter] = useState<string>("ALL");
  const [categoryFilter, setCategoryFilter] = useState<string>("ALL");
  const [assetPage, setAssetPage] = useState<number>(1);
  const [assetPageSize, setAssetPageSize] = useState<number>(15);

  const activeDeptParam = isEngineeringHub ? filterDept : deptCode ?? "";

  const assetsQuery = useQuery({
    queryKey: ["factory", "assets", activeDeptParam],
    queryFn: () =>
      api<any[]>(`/api/factory/assets${activeDeptParam ? `?dept=${encodeURIComponent(activeDeptParam)}` : ""}`),
  });

  const eventsQuery = useQuery({
    queryKey: ["factory", "asset-events", activeDeptParam, statusFilter],
    queryFn: () => {
      const qs = new URLSearchParams();
      if (activeDeptParam) qs.set("dept", activeDeptParam);
      if (statusFilter) qs.set("status", statusFilter);
      return api<{ events: any[]; calibration_due: any[] }>(`/api/factory/assets/events?${qs.toString()}`);
    },
  });

  const [newAssetForm, setNewAssetForm] = useState({
    dept_code: deptCode || "P-RD",
    asset_type: "PCR",
    equipment_category: "",
    location: "",
    name: "",
    manufacturer: "",
    model: "",
    serial_no: "",
    calibration_interval_days: "365",
    next_calibration_due: "",
  });

  const [reqForm, setReqForm] = useState({
    kind: "MAINTENANCE",
    planned_date: today(),
    assignee: "Phòng Kỹ thuật – Thiết bị",
    description: "",
    out_of_service: false,
  });

  const [doneForm, setDoneForm] = useState({
    done_date: today(),
    performed_by: "Kỹ sư Phòng Kỹ thuật – Thiết bị",
    result: "Đã bảo trì, kiểm tra thông số kỹ thuật và hiệu chuẩn đạt yêu cầu ISO 13485",
    passed: "true",
    next_due: "",
    cost_vnd: "0",
  });

  const refreshAll = () => {
    qc.invalidateQueries({ queryKey: ["factory", "assets"] });
    qc.invalidateQueries({ queryKey: ["factory", "asset-events"] });
  };

  const createAssetMut = useMutation({
    mutationFn: () =>
      api("/api/factory/assets", {
        method: "POST",
        idempotent: true,
        json: {
          dept_code: deptCode || newAssetForm.dept_code,
          asset_type: newAssetForm.asset_type,
          equipment_category: newAssetForm.equipment_category.trim() || null,
          location: newAssetForm.location.trim() || null,
          name: newAssetForm.name,
          manufacturer: newAssetForm.manufacturer || null,
          model: newAssetForm.model || null,
          serial_no: newAssetForm.serial_no || null,
          calibration_interval_days: Number(newAssetForm.calibration_interval_days || 365),
          next_calibration_due: newAssetForm.next_calibration_due || null,
        },
      }),
    onSuccess: () => {
      setShowAddAsset(false);
      setNewAssetForm((p) => ({ ...p, name: "", model: "", serial_no: "", equipment_category: "", location: "" }));
      refreshAll();
    },
  });

  const updateAssetMut = useMutation({
    mutationFn: () =>
      api(`/api/factory/assets/${editingAsset.id}`, {
        method: "PATCH",
        json: {
          code: editAssetForm.code.trim(),
          name: editAssetForm.name.trim(),
          asset_type: editAssetForm.asset_type,
          equipment_category: editAssetForm.equipment_category.trim() || null,
          location: editAssetForm.location.trim() || null,
          manufacturer: editAssetForm.manufacturer.trim() || null,
          model: editAssetForm.model.trim() || null,
          serial_no: editAssetForm.serial_no.trim() || null,
          next_calibration_due: editAssetForm.next_calibration_due || null,
          status: editAssetForm.status,
          reason: editAssetForm.reason.trim() || "Cập nhật thông tin thiết bị",
        },
      }),
    onSuccess: () => {
      setEditingAsset(null);
      refreshAll();
    },
  });

  const deleteAssetMut = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api(`/api/factory/assets/${id}`, {
        method: "DELETE",
        json: { reason },
      }),
    onSuccess: () => {
      setEditingAsset(null);
      refreshAll();
    },
  });

  const createRequestMut = useMutation({
    mutationFn: () =>
      api("/api/factory/assets/events", {
        method: "POST",
        idempotent: true,
        json: {
          asset_id: requestAsset?.id,
          kind: reqForm.kind,
          planned_date: reqForm.planned_date,
          assignee: reqForm.assignee || "Phòng Kỹ thuật – Thiết bị",
          description:
            reqForm.description ||
            `[Đề xuất từ ${deptLabel}] Yêu cầu ${EVENT_KIND_LABELS[reqForm.kind] ?? reqForm.kind} cho máy ${requestAsset?.code}`,
          out_of_service: reqForm.out_of_service,
        },
      }),
    onSuccess: () => {
      setRequestAsset(null);
      setReqForm((p) => ({ ...p, description: "", out_of_service: false }));
      refreshAll();
    },
  });

  const completeMut = useMutation({
    mutationFn: () =>
      api(`/api/factory/assets/events/${completeEvent.id}/actions`, {
        method: "POST",
        json: {
          action: "tech_complete",
          expectedVersion: completeEvent.version,
          payload: {
            done_date: doneForm.done_date,
            performed_by: doneForm.performed_by,
            result: doneForm.result,
            passed: doneForm.passed === "true",
            next_due: doneForm.next_due || null,
            cost_vnd: doneForm.cost_vnd ? Number(doneForm.cost_vnd) : 0,
          },
        },
      }),
    onSuccess: () => {
      setCompleteEvent(null);
      refreshAll();
    },
  });

  const assets = assetsQuery.data ?? [];
  const events = eventsQuery.data?.events ?? [];
  const dueList = eventsQuery.data?.calibration_due ?? [];
  const overdueCount = dueList.filter((d: any) => {
    const days = daysUntil(d.next_calibration_due);
    return days !== null && days < 0;
  }).length;
  const upcomingCount = dueList.length - overdueCount;
  const unplannedDueCount = dueList.filter((d: any) => !d.planned).length;

  const inServiceCount = assets.filter((a) => a.status === "IN_SERVICE").length;
  const maintCount = assets.filter((a) => a.status !== "IN_SERVICE").length;
  const uniqueLocations = Array.from(
    new Set(assets.map((a: any) => String(a.location || "").trim()).filter(Boolean))
  );
  const uniqueCategories = Array.from(
    new Set(assets.map((a: any) => String(a.equipment_category || "").trim()).filter(Boolean))
  );
  const categoryDatalist = Array.from(new Set([...EQUIPMENT_CATEGORY_PRESETS, ...uniqueCategories]));
  const locationDatalist = Array.from(new Set([...WORK_CENTER_PRESETS, ...uniqueLocations]));

  return (
    <div className="flex flex-col gap-3">
      {/* Compact KPI & Workflow Banner */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3 flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-0.5">
          <div className="text-xs font-extrabold text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <span>
              {isEngineeringHub
                ? "🏭 Trung tâm Điều phối Bảo trì, Hiệu chuẩn & Sửa chữa Thiết bị Nội bộ Nhà máy (R&D · Kit · Oligo · QC)"
                : `🔬 Danh mục Thiết bị & Đề xuất Bảo trì / Hiệu chuẩn — ${deptLabel}`}
            </span>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-sky-100 text-sky-800 dark:bg-sky-950/60 dark:text-sky-300">
              Liên thông Phòng Kỹ thuật – Thiết bị
            </span>
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400">
            Mọi đề xuất Bảo trì / Hiệu chuẩn / Báo hỏng từ <b>R&amp;D, Sản xuất Kit, Oligo, QA/QC</b> và lịch máy sắp đến hạn (&le; 30 ngày) tự động đẩy thẳng về <b>Phòng Kỹ thuật – Thiết bị (Tab 6)</b> để xử lý và mở khóa máy.
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 font-semibold">
            Tổng máy: <b>{assets.length}</b>
          </span>
          <span className="px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300 font-semibold">
            Sẵn sàng: <b>{inServiceCount}</b>
          </span>
          {maintCount > 0 && (
            <span className="px-2.5 py-1 rounded-lg bg-rose-50 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300 font-semibold">
              Đang bảo trì/Quá hạn: <b>{maintCount}</b>
            </span>
          )}
          {dueList.length > 0 ? (
            <button
              type="button"
              onClick={() => setShowDueList((v) => !v)}
              aria-expanded={showDueList}
              className="px-2.5 py-1 rounded-lg bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300 font-semibold cursor-pointer hover:bg-amber-100 dark:hover:bg-amber-900/50 transition-colors"
            >
              Sắp đến hạn HC (&le;30d): <b>{dueList.length}</b>
            </button>
          ) : (
            <span className="px-2.5 py-1 rounded-lg bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300 font-semibold">
              Sắp đến hạn HC (&le;30d): <b>0</b>
            </span>
          )}
        </div>
      </div>

      {/* Radar cảnh báo thiết bị sắp đến hạn hiệu chuẩn (<= 30 ngày) — mặc định gọn 1 dòng, bấm để xổ danh sách */}
      {dueList.length > 0 && (
        <div
          className={`rounded-xl border px-3 py-2 ${
            overdueCount > 0
              ? "border-rose-300 dark:border-rose-800/80 bg-rose-50/70 dark:bg-rose-950/20"
              : "border-amber-300 dark:border-amber-800/80 bg-amber-50/70 dark:bg-amber-950/20"
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className={overdueCount > 0 ? "font-bold text-rose-900 dark:text-rose-200" : "font-bold text-amber-900 dark:text-amber-200"}>
                ⏰ Cảnh báo: Có {dueList.length} thiết bị đến hạn / sắp đến hạn hiệu chuẩn (trong 30 ngày tới)
              </span>
              {overdueCount > 0 && (
                <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-rose-100 text-rose-800 dark:bg-rose-900/60 dark:text-rose-200">
                  Quá hạn: {overdueCount} máy
                </span>
              )}
              {upcomingCount > 0 && (
                <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-200/70 text-amber-900 dark:bg-amber-900/50 dark:text-amber-200">
                  Sắp đến hạn: {upcomingCount} máy
                </span>
              )}
              {unplannedDueCount > 0 && (
                <span className="text-[11px] text-amber-800/90 dark:text-amber-300/90">
                  ({unplannedDueCount} máy chưa gửi đề xuất)
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => setShowDueList((v) => !v)}
              aria-expanded={showDueList}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-amber-400/80 dark:border-amber-700 bg-white dark:bg-slate-900 hover:bg-amber-100/60 dark:hover:bg-slate-800 text-xs font-bold text-amber-900 dark:text-amber-200 cursor-pointer transition-colors"
            >
              {showDueList ? (
                <>
                  <span>Thu gọn</span>
                  <ChevronUp className="w-3.5 h-3.5" />
                </>
              ) : (
                <>
                  <span>Xem danh sách ({dueList.length} máy)</span>
                  <ChevronDown className="w-3.5 h-3.5" />
                </>
              )}
            </button>
          </div>

          {showDueList && (
            <div className="mt-2 pt-2 border-t border-amber-200/80 dark:border-amber-800/60 space-y-2">
              <div className="text-[11px] text-amber-800 dark:text-amber-300">
                Tự động báo cho cả Phòng sử dụng &amp; Phòng Kỹ thuật – Thiết bị
              </div>
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-1.5 max-h-72 overflow-y-auto pr-1">
                {dueList.map((d: any) => {
                  const days = daysUntil(d.next_calibration_due);
                  return (
                    <div
                      key={d.id}
                      className="flex flex-wrap items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg border border-amber-300 dark:border-amber-800 bg-white dark:bg-slate-900 text-xs"
                    >
                      <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                        <span className="font-mono font-bold text-sky-700 dark:text-sky-400">{d.code}</span>
                        <span className="font-medium text-slate-800 dark:text-slate-200">{d.name}</span>
                        {isEngineeringHub && d.owner_name && (
                          <span className="text-[11px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                            {d.owner_name}
                          </span>
                        )}
                        <span className={`font-mono font-bold ${days !== null && days < 0 ? "text-rose-600" : "text-amber-700"}`}>
                          Hạn: {fmtDate(d.next_calibration_due)} ({days !== null ? (days < 0 ? `Quá hạn ${Math.abs(days)} ngày` : `Còn ${days} ngày`) : ""})
                        </span>
                      </div>
                      <div className="shrink-0">
                        {d.planned ? (
                          <span className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">✓ Đã có phiếu chờ Kỹ thuật</span>
                        ) : (
                          <Button
                            variant="secondary"
                            onClick={() => {
                              setRequestAsset(d);
                              setReqForm({
                                kind: "CALIBRATION",
                                planned_date: today(),
                                assignee: "Phòng Kỹ thuật – Thiết bị",
                                description: `[Lịch tự động] Đề nghị Phòng Kỹ thuật – Thiết bị hiệu chuẩn định kỳ máy ${d.code} (${d.name}) trước hạn ${fmtDate(d.next_calibration_due)}`,
                                out_of_service: false,
                              });
                            }}
                          >
                            + Gửi đề xuất Hiệu chuẩn ngay
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Modal / Collapsible Form gửi đề xuất Bảo trì / Hiệu chuẩn / Báo hỏng */}
      {/* Bảng 1: Hàng đợi Phiếu Đề xuất Bảo trì / Hiệu chuẩn / Sửa chữa */}
      <Card
        title={
          isEngineeringHub
            ? `📥 Hàng đợi Đề xuất & Kế hoạch Bảo trì / Hiệu chuẩn từ các Phòng ban (${events.length} phiếu)`
            : `📋 Theo dõi Phiếu Đề xuất Bảo trì / Hiệu chuẩn đã gửi Phòng Kỹ thuật (${events.length} phiếu)`
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {isEngineeringHub && (
              <select
                className={`${inputClass} w-44`}
                value={filterDept}
                onChange={(e) => setFilterDept(e.target.value)}
              >
                <option value="">Tất cả phòng ban (R&D · Kit · Oligo · QC)</option>
                <option value="P-RD">Nghiên cứu R&D (P-RD)</option>
                <option value="P-KIT">Sản xuất Kit (P-KIT)</option>
                <option value="P-OLIGO">Tổng hợp Oligo (P-OLIGO)</option>
                <option value="P-QA">Đảm bảo & Kiểm soát CL (P-QA)</option>
              </select>
            )}
            <select
              className={`${inputClass} w-40`}
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="PLANNED">Đang chờ xử lý (PLANNED)</option>
              <option value="DONE">Đã hoàn thành (DONE)</option>
              <option value="">Tất cả trạng thái</option>
            </select>
          </div>
        }
      >
        <ErrorNote error={eventsQuery.error} />
        {events.length === 0 ? (
          <Empty>Không có phiếu bảo trì / hiệu chuẩn nào ở trạng thái đã chọn.</Empty>
        ) : (
          <Table
            head={[
              "Mã phiếu",
              "Phòng ban",
              "Thiết bị",
              "Phân loại",
              "Ngày dự kiến / Hoàn thành",
              "Nội dung đề xuất & Kết quả Kỹ thuật",
              "Trạng thái",
              "Thao tác",
            ]}
          >
            {events.map((ev: any) => {
              const st = EVENT_STATUS_BADGE[ev.status] ?? ["QUARANTINE", ev.status];
              const isCompletingRow = completeEvent?.id === ev.id;
              return (
                <React.Fragment key={ev.id}>
                  <tr className={isCompletingRow ? "bg-emerald-50/70 dark:bg-emerald-950/30 font-semibold" : ""}>
                    <td className="py-2 pr-3 font-mono text-xs font-bold text-sky-700 dark:text-sky-400">{ev.code}</td>
                    <td className="py-2 pr-3 text-xs font-semibold">{ev.owner_name}</td>
                    <td className="py-2 pr-3 text-xs">
                      <div className="font-semibold text-slate-800 dark:text-slate-100">
                        {ev.asset_code} — {ev.asset_name}
                      </div>
                      {ev.out_of_service && (
                        <span className="inline-block mt-0.5 px-1.5 py-0.5 rounded bg-rose-100 text-rose-800 text-[10px] font-bold">
                          🚨 Báo hỏng ngừng máy
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-xs font-medium">{EVENT_KIND_LABELS[ev.kind] ?? ev.kind}</td>
                    <td className="py-2 pr-3 text-xs font-mono">
                      <div>KH: {fmtDate(ev.planned_date)}</div>
                      {ev.done_date && <div className="text-emerald-700 font-bold">Xong: {fmtDate(ev.done_date)}</div>}
                    </td>
                    <td className="py-2 pr-3 text-xs">
                      <div className="text-slate-700 dark:text-slate-200">{ev.description ?? "—"}</div>
                      {ev.result && (
                        <div className="text-emerald-700 dark:text-emerald-400 font-medium mt-0.5">
                          ↳ KQ Kỹ thuật ({ev.performed_by}): {ev.result}
                        </div>
                      )}
                    </td>
                    <td className="py-2 pr-3">
                      <StatusBadge status={st[0]} label={st[1]} />
                    </td>
                    <td className="py-2 text-right">
                      {ev.status === "PLANNED" && (
                        <Button
                          variant={isCompletingRow ? "primary" : "secondary"}
                          onClick={() => {
                            setCompleteEvent(isCompletingRow ? null : ev);
                          }}
                        >
                          {isCompletingRow ? "Đóng nghiệm thu" : "🛠️ Kỹ thuật Xử lý & Nghiệm thu"}
                        </Button>
                      )}
                    </td>
                  </tr>
                  {isCompletingRow && (
                    <tr>
                      <td colSpan={8} className="py-2 pr-3">
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            completeMut.mutate();
                          }}
                          className="p-3 rounded-xl border border-emerald-300 dark:border-emerald-800 bg-emerald-50/70 dark:bg-emerald-950/20 space-y-2.5"
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-emerald-900 dark:text-emerald-200">
                              🛠️ Nghiệm thu &amp; Hoàn thành Bảo trì / Hiệu chuẩn phiếu {ev.code} — Máy {ev.asset_code} ({ev.owner_name})
                            </span>
                            <Button type="button" variant="ghost" onClick={() => setCompleteEvent(null)}>
                              Đóng
                            </Button>
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2 items-end">
                            <Field label="Ngày hoàn thành *">
                              <input
                                type="date"
                                max={today()}
                                className={inputClass}
                                value={doneForm.done_date}
                                onChange={(e) => setDoneForm({ ...doneForm, done_date: e.target.value })}
                                required
                              />
                            </Field>
                            <Field label="Kỹ sư / Đơn vị thực hiện *">
                              <input
                                className={inputClass}
                                value={doneForm.performed_by}
                                onChange={(e) => setDoneForm({ ...doneForm, performed_by: e.target.value })}
                                required
                              />
                            </Field>
                            <div className="sm:col-span-2">
                              <Field label="Kết quả xử lý / Biên bản hiệu chuẩn / Linh kiện đã thay *">
                                <input
                                  className={inputClass}
                                  value={doneForm.result}
                                  onChange={(e) => setDoneForm({ ...doneForm, result: e.target.value })}
                                  required
                                />
                              </Field>
                            </div>
                            <Field label="Kết luận Đạt / Không đạt">
                              <select
                                className={inputClass}
                                value={doneForm.passed}
                                onChange={(e) => setDoneForm({ ...doneForm, passed: e.target.value })}
                              >
                                <option value="true">✅ ĐẠT (Mở khóa máy IN_SERVICE)</option>
                                <option value="false">❌ KHÔNG ĐẠT (Giữ khóa máy)</option>
                              </select>
                            </Field>
                            <Button type="submit" disabled={completeMut.isPending}>
                              ✓ Xác nhận Hoàn thành
                            </Button>
                          </div>
                          <ErrorNote error={completeMut.error} />
                        </form>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </Table>
        )}
      </Card>

      {/* Bảng 2: Danh mục Thiết bị Phòng Lab / Sản xuất */}
      <Card
        title={`🗂️ Danh mục Thiết bị (${assets.length} máy)`}
        actions={
          <Button variant="ghost" onClick={() => setShowAddAsset((v) => !v)}>
            {showAddAsset ? "Đóng form thêm máy" : "+ Khai báo Thiết bị mới"}
          </Button>
        }
      >
        {showAddAsset && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              createAssetMut.mutate();
            }}
            className="mb-3 p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/50 space-y-2"
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2 items-end">
              {!deptCode && (
                <Field label="Phòng quản lý *">
                  <select
                    className={inputClass}
                    value={newAssetForm.dept_code}
                    onChange={(e) => setNewAssetForm({ ...newAssetForm, dept_code: e.target.value })}
                  >
                    <option value="P-RD">Nghiên cứu R&D</option>
                    <option value="P-KIT">Sản xuất Kit</option>
                    <option value="P-QA">QA/QC</option>
                    <option value="P-OLIGO">Tổng hợp Oligo</option>
                    <option value="P-DEVICE">Kỹ thuật – Thiết bị</option>
                  </select>
                </Field>
              )}
              <Field label="Nhóm thiết bị chuẩn *">
                <select
                  className={inputClass}
                  value={newAssetForm.asset_type}
                  onChange={(e) => setNewAssetForm({ ...newAssetForm, asset_type: e.target.value })}
                >
                  {Object.entries(ASSET_TYPE_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Phân nhóm chi tiết (Chọn khi SX)">
                <input
                  list="asset-category-presets-list"
                  className={inputClass}
                  placeholder="VD: Pipet, Tủ ATSH, Máy đo pH..."
                  value={newAssetForm.equipment_category}
                  onChange={(e) => setNewAssetForm({ ...newAssetForm, equipment_category: e.target.value })}
                />
              </Field>
              <Field label="Vị trí / Khu vực phòng">
                <input
                  list="asset-location-presets-list"
                  className={inputClass}
                  placeholder="VD: Phòng Pha chế Kit (ISO 7)"
                  value={newAssetForm.location}
                  onChange={(e) => setNewAssetForm({ ...newAssetForm, location: e.target.value })}
                />
              </Field>
              <div className="sm:col-span-2">
                <Field label="Tên thiết bị *">
                  <input
                    className={inputClass}
                    placeholder="VD: Máy Real-time PCR Bio-Rad CFX96..."
                    value={newAssetForm.name}
                    onChange={(e) => setNewAssetForm({ ...newAssetForm, name: e.target.value })}
                    required
                  />
                </Field>
              </div>
              <Field label="Hãng & Model">
                <input
                  className={inputClass}
                  placeholder="VD: Bio-Rad CFX96"
                  value={newAssetForm.model}
                  onChange={(e) => setNewAssetForm({ ...newAssetForm, model: e.target.value })}
                />
              </Field>
              <Field label="Số Serial & Hạn HC">
                <div className="flex gap-1">
                  <input
                    className={inputClass}
                    placeholder="Serial"
                    value={newAssetForm.serial_no}
                    onChange={(e) => setNewAssetForm({ ...newAssetForm, serial_no: e.target.value })}
                  />
                  <input
                    type="date"
                    className={inputClass}
                    value={newAssetForm.next_calibration_due}
                    onChange={(e) => setNewAssetForm({ ...newAssetForm, next_calibration_due: e.target.value })}
                  />
                </div>
              </Field>
              <div className="flex items-end">
                <Button type="submit" disabled={createAssetMut.isPending}>
                  Lưu thiết bị
                </Button>
              </div>
            </div>
            <datalist id="asset-category-presets-list">
              {categoryDatalist.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
            <datalist id="asset-location-presets-list">
              {locationDatalist.map((loc) => (
                <option key={loc} value={loc} />
              ))}
            </datalist>
            <ErrorNote error={createAssetMut.error} />
          </form>
        )}

        <ErrorNote error={deleteAssetMut.error} />

        {assets.length === 0 ? (
          <Empty>Chưa có thiết bị nào trong danh mục.</Empty>
        ) : (
          (() => {
            const q = assetSearch.trim().toLowerCase();
            const filteredAssets = assets.filter((a: any) => {
              if (locationFilter !== "ALL" && String(a.location || "") !== locationFilter) return false;
              if (categoryFilter !== "ALL" && String(a.equipment_category || "") !== categoryFilter) return false;
              if (q) {
                const hay = `${a.code ?? ""} ${a.name ?? ""} ${a.model ?? ""} ${a.serial_no ?? ""} ${a.location ?? ""} ${a.manufacturer ?? ""}`.toLowerCase();
                if (!hay.includes(q)) return false;
              }
              return true;
            });
            const totalPages = Math.max(1, Math.ceil(filteredAssets.length / assetPageSize));
            const safePage = Math.min(assetPage, totalPages);
            const pagedAssets = filteredAssets.slice((safePage - 1) * assetPageSize, safePage * assetPageSize);

            return (
              <div className="space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2 pb-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      className={`${inputClass} w-64`}
                      placeholder="🔍 Tìm mã máy, tên, model, serial, vị trí..."
                      value={assetSearch}
                      onChange={(e) => {
                        setAssetSearch(e.target.value);
                        setAssetPage(1);
                      }}
                    />
                    {uniqueLocations.length > 0 && (
                      <select
                        className={`${inputClass} w-44`}
                        value={locationFilter}
                        onChange={(e) => {
                          setLocationFilter(e.target.value);
                          setAssetPage(1);
                        }}
                      >
                        <option value="ALL">📍 Mọi vị trí phòng ({assets.length})</option>
                        {uniqueLocations.map((loc) => (
                          <option key={loc} value={loc}>
                            📍 {loc} ({assets.filter((x: any) => x.location === loc).length})
                          </option>
                        ))}
                      </select>
                    )}
                    {uniqueCategories.length > 0 && (
                      <select
                        className={`${inputClass} w-40`}
                        value={categoryFilter}
                        onChange={(e) => {
                          setCategoryFilter(e.target.value);
                          setAssetPage(1);
                        }}
                      >
                        <option value="ALL">🔧 Mọi phân nhóm</option>
                        {uniqueCategories.map((cat) => (
                          <option key={cat} value={cat}>
                            {cat} ({assets.filter((x: any) => x.equipment_category === cat).length})
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
                    <select
                      className={`${inputClass} w-32 py-1 text-xs`}
                      value={assetPageSize}
                      onChange={(e) => {
                        setAssetPageSize(Number(e.target.value));
                        setAssetPage(1);
                      }}
                    >
                      <option value={15}>15 máy/trang</option>
                      <option value={30}>30 máy/trang</option>
                      <option value={50}>50 máy/trang</option>
                      <option value={100}>100 máy/trang</option>
                    </select>
                    <span>
                      Hiển thị <b>{filteredAssets.length === 0 ? 0 : (safePage - 1) * assetPageSize + 1}</b>–
                      <b>{Math.min(safePage * assetPageSize, filteredAssets.length)}</b> / <b>{filteredAssets.length}</b> máy
                    </span>
                    {totalPages > 1 && (
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          disabled={safePage <= 1}
                          onClick={() => setAssetPage((p) => Math.max(1, p - 1))}
                        >
                          ‹ Trước
                        </Button>
                        <span className="font-semibold px-1">
                          {safePage}/{totalPages}
                        </span>
                        <Button
                          variant="ghost"
                          disabled={safePage >= totalPages}
                          onClick={() => setAssetPage((p) => Math.min(totalPages, p + 1))}
                        >
                          Sau ›
                        </Button>
                      </div>
                    )}
                  </div>
                </div>

                <Table
                  head={[
                    "Mã máy",
                    "Tên thiết bị & Model",
                    "Phòng quản lý & Vị trí",
                    "Số Serial",
                    "Bảo trì gần nhất & Hạn HC kế tiếp",
                    "Trạng thái",
                    "Đề xuất Bảo trì / Hiệu chuẩn / Báo hỏng",
                  ]}
                >
                  {pagedAssets.map((a: any) => {
                    const st = ASSET_STATUS_BADGE[a.status] ?? ["QUARANTINE", a.status];
                    const days = daysUntil(a.next_calibration_due);
                    const isEditingRow = canManageAsset && editingAsset?.id === a.id;
                    const isRequestingRow = requestAsset?.id === a.id;
                    return (
                      <React.Fragment key={a.id}>
                        <tr className={isEditingRow || isRequestingRow ? "bg-sky-50/80 dark:bg-sky-950/30 font-semibold" : ""}>
                          <td className="py-2 pr-3 font-mono text-xs font-bold text-sky-700 dark:text-sky-400">
                            <div>{a.code}</div>
                            {a.equipment_category && (
                              <span className="inline-block mt-0.5 px-1.5 py-0.2 rounded bg-slate-100 dark:bg-slate-800 text-[10px] font-semibold text-slate-600 dark:text-slate-300">
                                {a.equipment_category}
                              </span>
                            )}
                          </td>
                          <td className="py-2 pr-3 text-xs">
                            <div className="font-semibold text-slate-800 dark:text-slate-100">{a.name}</div>
                            <div className="text-slate-500">
                              {ASSET_TYPE_LABELS[a.asset_type] ?? a.asset_type} {a.model ? `· Model: ${a.model}` : ""}
                            </div>
                          </td>
                          <td className="py-2 pr-3 text-xs">
                            <div className="font-medium text-slate-800 dark:text-slate-200">{a.owner_name}</div>
                            {a.location && (
                              <div className="text-[11px] font-semibold text-indigo-700 dark:text-indigo-400 mt-0.5">
                                📍 {a.location}
                              </div>
                            )}
                          </td>
                          <td className="py-2 pr-3 font-mono text-xs">{a.serial_no ?? "—"}</td>
                          <td className="py-2 pr-3 text-xs font-mono">
                            {a.last_calibration_date && (
                              <div className="text-[11px] text-slate-500">
                                BT gần nhất: {fmtDate(a.last_calibration_date)}
                              </div>
                            )}
                            {a.next_calibration_due ? (
                              <div>
                                <span className="font-semibold">Hạn: {fmtDate(a.next_calibration_due)}</span>
                                {days !== null && (
                                  <span
                                    className={`ml-1.5 px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                      days < 0
                                        ? "bg-rose-100 text-rose-800"
                                        : days <= 30
                                          ? "bg-amber-100 text-amber-800"
                                          : "bg-emerald-50 text-emerald-700"
                                    }`}
                                  >
                                    {days < 0 ? `Quá hạn ${Math.abs(days)}d` : `Còn ${days}d`}
                                  </span>
                                )}
                              </div>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td className="py-2 pr-3">
                            <StatusBadge status={st[0]} label={st[1]} />
                          </td>
                          <td className="py-2 text-right whitespace-nowrap">
                            <div className="inline-flex items-center justify-end gap-1 whitespace-nowrap">
                              {canManageAsset && (
                                <>
                                  <Button
                                    variant={isEditingRow ? "primary" : "ghost"}
                                    className="!px-2 !py-0.5 !text-[11px]"
                                    title="Sửa thông tin thiết bị"
                                    onClick={() => {
                                      if (isEditingRow) {
                                        setEditingAsset(null);
                                        return;
                                      }
                                      updateAssetMut.reset();
                                      deleteAssetMut.reset();
                                      setEditingAsset(a);
                                      setEditAssetForm({
                                        code: a.code || "",
                                        name: a.name || "",
                                        asset_type: a.asset_type || "OTHER",
                                        equipment_category: a.equipment_category || "",
                                        location: a.location || "",
                                        manufacturer: a.manufacturer || "",
                                        model: a.model || "",
                                        serial_no: a.serial_no || "",
                                        next_calibration_due: a.next_calibration_due ? String(a.next_calibration_due).slice(0, 10) : "",
                                        status: a.status || "IN_SERVICE",
                                        reason: "Cập nhật thông số thiết bị",
                                      });
                                    }}
                                  >
                                    {isEditingRow ? "Đóng" : "✏️ Sửa"}
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    className="!px-2 !py-0.5 !text-[11px] text-rose-600 dark:text-rose-400"
                                    title="Xóa thiết bị"
                                    disabled={deleteAssetMut.isPending}
                                    onClick={() => {
                                      const reason = window.prompt(
                                        `Nhập lý do xóa thiết bị ${a.code} (${a.name}):`,
                                        "Khai báo nhầm / loại bỏ thiết bị chưa phát sinh hồ sơ"
                                      );
                                      if (reason && reason.trim().length >= 3) {
                                        deleteAssetMut.mutate({ id: a.id, reason: reason.trim() });
                                      }
                                    }}
                                  >
                                    🗑️ Xóa
                                  </Button>
                                </>
                              )}
                              <Button
                                variant={isRequestingRow && !reqForm.out_of_service ? "primary" : "ghost"}
                                className="!px-2 !py-0.5 !text-[11px]"
                                title="Đề xuất Bảo trì / Hiệu chuẩn định kỳ thiết bị"
                                onClick={() => {
                                  if (isRequestingRow && !reqForm.out_of_service) {
                                    setRequestAsset(null);
                                    return;
                                  }
                                  setRequestAsset(a);
                                  setReqForm({
                                    kind: "MAINTENANCE",
                                    planned_date: today(),
                                    assignee: "Phòng Kỹ thuật – Thiết bị",
                                    description: `Đề xuất từ ${a.owner_name}${a.location ? ` (${a.location})` : ""}: Bảo trì / Hiệu chuẩn định kỳ thiết bị ${a.code} (${a.name})`,
                                    out_of_service: false,
                                  });
                                }}
                              >
                                🔧 Bảo trì/HC
                              </Button>
                              <Button
                                variant={isRequestingRow && reqForm.out_of_service ? "danger" : "ghost"}
                                className="!px-2 !py-0.5 !text-[11px]"
                                title="Báo hỏng khẩn cấp đề nghị Kỹ thuật kiểm tra sửa chữa"
                                onClick={() => {
                                  if (isRequestingRow && reqForm.out_of_service) {
                                    setRequestAsset(null);
                                    return;
                                  }
                                  setRequestAsset(a);
                                  setReqForm({
                                    kind: "REPAIR",
                                    planned_date: today(),
                                    assignee: "Phòng Kỹ thuật – Thiết bị",
                                    description: `🚨 Báo hỏng khẩn từ ${a.owner_name}${a.location ? ` (${a.location})` : ""}: Đề nghị Kỹ thuật kiểm tra sửa chữa máy ${a.code} (${a.name})`,
                                    out_of_service: true,
                                  });
                                }}
                              >
                                🚨 Báo hỏng
                              </Button>
                            </div>
                          </td>
                        </tr>
                        {isEditingRow && (
                          <tr>
                            <td colSpan={7} className="py-2 pr-3">
                              <form
                                onSubmit={(e) => {
                                  e.preventDefault();
                                  updateAssetMut.mutate();
                                }}
                                className="p-3 rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50/60 dark:bg-amber-950/20 space-y-2.5"
                              >
                                <div className="flex items-center justify-between">
                                  <span className="text-xs font-bold text-amber-900 dark:text-amber-200">
                                    ✏️ Sửa thông tin thiết bị: <span className="font-mono">{a.code}</span> — {a.name}
                                  </span>
                                  <Button type="button" variant="ghost" onClick={() => setEditingAsset(null)}>
                                    Đóng
                                  </Button>
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2 items-end">
                                  <Field label="Mã thiết bị *">
                                    <input
                                      className={`${inputClass} font-mono`}
                                      value={editAssetForm.code}
                                      onChange={(e) => setEditAssetForm({ ...editAssetForm, code: e.target.value })}
                                      required
                                    />
                                  </Field>
                                  <div className="sm:col-span-2">
                                    <Field label="Tên thiết bị *">
                                      <input
                                        className={inputClass}
                                        value={editAssetForm.name}
                                        onChange={(e) => setEditAssetForm({ ...editAssetForm, name: e.target.value })}
                                        required
                                      />
                                    </Field>
                                  </div>
                                  <Field label="Nhóm thiết bị *">
                                    <select
                                      className={inputClass}
                                      value={editAssetForm.asset_type}
                                      onChange={(e) => setEditAssetForm({ ...editAssetForm, asset_type: e.target.value })}
                                    >
                                      {Object.entries(ASSET_TYPE_LABELS).map(([k, v]) => (
                                        <option key={k} value={k}>
                                          {v}
                                        </option>
                                      ))}
                                    </select>
                                  </Field>
                                  <Field label="Phân nhóm chi tiết">
                                    <input
                                      list="asset-category-presets-list"
                                      className={inputClass}
                                      value={editAssetForm.equipment_category}
                                      onChange={(e) => setEditAssetForm({ ...editAssetForm, equipment_category: e.target.value })}
                                    />
                                  </Field>
                                  <Field label="Vị trí phòng">
                                    <input
                                      list="asset-location-presets-list"
                                      className={inputClass}
                                      value={editAssetForm.location}
                                      onChange={(e) => setEditAssetForm({ ...editAssetForm, location: e.target.value })}
                                    />
                                  </Field>
                                  <Field label="Hãng sản xuất">
                                    <input
                                      className={inputClass}
                                      value={editAssetForm.manufacturer}
                                      onChange={(e) => setEditAssetForm({ ...editAssetForm, manufacturer: e.target.value })}
                                    />
                                  </Field>
                                  <Field label="Model">
                                    <input
                                      className={inputClass}
                                      value={editAssetForm.model}
                                      onChange={(e) => setEditAssetForm({ ...editAssetForm, model: e.target.value })}
                                    />
                                  </Field>
                                  <Field label="Số Serial">
                                    <input
                                      className={inputClass}
                                      value={editAssetForm.serial_no}
                                      onChange={(e) => setEditAssetForm({ ...editAssetForm, serial_no: e.target.value })}
                                    />
                                  </Field>
                                  <Field label="Hạn HC kế tiếp">
                                    <input
                                      type="date"
                                      className={inputClass}
                                      value={editAssetForm.next_calibration_due}
                                      onChange={(e) => setEditAssetForm({ ...editAssetForm, next_calibration_due: e.target.value })}
                                    />
                                  </Field>
                                  <Field label="Trạng thái">
                                    <select
                                      className={inputClass}
                                      value={editAssetForm.status}
                                      onChange={(e) => setEditAssetForm({ ...editAssetForm, status: e.target.value })}
                                    >
                                      {Object.entries(ASSET_STATUS_BADGE).map(([k, [, label]]) => (
                                        <option key={k} value={k}>
                                          {label}
                                        </option>
                                      ))}
                                    </select>
                                  </Field>
                                  <Field label="Lý do chỉnh sửa *">
                                    <input
                                      className={inputClass}
                                      value={editAssetForm.reason}
                                      onChange={(e) => setEditAssetForm({ ...editAssetForm, reason: e.target.value })}
                                      required
                                    />
                                  </Field>
                                </div>
                                <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                                  <div className="flex items-center gap-2">
                                    <Button type="submit" disabled={updateAssetMut.isPending || deleteAssetMut.isPending}>
                                      {updateAssetMut.isPending ? "Đang lưu..." : "💾 Lưu thay đổi thiết bị"}
                                    </Button>
                                    <Button type="button" variant="ghost" onClick={() => setEditingAsset(null)}>
                                      Hủy
                                    </Button>
                                  </div>
                                  <Button
                                    type="button"
                                    variant="danger"
                                    disabled={deleteAssetMut.isPending || updateAssetMut.isPending}
                                    onClick={() => {
                                      const reason = window.prompt(
                                        `Nhập lý do xóa thiết bị ${a.code} (${a.name}):`,
                                        "Khai báo nhầm / loại bỏ thiết bị chưa phát sinh hồ sơ"
                                      );
                                      if (reason && reason.trim().length >= 3) {
                                        deleteAssetMut.mutate({ id: a.id, reason: reason.trim() });
                                      }
                                    }}
                                  >
                                    🗑️ Xóa thiết bị
                                  </Button>
                                </div>
                                <ErrorNote error={updateAssetMut.error ?? deleteAssetMut.error} />
                              </form>
                            </td>
                          </tr>
                        )}
                        {isRequestingRow && (
                          <tr>
                            <td colSpan={7} className="py-2 pr-3">
                              <Card
                                title={`🔧 Gửi Đề xuất Bảo trì / Hiệu chuẩn / Báo hỏng tới Phòng Kỹ thuật – Thiết bị: ${a.code} — ${a.name}`}
                                actions={
                                  <Button variant="ghost" onClick={() => setRequestAsset(null)}>
                                    Đóng
                                  </Button>
                                }
                              >
                                <form
                                  onSubmit={(e) => {
                                    e.preventDefault();
                                    createRequestMut.mutate();
                                  }}
                                  className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2.5 items-end"
                                >
                                  <Field label="Phân loại yêu cầu *">
                                    <select
                                      className={inputClass}
                                      value={reqForm.kind}
                                      onChange={(e) =>
                                        setReqForm({
                                          ...reqForm,
                                          kind: e.target.value,
                                          out_of_service: e.target.value === "REPAIR" ? true : reqForm.out_of_service,
                                        })
                                      }
                                    >
                                      {Object.entries(EVENT_KIND_LABELS).map(([k, v]) => (
                                        <option key={k} value={k}>
                                          {v}
                                        </option>
                                      ))}
                                    </select>
                                  </Field>
                                  <Field label="Ngày yêu cầu xử lý *">
                                    <input
                                      type="date"
                                      className={inputClass}
                                      value={reqForm.planned_date}
                                      onChange={(e) => setReqForm({ ...reqForm, planned_date: e.target.value })}
                                      required
                                    />
                                  </Field>
                                  <Field label="Đơn vị tiếp nhận xử lý">
                                    <input
                                      className={inputClass}
                                      value={reqForm.assignee}
                                      onChange={(e) => setReqForm({ ...reqForm, assignee: e.target.value })}
                                    />
                                  </Field>
                                  <div className="sm:col-span-2">
                                    <Field label="Mô tả triệu chứng / Nội dung đề xuất gửi Phòng Kỹ thuật *">
                                      <input
                                        className={inputClass}
                                        placeholder="VD: Lệch nhiệt độ block / Cần hiệu chuẩn định kỳ / Báo hỏng khẩn..."
                                        value={reqForm.description}
                                        onChange={(e) => setReqForm({ ...reqForm, description: e.target.value })}
                                        required
                                      />
                                    </Field>
                                  </div>
                                  <div className="flex flex-col gap-1.5">
                                    <label className="flex items-center gap-1.5 text-xs font-semibold text-rose-700 dark:text-rose-400 cursor-pointer">
                                      <input
                                        type="checkbox"
                                        checked={reqForm.out_of_service}
                                        onChange={(e) => setReqForm({ ...reqForm, out_of_service: e.target.checked })}
                                      />
                                      🚨 Báo hỏng: Ngừng máy ngay
                                    </label>
                                    <Button type="submit" disabled={createRequestMut.isPending}>
                                      📤 Gửi sang Phòng Kỹ thuật
                                    </Button>
                                  </div>
                                </form>
                                <ErrorNote error={createRequestMut.error} />
                              </Card>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </Table>
              </div>
            );
          })()
        )}
      </Card>
    </div>
  );
}

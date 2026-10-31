"use client";

import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ActionBar, type AllowedAction } from "../actions";
import { api, fmtDate, fmtQty } from "../api";
import { Button, Card, Empty, ErrorNote, Field, inputClass, StatusBadge, Table } from "../ui";
import {
  ECO_STATUS,
  MODEL_CATEGORY_LABELS,
  MODEL_STATUS,
  REVISION_STATUS,
  STATION_LABELS,
  useDeviceOptions,
} from "./shared";

const REV_ACTION_LABELS: Record<string, string> = {
  release: "Phát hành phiên bản DMR (Ký điện tử)",
  obsolete: "Thu hồi hiệu lực (OBSOLETE)",
};

const ECO_ACTION_LABELS: Record<string, string> = {
  start_impact: "Bắt đầu đánh giá ảnh hưởng",
  submit_approval: "Trình hội đồng phê duyệt ECO",
  approve: "Hội đồng ký duyệt ECO",
  reject: "Từ chối ECO",
  implement: "Ban hành hiệu lực (Nâng phiên bản DMR)",
  close: "Xác minh & Đóng ECO",
};

interface BomLine {
  id: string;
  line_no: number;
  station_code: string;
  item_code: string;
  item_name: string;
  qty_per_unit: number;
  uom: string;
  source_type: string;
  is_critical: boolean;
  requires_serial: boolean;
  tracking_type?: "SERIAL" | "LOT" | "BULK";
  drawing_code?: string | null;
  notes: string | null;
}

interface RevisionDetail {
  id: string;
  revision: string;
  firmware_version: string | null;
  dmr_summary: string;
  effectivity_type: string;
  effectivity_value: string | null;
  eco_code: string | null;
  released_by_name: string | null;
  released_at: string | null;
  status: string;
  version: number;
  bom_lines: BomLine[];
  actions: AllowedAction[];
}

interface EcoDetail {
  id: string;
  code: string;
  target_revision: string;
  title: string;
  reason: string;
  change_summary: string;
  impact_documents: string | null;
  impact_training: string | null;
  impact_stock: string | null;
  impact_open_orders: string | null;
  impact_regulatory: string | null;
  effectivity_type: string;
  effectivity_value: string | null;
  proposer_name: string | null;
  approved_by_name: string | null;
  verification_note: string | null;
  status: string;
  version: number;
  actions: AllowedAction[];
}

interface ModelDetail {
  id: string;
  code: string;
  name: string;
  org_unit_id: string;
  org_unit_name: string;
  category: string;
  warranty_months: number;
  required_burn_in_hours: number;
  description: string | null;
  specs_json?: Record<string, unknown>;
  accessories_standard?: unknown[];
  accessories_optional?: unknown[];
  status: string;
  revisions: RevisionDetail[];
  ecos: EcoDetail[];
}

function EcoImpactEditor({ eco, onDone }: { eco: EcoDetail; onDone: () => void }) {
  const [form, setForm] = useState({
    impact_documents: eco.impact_documents ?? "",
    impact_training: eco.impact_training ?? "",
    impact_stock: eco.impact_stock ?? "",
    impact_open_orders: eco.impact_open_orders ?? "",
    impact_regulatory: eco.impact_regulatory ?? "",
  });
  const saveMut = useMutation({
    mutationFn: () =>
      api(`/api/factory/device/ecos/${eco.id}/actions`, {
        method: "POST",
        json: { action: "save_impact", version: eco.version, ...form },
      }),
    onSuccess: onDone,
  });

  return (
    <form
      className="grid grid-cols-1 md:grid-cols-2 gap-2 rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/40 dark:bg-amber-950/20 p-3 mt-2"
      onSubmit={(e) => {
        e.preventDefault();
        saveMut.mutate();
      }}
    >
      <div className="md:col-span-2 text-xs font-bold text-amber-800 dark:text-amber-300">
        Bảng đánh giá ảnh hưởng 5 chiều (Bắt buộc trước khi trình duyệt ECO {eco.code})
      </div>
      <Field label="1. Ảnh hưởng tài liệu DMR / SOP lắp ráp *">
        <input className={inputClass} value={form.impact_documents} onChange={(e) => setForm({ ...form, impact_documents: e.target.value })} required />
      </Field>
      <Field label="2. Ảnh hưởng đào tạo kỹ thuật viên *">
        <input className={inputClass} value={form.impact_training} onChange={(e) => setForm({ ...form, impact_training: e.target.value })} required />
      </Field>
      <Field label="3. Xử lý tồn kho linh kiện phiên bản cũ *">
        <input className={inputClass} value={form.impact_stock} onChange={(e) => setForm({ ...form, impact_stock: e.target.value })} required />
      </Field>
      <Field label="4. Ảnh hưởng lệnh lắp ráp đang chạy *">
        <input className={inputClass} value={form.impact_open_orders} onChange={(e) => setForm({ ...form, impact_open_orders: e.target.value })} required />
      </Field>
      <div className="md:col-span-2">
        <Field label="5. Ảnh hưởng hồ sơ đăng ký lưu hành / ISO 13485 *">
          <input className={inputClass} value={form.impact_regulatory} onChange={(e) => setForm({ ...form, impact_regulatory: e.target.value })} required />
        </Field>
      </div>
      <div className="md:col-span-2 flex items-center gap-2">
        <Button type="submit" disabled={saveMut.isPending}>Lưu đánh giá ảnh hưởng</Button>
        <ErrorNote error={saveMut.error} />
      </div>
    </form>
  );
}

function ModelDetailPanel({ id, canManage, canEcoPropose, onClose }: { id: string; canManage: boolean; canEcoPropose: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const opts = useDeviceOptions();
  const detail = useQuery({
    queryKey: ["factory", "device", "model", id],
    queryFn: () => api<ModelDetail>(`/api/factory/device/models/${id}`),
  });

  const [revForm, setRevForm] = useState({ revision: "", firmware_version: "v1.0.0", dmr_summary: "", clone_from_revision_id: "" });
  const [showAddRev, setShowAddRev] = useState(false);
  const [showAddBom, setShowAddBom] = useState(false);
  const [showAddEco, setShowAddEco] = useState(false);
  const [bomForm, setBomForm] = useState({
    revision_id: "",
    station_code: "STATION_1_MECH",
    component_item_id: "",
    qty_per_unit: "1",
    uom: "pcs",
    source_type: "BUY",
    tracking_type: "LOT" as "SERIAL" | "LOT" | "BULK",
    drawing_code: "",
    is_critical: true,
    requires_serial: false,
    notes: "",
  });
  const [ecoForm, setEcoForm] = useState({
    target_revision: "",
    title: "",
    reason: "",
    change_summary: "",
    effectivity_type: "IMMEDIATE",
    effectivity_value: "",
  });
  const [verifyNote, setVerifyNote] = useState("");

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["factory", "device", "model", id] });
    qc.invalidateQueries({ queryKey: ["factory", "device", "models"] });
  };

  const addRevMut = useMutation({
    mutationFn: () =>
      api("/api/factory/device/models", {
        method: "POST",
        idempotent: true,
        json: {
          kind: "revision",
          model_id: id,
          ...revForm,
          clone_from_revision_id: revForm.clone_from_revision_id || null,
        },
      }),
    onSuccess: () => {
      setRevForm({ revision: "", firmware_version: "v1.0.0", dmr_summary: "", clone_from_revision_id: "" });
      setShowAddRev(false);
      refresh();
    },
  });

  const addBomMut = useMutation({
    mutationFn: () =>
      api("/api/factory/device/models", {
        method: "POST",
        idempotent: true,
        json: {
          kind: "bom_line",
          ...bomForm,
          qty_per_unit: Number(bomForm.qty_per_unit),
        },
      }),
    onSuccess: () => {
      setBomForm({ ...bomForm, component_item_id: "", qty_per_unit: "1", drawing_code: "", notes: "" });
      setShowAddBom(false);
      refresh();
    },
  });

  const addEcoMut = useMutation({
    mutationFn: () =>
      api("/api/factory/device/ecos", {
        method: "POST",
        idempotent: true,
        json: { model_id: id, ...ecoForm },
      }),
    onSuccess: () => {
      setEcoForm({ target_revision: "", title: "", reason: "", change_summary: "", effectivity_type: "IMMEDIATE", effectivity_value: "" });
      setShowAddEco(false);
      refresh();
    },
  });

  const m = detail.data;
  const draftRevs = m?.revisions.filter((r) => r.status === "DRAFT") ?? [];

  return (
    <Card
      title={m ? `Hồ sơ thiết kế gốc (DMR) & ECO: ${m.code} — ${m.name}` : "Đang tải model…"}
      actions={<Button variant="ghost" onClick={onClose}>Đóng</Button>}
    >
      <ErrorNote error={detail.error} />
      {m && (
        <div className="flex flex-col gap-4 text-xs">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 rounded-xl bg-slate-50 dark:bg-slate-800/50 p-3">
            <div><span className="text-slate-400">Nhóm máy:</span> <b>{MODEL_CATEGORY_LABELS[m.category] ?? m.category}</b></div>
            <div><span className="text-slate-400">Phòng chủ quản:</span> <b>{m.org_unit_name}</b></div>
            <div><span className="text-slate-400">Bảo hành tiêu chuẩn:</span> <b>{m.warranty_months} tháng</b></div>
            <div><span className="text-slate-400">Giờ chạy lão hóa (Burn-in):</span> <b>{m.required_burn_in_hours} giờ</b></div>
            {Array.isArray(m.accessories_standard) && m.accessories_standard.length > 0 && (
              <div className="col-span-2 md:col-span-4 pt-1 border-t border-slate-200/70 dark:border-slate-700/60">
                <span className="text-slate-400">Phụ kiện tiêu chuẩn đi kèm khi bàn giao:</span>{" "}
                <b>{m.accessories_standard.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" · ")}</b>
              </div>
            )}
          </div>

          {canManage && (showAddRev || (showAddBom && draftRevs.length > 0)) && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {showAddRev && (
                <form
                  className="rounded-xl border border-slate-200 dark:border-slate-800 p-3 flex flex-col gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    addRevMut.mutate();
                  }}
                >
                  <div className="flex items-center justify-between">
                    <div className="font-bold text-slate-700 dark:text-slate-200">+ Tạo phiên bản thiết kế (Model Revision / DMR)</div>
                    <Button type="button" variant="ghost" onClick={() => setShowAddRev(false)}>Đóng</Button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="Ký hiệu Revision (A, B, C…) *">
                      <input className={inputClass} value={revForm.revision} onChange={(e) => setRevForm({ ...revForm, revision: e.target.value })} required placeholder="A" />
                    </Field>
                    <Field label="Phiên bản Firmware">
                      <input className={inputClass} value={revForm.firmware_version} onChange={(e) => setRevForm({ ...revForm, firmware_version: e.target.value })} placeholder="v1.0.0" />
                    </Field>
                  </div>
                  <Field label="Sao chép BOM từ phiên bản trước (tùy chọn)">
                    <select className={inputClass} value={revForm.clone_from_revision_id} onChange={(e) => setRevForm({ ...revForm, clone_from_revision_id: e.target.value })}>
                      <option value="">-- Khởi tạo BOM mới --</option>
                      {m.revisions.map((r) => (
                        <option key={r.id} value={r.id}>Rev {r.revision} ({r.bom_lines.length} dòng BOM)</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Tóm tắt hồ sơ DMR (Bản vẽ cơ khí, sơ đồ mạch, quy trình kiểm chuẩn) *">
                    <input className={inputClass} value={revForm.dmr_summary} onChange={(e) => setRevForm({ ...revForm, dmr_summary: e.target.value })} required placeholder="Hồ sơ DMR phát hành lần đầu / cập nhật theo ECO..." />
                  </Field>
                  <div>
                    <Button type="submit" disabled={addRevMut.isPending}>Tạo Revision DMR</Button>
                    <ErrorNote error={addRevMut.error} />
                  </div>
                </form>
              )}

              {showAddBom && draftRevs.length > 0 && (
                <form
                  className="rounded-xl border border-slate-200 dark:border-slate-800 p-3 flex flex-col gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    addBomMut.mutate();
                  }}
                >
                  <div className="flex items-center justify-between">
                    <div className="font-bold text-slate-700 dark:text-slate-200">+ Thêm linh kiện vào cấu trúc BOM 4 trạm (Bản nháp DMR)</div>
                    <Button type="button" variant="ghost" onClick={() => setShowAddBom(false)}>Đóng</Button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="Phiên bản DMR (Nháp) *">
                      <select className={inputClass} value={bomForm.revision_id} onChange={(e) => setBomForm({ ...bomForm, revision_id: e.target.value })} required>
                        <option value="">-- Chọn Revision --</option>
                        {draftRevs.map((r) => <option key={r.id} value={r.id}>Rev {r.revision}</option>)}
                      </select>
                    </Field>
                    <Field label="Trạm lắp ráp *">
                      <select className={inputClass} value={bomForm.station_code} onChange={(e) => setBomForm({ ...bomForm, station_code: e.target.value })}>
                        {Object.entries(STATION_LABELS)
                          .filter(([k]) => k !== "FIELD_SERVICE")
                          .map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </select>
                    </Field>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div className="col-span-2">
                      <Field label="Linh kiện / Vật tư *">
                        <select
                          className={inputClass}
                          value={bomForm.component_item_id}
                          onChange={(e) => {
                            const it = opts.data?.items.find((x) => x.id === e.target.value);
                            setBomForm({ ...bomForm, component_item_id: e.target.value, uom: it?.base_uom ?? bomForm.uom });
                          }}
                          required
                        >
                          <option value="">-- Chọn linh kiện --</option>
                          {opts.data?.items.map((it) => (
                            <option key={it.id} value={it.id}>{it.code} — {it.name} ({it.base_uom})</option>
                          ))}
                        </select>
                      </Field>
                    </div>
                    <Field label="Định mức / máy *">
                      <input type="number" step="0.01" className={inputClass} value={bomForm.qty_per_unit} onChange={(e) => setBomForm({ ...bomForm, qty_per_unit: e.target.value })} required />
                    </Field>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <Field label="Nguồn cung ứng">
                      <select className={inputClass} value={bomForm.source_type} onChange={(e) => setBomForm({ ...bomForm, source_type: e.target.value })}>
                        <option value="BUY">BUY — Mua thương mại</option>
                        <option value="SUBCONTRACT">SUBCONTRACT — Gia công CNC/PCB</option>
                        <option value="MAKE">MAKE — Tự chế tạo</option>
                      </select>
                    </Field>
                    <Field label="Cấp độ truy vết DHR">
                      <select
                        className={inputClass}
                        value={bomForm.tracking_type}
                        onChange={(e) => {
                          const t = e.target.value as "SERIAL" | "LOT" | "BULK";
                          setBomForm({ ...bomForm, tracking_type: t, requires_serial: t === "SERIAL" });
                        }}
                      >
                        <option value="SERIAL">SERIAL — Quét S/N từng cụm</option>
                        <option value="LOT">LOT — Theo lô nhập kho</option>
                        <option value="BULK">BULK — Vật tư phụ / ốc vít</option>
                      </select>
                    </Field>
                    <Field label="Mã bản vẽ cơ khí / PCB">
                      <input
                        className={`${inputClass} font-mono`}
                        value={bomForm.drawing_code}
                        onChange={(e) => setBomForm({ ...bomForm, drawing_code: e.target.value })}
                        placeholder="VD: DRW-EZ32-01"
                      />
                    </Field>
                  </div>
                  <div className="flex items-center gap-4 pt-1">
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input type="checkbox" checked={bomForm.is_critical} onChange={(e) => setBomForm({ ...bomForm, is_critical: e.target.checked })} />
                      <span>Linh kiện trọng yếu (Bắt buộc trong DHR)</span>
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={bomForm.requires_serial}
                        onChange={(e) =>
                          setBomForm({
                            ...bomForm,
                            requires_serial: e.target.checked,
                            tracking_type: e.target.checked ? "SERIAL" : "LOT",
                          })
                        }
                      />
                      <span>Bắt buộc quét Serial linh kiện</span>
                    </label>
                  </div>
                  <div>
                    <Button type="submit" disabled={addBomMut.isPending}>Thêm dòng BOM</Button>
                    <ErrorNote error={addBomMut.error} />
                  </div>
                </form>
              )}
            </div>
          )}

          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="font-bold text-sm">Các phiên bản thiết kế DMR ({m.revisions.length})</div>
              {canManage && (
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="ghost" onClick={() => setShowAddRev((v) => !v)}>
                    {showAddRev ? "Đóng form Revision" : "+ Tạo Revision DMR"}
                  </Button>
                  {draftRevs.length > 0 && (
                    <Button variant="ghost" onClick={() => setShowAddBom((v) => !v)}>
                      {showAddBom ? "Đóng form BOM" : "+ Thêm linh kiện vào BOM"}
                    </Button>
                  )}
                </div>
              )}
            </div>
            {m.revisions.map((rev) => (
              <div key={rev.id} className="rounded-xl border border-slate-200 dark:border-slate-800 p-3 flex flex-col gap-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold text-sm text-sky-700 dark:text-sky-400">Revision {rev.revision}</span>
                    <StatusBadge status={REVISION_STATUS[rev.status]?.[0] ?? "PENDING_QC"} label={REVISION_STATUS[rev.status]?.[1] ?? rev.status} />
                    {rev.firmware_version && <span className="px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 font-mono">FW: {rev.firmware_version}</span>}
                    {rev.eco_code && <span className="px-2 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 font-mono">ECO: {rev.eco_code}</span>}
                  </div>
                  <span className="text-slate-400">{rev.released_at ? `Phát hành: ${fmtDate(rev.released_at)} (${rev.released_by_name ?? ""})` : "Chưa phát hành"}</span>
                </div>
                <div className="text-slate-600 dark:text-slate-300">{rev.dmr_summary}</div>
                {rev.bom_lines.length > 0 && (
                  <Table head={["#", "Trạm lắp ráp", "Mã linh kiện", "Tên linh kiện", "Nguồn / Bản vẽ", "Định mức", "Truy vết DHR"]}>
                    {rev.bom_lines.map((bl) => (
                      <tr key={bl.id}>
                        <td className="py-1.5 pr-2 font-mono">{bl.line_no}</td>
                        <td className="py-1.5 pr-2">{STATION_LABELS[bl.station_code] ?? bl.station_code}</td>
                        <td className="py-1.5 pr-2 font-mono font-semibold">{bl.item_code}</td>
                        <td className="py-1.5 pr-2">{bl.item_name}</td>
                        <td className="py-1.5 pr-2 font-mono text-[11px]">
                          <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800">{bl.source_type}</span>
                          {bl.drawing_code ? ` · ${bl.drawing_code}` : ""}
                        </td>
                        <td className="py-1.5 pr-2 font-mono">{fmtQty(bl.qty_per_unit)} {bl.uom}</td>
                        <td className="py-1.5 pr-2">
                          <span className="font-semibold">{bl.tracking_type ?? (bl.requires_serial ? "SERIAL" : "LOT")}</span>
                          <span className="text-slate-400"> ({bl.is_critical ? "Bắt buộc" : "Tùy chọn"})</span>
                        </td>
                      </tr>
                    ))}
                  </Table>
                )}
                <ActionBar
                  endpoint={`/api/factory/device/revisions/${rev.id}/actions`}
                  version={rev.version}
                  actions={rev.actions}
                  labels={REV_ACTION_LABELS}
                  onDone={refresh}
                />
              </div>
            ))}
          </div>

          <div className="border-t border-slate-200 dark:border-slate-800 pt-3 flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="font-bold text-sm">Kiểm soát thay đổi kỹ thuật (Engineering Change Orders — ECO)</div>
              {canEcoPropose && (
                <Button variant="ghost" onClick={() => setShowAddEco((v) => !v)}>
                  {showAddEco ? "Đóng form ECO" : "+ Tạo phiếu ECO"}
                </Button>
              )}
            </div>
            {canEcoPropose && showAddEco && (
              <form
                className="grid grid-cols-1 md:grid-cols-4 gap-2 rounded-xl border border-slate-200 dark:border-slate-800 p-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  addEcoMut.mutate();
                }}
              >
                <Field label="Phiên bản DMR đích *">
                  <input className={inputClass} value={ecoForm.target_revision} onChange={(e) => setEcoForm({ ...ecoForm, target_revision: e.target.value })} required placeholder="Ví dụ: B" />
                </Field>
                <div className="md:col-span-2">
                  <Field label="Tiêu đề yêu cầu thay đổi kỹ thuật (ECO) *">
                    <input className={inputClass} value={ecoForm.title} onChange={(e) => setEcoForm({ ...ecoForm, title: e.target.value })} required placeholder="Nâng cấp cụm tản nhiệt Peltier & mạch công suất..." />
                  </Field>
                </div>
                <Field label="Hiệu lực áp dụng">
                  <select className={inputClass} value={ecoForm.effectivity_type} onChange={(e) => setEcoForm({ ...ecoForm, effectivity_type: e.target.value })}>
                    <option value="IMMEDIATE">Tức thời khi ban hành</option>
                    <option value="FROM_SERIAL">Từ số Serial chỉ định</option>
                    <option value="FROM_DATE">Từ ngày hiệu lực</option>
                  </select>
                </Field>
                <div className="md:col-span-2">
                  <Field label="Lý do thay đổi *">
                    <input className={inputClass} value={ecoForm.reason} onChange={(e) => setEcoForm({ ...ecoForm, reason: e.target.value })} required placeholder="Tăng tốc độ gia nhiệt từ 3.5°C/s lên 4.5°C/s..." />
                  </Field>
                </div>
                <div className="md:col-span-2">
                  <Field label="Tóm tắt nội dung thay đổi kỹ thuật *">
                    <input className={inputClass} value={ecoForm.change_summary} onChange={(e) => setEcoForm({ ...ecoForm, change_summary: e.target.value })} required placeholder="Thay cảm biến PT1000 và cập nhật thuật toán PID..." />
                  </Field>
                </div>
                <div className="md:col-span-4 flex items-center gap-2">
                  <Button type="submit" disabled={addEcoMut.isPending}>+ Tạo phiếu ECO</Button>
                  <ErrorNote error={addEcoMut.error} />
                </div>
              </form>
            )}

            {m.ecos.map((eco) => (
              <div key={eco.id} className="rounded-xl border border-slate-200 dark:border-slate-800 p-3 flex flex-col gap-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold text-sky-700 dark:text-sky-400">{eco.code}</span>
                    <span className="font-semibold">{eco.title}</span>
                    <span className="px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 font-mono">Đích: Rev {eco.target_revision}</span>
                  </div>
                  <StatusBadge status={ECO_STATUS[eco.status]?.[0] ?? "PENDING_QC"} label={ECO_STATUS[eco.status]?.[1] ?? eco.status} />
                </div>
                <div className="text-slate-600 dark:text-slate-300">
                  <b>Lý do:</b> {eco.reason} · <b>Nội dung:</b> {eco.change_summary}
                </div>
                {["DRAFT", "IMPACT_ASSESSMENT"].includes(eco.status) && canEcoPropose && (
                  <EcoImpactEditor eco={eco} onDone={refresh} />
                )}
                {eco.status === "IMPLEMENTED" && (
                  <Field label="Ghi chú xác minh sau triển khai (Bắt buộc trước khi Đóng ECO)">
                    <input
                      className={inputClass}
                      value={verifyNote}
                      onChange={(e) => setVerifyNote(e.target.value)}
                      placeholder="Đã kiểm tra 3 máy đầu tiên lắp theo Rev mới đạt FQC..."
                    />
                  </Field>
                )}
                <ActionBar
                  endpoint={`/api/factory/device/ecos/${eco.id}/actions`}
                  version={eco.version}
                  actions={eco.actions}
                  labels={ECO_ACTION_LABELS}
                  extraPayload={eco.status === "IMPLEMENTED" ? { verification_note: verifyNote } : undefined}
                  onDone={refresh}
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

export function ModelsEcoView({ canManage, canEcoPropose }: { canManage: boolean; canEcoPropose: boolean }) {
  const qc = useQueryClient();
  const opts = useDeviceOptions();
  const models = useQuery({
    queryKey: ["factory", "device", "models"],
    queryFn: () =>
      api<
        {
          id: string;
          code: string;
          name: string;
          org_unit_name: string;
          category: string;
          current_revision: string | null;
          current_firmware: string | null;
          warranty_months: number;
          required_burn_in_hours: number;
          unit_count: number;
          status: string;
        }[]
      >("/api/factory/device/models"),
  });

  const [creating, setCreating] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState({
    code: "",
    name: "",
    org_unit_id: "",
    category: "THERMAL_CYCLER",
    warranty_months: "12",
    required_burn_in_hours: "48",
    accessories_text: "01 Dây nguồn AC chuẩn C13\n01 Sách hướng dẫn sử dụng Tiếng Việt\n01 Biên bản hiệu chuẩn xuất xưởng",
    description: "",
  });

  const createMut = useMutation({
    mutationFn: () =>
      api("/api/factory/device/models", {
        method: "POST",
        idempotent: true,
        json: {
          ...form,
          code: form.code.trim() || undefined,
          warranty_months: Number(form.warranty_months),
          required_burn_in_hours: Number(form.required_burn_in_hours),
          accessories_standard: form.accessories_text
            .split(/\r?\n/)
            .map((s) => s.trim())
            .filter(Boolean),
        },
      }),
    onSuccess: () => {
      setCreating(false);
      qc.invalidateQueries({ queryKey: ["factory", "device", "models"] });
    },
  });

  return (
    <div className="flex flex-col gap-3">
      {selectedId && (
        <ModelDetailPanel
          key={selectedId}
          id={selectedId}
          canManage={canManage}
          canEcoPropose={canEcoPropose}
          onClose={() => setSelectedId(null)}
        />
      )}

      {creating && canManage && (
        <Card title="Khai báo Model thiết bị mới">
          <form
            className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs"
            onSubmit={(e) => {
              e.preventDefault();
              createMut.mutate();
            }}
          >
            <Field label="Phòng Kỹ thuật – Công nghệ *">
              <select className={inputClass} value={form.org_unit_id} onChange={(e) => setForm({ ...form, org_unit_id: e.target.value })} required>
                <option value="">-- Chọn phòng --</option>
                {opts.data?.units.map((u) => <option key={u.id} value={u.id}>{u.code} — {u.name}</option>)}
              </select>
            </Field>
            <Field label="Mã Model (để trống tự cấp)">
              <input className={inputClass} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="Ví dụ: QPCR48" />
            </Field>
            <Field label="Tên Model thiết bị *">
              <input className={inputClass} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required placeholder="Máy Real-time PCR 48 giếng ABT..." />
            </Field>
            <Field label="Nhóm thiết bị">
              <select className={inputClass} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                {Object.entries(MODEL_CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
            <Field label="Thời hạn bảo hành (tháng)">
              <input type="number" className={inputClass} value={form.warranty_months} onChange={(e) => setForm({ ...form, warranty_months: e.target.value })} />
            </Field>
            <Field label="Giờ chạy lão hóa bắt buộc (Burn-in)">
              <input type="number" className={inputClass} value={form.required_burn_in_hours} onChange={(e) => setForm({ ...form, required_burn_in_hours: e.target.value })} />
            </Field>
            <div className="md:col-span-3">
              <Field label="Danh mục phụ kiện tiêu chuẩn đi kèm (Mỗi dòng 1 phụ kiện — tự động nạp vào Biên bản bàn giao)">
                <textarea
                  rows={2}
                  className={inputClass}
                  value={form.accessories_text}
                  onChange={(e) => setForm({ ...form, accessories_text: e.target.value })}
                />
              </Field>
            </div>
            <div className="md:col-span-3 flex items-center gap-2">
              <Button type="submit" disabled={createMut.isPending}>Lưu Model thiết bị</Button>
              <Button variant="ghost" onClick={() => setCreating(false)}>Hủy</Button>
              <ErrorNote error={createMut.error} />
            </div>
          </form>
        </Card>
      )}

      <Card
        title="Danh mục Model Thiết bị, Hồ sơ DMR & Thay đổi Kỹ thuật (ECO)"
        actions={canManage && !creating ? <Button onClick={() => setCreating(true)}>+ Model thiết bị</Button> : null}
      >
        <ErrorNote error={models.error} />
        {models.data?.length === 0 && <Empty>Chưa có model thiết bị nào được khai báo.</Empty>}
        {models.data && models.data.length > 0 && (
          <Table head={["Mã Model", "Tên thiết bị", "Nhóm máy", "Rev hiện hành", "Firmware", "Burn-in chuẩn", "Bảo hành", "Số máy (Serial)", "Trạng thái"]}>
            {models.data.map((m) => (
              <tr key={m.id} className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50" onClick={() => setSelectedId(m.id)}>
                <td className="py-2 pr-3 font-mono font-bold text-sky-700 dark:text-sky-400">{m.code}</td>
                <td className="py-2 pr-3 font-semibold">{m.name}</td>
                <td className="py-2 pr-3">{MODEL_CATEGORY_LABELS[m.category] ?? m.category}</td>
                <td className="py-2 pr-3 font-mono font-bold">{m.current_revision ? `Rev ${m.current_revision}` : "—"}</td>
                <td className="py-2 pr-3 font-mono">{m.current_firmware ?? "—"}</td>
                <td className="py-2 pr-3 font-mono">{m.required_burn_in_hours}h</td>
                <td className="py-2 pr-3">{m.warranty_months} tháng</td>
                <td className="py-2 pr-3 font-mono">{m.unit_count}</td>
                <td className="py-2 pr-3">
                  <StatusBadge status={MODEL_STATUS[m.status]?.[0] ?? "PENDING_QC"} label={MODEL_STATUS[m.status]?.[1] ?? m.status} />
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}

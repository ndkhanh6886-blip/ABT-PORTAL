"use client";

import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, fmtDate, fmtQty } from "../api";
import { Button, Card, Empty, ErrorNote, Field, inputClass, StatusBadge, Table } from "../ui";
import { useRdContext } from "./shared";

const SAMPLE_STATUS: Record<string, [string, string]> = {
  STORED: ["RELEASED", "Đang lưu lạnh"],
  IN_USE: ["PENDING_QC", "Đang rã đông / Sử dụng"],
  DEPLETED: ["EXPIRED", "Đã dùng hết"],
  DISPOSED: ["REJECTED", "Đã tiêu hủy"],
  TRANSFERRED: ["ON_HOLD", "Đã chuyển giao"],
};

const SAMPLE_TYPE_LABEL: Record<string, string> = {
  BLOOD: "Máu toàn phần",
  SERUM_PLASMA: "Huyết thanh / Huyết tương",
  SWAB: "Dịch phết (Swab)",
  DNA: "DNA tinh sạch",
  RNA: "RNA tinh sạch",
  STRAIN: "Chủng vi sinh / Virus chuẩn",
  PLASMID: "Plasmid chứng dương",
  CONTROL_PANEL: "Panel ngoại kiểm / Chuẩn quốc tế",
  OTHER: "Mẫu khác",
};

interface SampleDetail {
  id: string;
  code: string;
  name: string;
  sample_type: string;
  source: string;
  consent_ref: string | null;
  biosafety_level: string;
  target_pathogen: string | null;
  reference_ct: number | null;
  warehouse_code: string | null;
  location_code: string | null;
  temperature_condition: string | null;
  box_position: string | null;
  initial_volume: number;
  current_volume: number;
  uom: string;
  freeze_thaw_count: number;
  max_freeze_thaw: number;
  thaw_warning: boolean;
  status: string;
  events: {
    id: string;
    event_type: string;
    volume_delta: number;
    from_location_code: string | null;
    to_location_code: string | null;
    experiment_code: string | null;
    is_quantitative: boolean;
    reason: string | null;
    performed_by_name: string | null;
    performed_at: string;
  }[];
}

function SamplePanel({ id, canManage, onClose }: { id: string; canManage: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const detail = useQuery({ queryKey: ["factory", "rd", "sample", id], queryFn: () => api<SampleDetail>(`/api/factory/rd/samples/${id}`) });
  const [useVol, setUseVol] = useState("");
  const [isQuant, setIsQuant] = useState(true);
  const [reason, setReason] = useState("");
  const [disposeReason, setDisposeReason] = useState("");

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["factory", "rd", "sample", id] });
    qc.invalidateQueries({ queryKey: ["factory", "rd", "samples"] });
  };

  const eventMut = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api(`/api/factory/rd/samples/${id}`, {
        method: "POST",
        json: body,
      }),
    onSuccess: () => {
      setUseVol("");
      setReason("");
      setDisposeReason("");
      refresh();
    },
  });

  const s = detail.data;
  return (
    <Card title={s ? `Mẫu sinh học ${s.code} — ${s.name}` : "Chi tiết mẫu Biobank"} actions={<Button variant="ghost" onClick={onClose}>Đóng</Button>}>
      <ErrorNote error={detail.error ?? eventMut.error} />
      {s && (
        <div className="flex flex-col gap-3 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={SAMPLE_STATUS[s.status]?.[0] ?? "QUARANTINE"} label={SAMPLE_STATUS[s.status]?.[1] ?? s.status} />
            <span className="px-2 py-0.5 rounded bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 font-bold">{s.biosafety_level}</span>
            <span>· Loại: <b>{SAMPLE_TYPE_LABEL[s.sample_type] ?? s.sample_type}</b></span>
            <span>· Nguồn: <b>{s.source}</b></span>
            {s.target_pathogen && <span>· Tác nhân đích: <b>{s.target_pathogen}</b></span>}
            {s.reference_ct != null && <span>· Ct tham chiếu: <b className="font-mono">{s.reference_ct}</b></span>}
            <span>· Vị trí lưu: <b className="font-mono">{s.warehouse_code || "—"} / {s.location_code || "—"} ({s.temperature_condition || "RT"}) · {s.box_position || "—"}</b></span>
          </div>

          <div className="grid gap-2 sm:grid-cols-3 p-3 rounded-xl border border-slate-200 dark:border-slate-800">
            <div>
              <div className="text-slate-500">Thể tích hiện còn / Ban đầu</div>
              <div className="text-base font-bold font-mono">{fmtQty(s.current_volume)} / {fmtQty(s.initial_volume)} {s.uom}</div>
            </div>
            <div>
              <div className="text-slate-500">Số chu kỳ rã đông (Freeze-Thaw)</div>
              <div className={`text-base font-bold font-mono ${s.thaw_warning ? "text-rose-600" : ""}`}>
                {s.freeze_thaw_count} / tối đa {s.max_freeze_thaw} lần
              </div>
              {s.thaw_warning && <div className="text-[11px] text-rose-600 font-semibold">Đã vượt ngưỡng rã đông — chặn dùng cho thí nghiệm định lượng!</div>}
            </div>
            {canManage && !["DEPLETED", "DISPOSED", "TRANSFERRED"].includes(s.status) && (
              <div className="flex flex-wrap items-center gap-2">
                {s.status === "STORED" && (
                  <Button onClick={() => eventMut.mutate({ event_type: "THAW", reason: "Lấy mẫu ra rã đông" })} disabled={eventMut.isPending}>
                    Rã đông mẫu (+1 chu kỳ)
                  </Button>
                )}
                {s.status === "IN_USE" && (
                  <Button variant="ghost" onClick={() => eventMut.mutate({ event_type: "REFREEZE", reason: "Cấp đông lại vào tủ lưu" })} disabled={eventMut.isPending}>
                    Cấp đông lại (STORED)
                  </Button>
                )}
              </div>
            )}
          </div>

          {canManage && !["DEPLETED", "DISPOSED", "TRANSFERRED"].includes(s.status) && (
            <div className="grid gap-3 lg:grid-cols-2">
              <form
                className="grid gap-2 sm:grid-cols-3 items-end p-3 rounded-xl border border-slate-200 dark:border-slate-800"
                onSubmit={(e) => {
                  e.preventDefault();
                  eventMut.mutate({
                    event_type: "USE",
                    volume_used: Number(useVol),
                    is_quantitative: isQuant,
                    reason: reason || "Trích mẫu thực hiện thí nghiệm",
                  });
                }}
              >
                <Field label={`Thể tích trích dùng (${s.uom}) *`}>
                  <input type="number" step="any" min="0.01" className={inputClass} value={useVol} onChange={(e) => setUseVol(e.target.value)} required />
                </Field>
                <Field label="Mục đích sử dụng">
                  <select className={inputClass} value={isQuant ? "QUANT" : "QUAL"} onChange={(e) => setIsQuant(e.target.value === "QUANT")}>
                    <option value="QUANT">Định lượng / Xác định LoD (Kiểm tra ngưỡng rã đông)</option>
                    <option value="QUAL">Định tính / Sơ bộ</option>
                  </select>
                </Field>
                <Button type="submit" disabled={eventMut.isPending}>Ghi nhận sử dụng mẫu</Button>
              </form>

              <form
                className="flex gap-2 items-end p-3 rounded-xl border border-rose-200 dark:border-rose-900/60"
                onSubmit={(e) => {
                  e.preventDefault();
                  eventMut.mutate({ event_type: "DISPOSE", reason: disposeReason });
                }}
              >
                <div className="flex-1">
                  <Field label="Lý do tiêu hủy mẫu sinh học (hấp tiệt trùng / hết hạn) *">
                    <input className={inputClass} value={disposeReason} onChange={(e) => setDisposeReason(e.target.value)} required placeholder="Nhập biên bản / lý do hủy mẫu..." />
                  </Field>
                </div>
                <Button type="submit" variant="ghost" disabled={eventMut.isPending}>Tiêu hủy mẫu</Button>
              </form>
            </div>
          )}

          <div>
            <b className="block mb-1">Chuỗi hành trình mẫu (Chain of Custody — {s.events.length} sự kiện)</b>
            <Table head={["Thời điểm", "Sự kiện", "Biến động thể tích", "Định lượng?", "Diễn giải / Lý do", "Người thực hiện"]}>
              {s.events.map((ev) => (
                <tr key={ev.id}>
                  <td className="py-2 pr-3 font-mono">{fmtDate(ev.performed_at)}</td>
                  <td className="py-2 pr-3 font-mono font-bold">{ev.event_type}</td>
                  <td className="py-2 pr-3 font-mono">{ev.volume_delta ? `${ev.volume_delta > 0 ? "+" : ""}${fmtQty(ev.volume_delta)} ${s.uom}` : "—"}</td>
                  <td className="py-2 pr-3">{ev.is_quantitative ? "Có (LoD/Quant)" : "—"}</td>
                  <td className="py-2 pr-3">{ev.reason || "—"}</td>
                  <td className="py-2 pr-3">{ev.performed_by_name}</td>
                </tr>
              ))}
            </Table>
          </div>
        </div>
      )}
    </Card>
  );
}

export function SamplesView({ canManage }: { canManage: boolean }) {
  const qc = useQueryClient();
  const ctx = useRdContext("rd.view");
  const [selected, setSelected] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const [orgUnitId, setOrgUnitId] = useState("");
  const [sampleType, setSampleType] = useState("CONTROL_PANEL");
  const [name, setName] = useState("");
  const [source, setSource] = useState("");
  const [bsl, setBsl] = useState("BSL2");
  const [pathogen, setPathogen] = useState("");
  const [refCt, setRefCt] = useState("");
  const [whId, setWhId] = useState("");
  const [locId, setLocId] = useState("");
  const [boxPos, setBoxPos] = useState("");
  const [vol, setVol] = useState("500");
  const [uom, setUom] = useState("µL");
  const [maxThaw, setMaxThaw] = useState("3");

  const list = useQuery({ queryKey: ["factory", "rd", "samples"], queryFn: () => api<any[]>("/api/factory/rd/samples") });

  const activeWhId = whId || ctx.data?.warehouses[0]?.id || "";
  const whLocations = (ctx.data?.locations ?? []).filter((l) => l.warehouse_id === activeWhId);

  const createMut = useMutation({
    mutationFn: () =>
      api("/api/factory/rd/samples", {
        method: "POST",
        idempotent: true,
        json: {
          org_unit_id: orgUnitId || ctx.data?.units[0]?.id,
          sample_type: sampleType,
          name,
          source,
          biosafety_level: bsl,
          target_pathogen: pathogen || null,
          reference_ct: refCt ? Number(refCt) : null,
          warehouse_id: activeWhId || null,
          location_id: locId || whLocations[0]?.id || null,
          box_position: boxPos || null,
          initial_volume: Number(vol),
          uom,
          max_freeze_thaw: Number(maxThaw),
        },
      }),
    onSuccess: () => {
      setAdding(false);
      setName("");
      setSource("");
      setPathogen("");
      qc.invalidateQueries({ queryKey: ["factory", "rd", "samples"] });
    },
  });

  return (
    <div className="flex flex-col gap-3">
      {selected && <SamplePanel key={selected} id={selected} canManage={canManage} onClose={() => setSelected(null)} />}

      <Card
        title="Ngân hàng Mẫu sinh học & Chủng chuẩn (Biobank — Kiểm soát vị trí -80°C & số lần rã đông)"
        actions={canManage ? <Button onClick={() => setAdding(!adding)}>+ Tiếp nhận mẫu sinh học</Button> : undefined}
      >
        <ErrorNote error={list.error ?? createMut.error} />

        {adding && (
          <form
            className="grid gap-3 sm:grid-cols-4 p-3 mb-3 rounded-xl border border-sky-200 dark:border-sky-900 bg-sky-50/40 dark:bg-sky-950/20"
            onSubmit={(e) => {
              e.preventDefault();
              createMut.mutate();
            }}
          >
            <Field label="Phòng quản lý *">
              <select className={inputClass} value={orgUnitId || ctx.data?.units[0]?.id || ""} onChange={(e) => setOrgUnitId(e.target.value)} required>
                {ctx.data?.units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </Field>
            <Field label="Loại mẫu *">
              <select className={inputClass} value={sampleType} onChange={(e) => setSampleType(e.target.value)}>
                {Object.entries(SAMPLE_TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
            <Field label="Mức an toàn sinh học *">
              <select className={inputClass} value={bsl} onChange={(e) => setBsl(e.target.value)}>
                <option value="BSL1">BSL-1</option>
                <option value="BSL2">BSL-2</option>
                <option value="BSL3">BSL-3</option>
              </select>
            </Field>
            <Field label="Giới hạn số lần rã đông *">
              <input type="number" min={1} max={20} className={inputClass} value={maxThaw} onChange={(e) => setMaxThaw(e.target.value)} required />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Tên mẫu / Mã chủng chuẩn *">
                <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="VD: WHO International Standard HBV DNA NIBSC 10/264" required />
              </Field>
            </div>
            <Field label="Nguồn cung cấp / Bệnh viện *">
              <input className={inputClass} value={source} onChange={(e) => setSource(e.target.value)} placeholder="NIBSC / ATCC / BV Nhiệt Đới" required />
            </Field>
            <Field label="Tác nhân đích & Ct tham chiếu">
              <div className="flex gap-1">
                <input className={inputClass} value={pathogen} onChange={(e) => setPathogen(e.target.value)} placeholder="HBV, SARS-CoV-2..." />
                <input type="number" step="0.1" className={`${inputClass} w-20`} value={refCt} onChange={(e) => setRefCt(e.target.value)} placeholder="Ct" />
              </div>
            </Field>
            <Field label="Kho lưu trữ">
              <select className={inputClass} value={activeWhId} onChange={(e) => setWhId(e.target.value)}>
                {ctx.data?.warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} — {w.name}</option>)}
              </select>
            </Field>
            <Field label="Tủ / Ngăn lưu (-20°C / -80°C)">
              <select className={inputClass} value={locId || whLocations[0]?.id || ""} onChange={(e) => setLocId(e.target.value)}>
                {whLocations.map((l) => <option key={l.id} value={l.id}>{l.code} ({l.temperature_condition})</option>)}
              </select>
            </Field>
            <Field label="Vị trí Hộp / Ô (Box / Grid)">
              <input className={inputClass} value={boxPos} onChange={(e) => setBoxPos(e.target.value)} placeholder="Box-02 / C4" />
            </Field>
            <div className="flex gap-1 items-end">
              <Field label="Thể tích *">
                <input type="number" step="any" min="1" className={inputClass} value={vol} onChange={(e) => setVol(e.target.value)} required />
              </Field>
              <Field label="ĐVT">
                <input className={`${inputClass} w-16`} value={uom} onChange={(e) => setUom(e.target.value)} required />
              </Field>
            </div>
            <div className="sm:col-span-4 flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setAdding(false)}>Hủy</Button>
              <Button type="submit" disabled={createMut.isPending}>Lưu vào Biobank</Button>
            </div>
          </form>
        )}

        {list.data?.length === 0 && <Empty>Chưa có mẫu sinh học nào trong Biobank.</Empty>}
        {list.data && list.data.length > 0 && (
          <Table head={["Mã mẫu", "Tên mẫu / Chủng", "Loại", "BSL", "Tác nhân (Ct)", "Vị trí lưu lạnh", "Thể tích còn", "Rã đông", "Trạng thái"]}>
            {list.data.map((r) => (
              <tr key={r.id} className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50" onClick={() => setSelected(r.id)}>
                <td className="py-2 pr-3 font-mono font-semibold text-sky-700 dark:text-sky-400">{r.code}</td>
                <td className="py-2 pr-3 font-semibold">{r.name}</td>
                <td className="py-2 pr-3">{SAMPLE_TYPE_LABEL[r.sample_type] ?? r.sample_type}</td>
                <td className="py-2 pr-3 font-mono font-bold text-rose-600">{r.biosafety_level}</td>
                <td className="py-2 pr-3">{r.target_pathogen || "—"}{r.reference_ct != null ? ` (Ct ${r.reference_ct})` : ""}</td>
                <td className="py-2 pr-3 font-mono text-[11px]">
                  {r.location_code || "—"} {r.temperature_condition ? `(${r.temperature_condition}°C)` : ""} {r.box_position ? `· ${r.box_position}` : ""}
                </td>
                <td className="py-2 pr-3 font-mono">{fmtQty(r.current_volume)} / {fmtQty(r.initial_volume)} {r.uom}</td>
                <td className={`py-2 pr-3 font-mono font-semibold ${r.thaw_warning ? "text-rose-600" : ""}`}>
                  {r.freeze_thaw_count}/{r.max_freeze_thaw} {r.thaw_warning && "⚠️"}
                </td>
                <td className="py-2 pr-3">
                  <StatusBadge status={SAMPLE_STATUS[r.status]?.[0] ?? "QUARANTINE"} label={SAMPLE_STATUS[r.status]?.[1] ?? r.status} />
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}

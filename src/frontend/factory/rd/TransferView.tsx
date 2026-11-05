"use client";

import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ActionBar, type AllowedAction } from "../actions";
import { api, fmtDate } from "../api";
import { Button, Card, Empty, ErrorNote, Field, inputClass, StatusBadge, Table } from "../ui";
import { DOMAIN_LABEL, useRdContext } from "./shared";

const TT_STATUS: Record<string, [string, string]> = {
  DRAFT: ["QUARANTINE", "Nháp"],
  SUBMITTED: ["PENDING_QC", "Đã gửi phòng nhận"],
  ACCEPTED: ["RELEASED", "Phòng SX đã ký nhận (Đã sinh QC Spec nháp)"],
  COMPLETED: ["RELEASED", "Hoàn tất chuyển giao (Lô Pilot đạt)"],
};

const SW_STATUS: Record<string, [string, string]> = {
  DRAFT: ["QUARANTINE", "Nháp"],
  RELEASED: ["RELEASED", "Đã ký phát hành (RELEASED)"],
  WITHDRAWN: ["REJECTED", "Đã thu hồi (WITHDRAWN)"],
};

const TT_ACTIONS = {
  submit: "Gửi gói chuyển giao sang Sản xuất",
  return_draft: "Trả lại R&D chỉnh sửa",
  accept: "Ký tiếp nhận chuyển giao công nghệ",
  complete: "Xác nhận hoàn tất (Lô Pilot đạt)",
};

const SW_ACTIONS = {
  release: "Ký phát hành phiên bản phần mềm",
  withdraw: "Thu hồi phiên bản (Withdraw)",
};

/** `section="software"` shows only the software releases (KTCN software tab), without the technology transfer packages. */
export function TransferView({ canManage, canAccept, section = "all" }: { canManage: boolean; canAccept: boolean; section?: "all" | "software" }) {
  const qc = useQueryClient();
  const ctx = useRdContext("rd.view");
  const projects = useQuery({ queryKey: ["factory", "rd", "projects", ""], queryFn: () => api<any[]>("/api/factory/rd/projects") });
  const transfers = useQuery({ queryKey: ["factory", "rd", "transfers"], queryFn: () => api<any[]>("/api/factory/rd/transfers") });
  const swReleases = useQuery({ queryKey: ["factory", "rd", "sw-releases"], queryFn: () => api<any[]>("/api/factory/rd/software-releases") });

  const [addingTt, setAddingTt] = useState(false);
  const [addingSw, setAddingSw] = useState(false);

  // Tech transfer form state
  const [ttProjId, setTtProjId] = useState("");
  const [ttDomain, setTtDomain] = useState("KIT");
  const [ttTargetUnit, setTtTargetUnit] = useState("");
  const [ttTitle, setTtTitle] = useState("");
  const [ttProductItem, setTtProductItem] = useState("");
  const [ttCompCode, setTtCompCode] = useState("MM-2X");
  const [ttCompName, setTtCompName] = useState("Mastermix RT-qPCR 2X");
  const [ttCompQty, setTtCompQty] = useState("1.25");
  const [ttCompUom, setTtCompUom] = useState("mL");
  const [ttStepName, setTtStepName] = useState("Pha phối Mastermix & Chia ống trong tủ sạch Class II");
  const [ttStability, setTtStability] = useState("");
  const [ttValidation, setTtValidation] = useState("");

  // Software release form state
  const [swProjId, setSwProjId] = useState("");
  const [swVersion, setSwVersion] = useState("v1.0.0");
  const [swKind, setSwKind] = useState("ASSAY_CALLER");
  const [swNotes, setSwNotes] = useState("");
  const [swValidation, setSwValidation] = useState("");
  const [swSourceRef, setSwSourceRef] = useState("");

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["factory", "rd", "transfers"] });
    qc.invalidateQueries({ queryKey: ["factory", "rd", "sw-releases"] });
  };

  const createTtMut = useMutation({
    mutationFn: () =>
      api("/api/factory/rd/transfers", {
        method: "POST",
        idempotent: true,
        json: {
          project_id: ttProjId || projects.data?.[0]?.id,
          target_domain: ttDomain,
          target_org_unit_id: ttTargetUnit || ctx.data?.targetUnits[0]?.id,
          title: ttTitle,
          product_item_id: ttProductItem || null,
          bom_specification: [
            { component_code: ttCompCode, component_name: ttCompName, qty_per_kit: Number(ttCompQty), uom: ttCompUom, role: "Core Reagent" },
          ],
          routing_steps: [{ seq: 1, step_name: ttStepName, params: "Nhiệt độ phòng lạnh 4°C", qc_check: "IPQC OD/Ct" }],
          stability_summary: ttStability,
          validation_summary: ttValidation,
          submit_now: true,
        },
      }),
    onSuccess: () => {
      setAddingTt(false);
      setTtTitle("");
      setTtStability("");
      setTtValidation("");
      refresh();
    },
  });

  const createSwMut = useMutation({
    mutationFn: () =>
      api("/api/factory/rd/software-releases", {
        method: "POST",
        idempotent: true,
        json: {
          project_id: swProjId || projects.data?.[0]?.id,
          version_tag: swVersion,
          target_kind: swKind,
          release_notes: swNotes,
          validation_summary: swValidation,
          source_ref: swSourceRef.trim() || null,
        },
      }),
    onSuccess: () => {
      setAddingSw(false);
      setSwNotes("");
      setSwValidation("");
      setSwSourceRef("");
      refresh();
    },
  });

  return (
    <div className="flex flex-col gap-3">
      {/* 1. Technology Transfer Packages */}
      {section === "all" && (
      <Card
        title="Gói Chuyển giao Công nghệ sang Sản xuất (BOM, Routing/SOP, Tiêu chuẩn QC & Độ ổn định)"
        actions={canManage ? <Button onClick={() => setAddingTt(!addingTt)}>+ Lập gói chuyển giao công nghệ</Button> : undefined}
      >
        <ErrorNote error={transfers.error ?? createTtMut.error} />

        {addingTt && (
          <form
            className="grid gap-3 sm:grid-cols-3 p-3 mb-3 rounded-xl border border-sky-200 dark:border-sky-900 bg-sky-50/40 dark:bg-sky-950/20"
            onSubmit={(e) => {
              e.preventDefault();
              createTtMut.mutate();
            }}
          >
            <Field label="Dự án R&D nguồn *">
              <select className={inputClass} value={ttProjId || projects.data?.[0]?.id || ""} onChange={(e) => setTtProjId(e.target.value)} required>
                {projects.data?.map((p) => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
              </select>
            </Field>
            <Field label="Miền sản xuất đích *">
              <select className={inputClass} value={ttDomain} onChange={(e) => setTtDomain(e.target.value)}>
                <option value="KIT">Sản xuất Kit (SX Kit)</option>
                <option value="OLIGO">Tổng hợp Oligo</option>
                <option value="DEVICE">Kỹ thuật - Công nghệ (Thiết bị)</option>
                <option value="SOFTWARE">Phần mềm</option>
              </select>
            </Field>
            <Field label="Phòng tiếp nhận *">
              <select className={inputClass} value={ttTargetUnit || ctx.data?.targetUnits[0]?.id || ""} onChange={(e) => setTtTargetUnit(e.target.value)} required>
                {ctx.data?.targetUnits.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.module_key})</option>)}
              </select>
            </Field>
            <div className="sm:col-span-2">
              <Field label="Tiêu đề gói chuyển giao *">
                <input className={inputClass} value={ttTitle} onChange={(e) => setTtTitle(e.target.value)} placeholder="VD: Hồ sơ chuyển giao Kit Real-time PCR HBV (50 test/hộp)" required />
              </Field>
            </div>
            <Field label="Mã thành phẩm đích (tự sinh QC Spec nháp khi nhận)">
              <select className={inputClass} value={ttProductItem} onChange={(e) => setTtProductItem(e.target.value)}>
                <option value="">— Chọn mã vật tư thành phẩm (nếu có) —</option>
                {ctx.data?.items.map((it) => <option key={it.id} value={it.id}>{it.code} — {it.name}</option>)}
              </select>
            </Field>

            <Field label="Thành phần BOM chính (Mã & Tên) *">
              <div className="flex gap-1">
                <input className={`${inputClass} w-24`} value={ttCompCode} onChange={(e) => setTtCompCode(e.target.value)} required />
                <input className={inputClass} value={ttCompName} onChange={(e) => setTtCompName(e.target.value)} required />
              </div>
            </Field>
            <Field label="Định mức / Kit & ĐVT *">
              <div className="flex gap-1">
                <input type="number" step="any" className={inputClass} value={ttCompQty} onChange={(e) => setTtCompQty(e.target.value)} required />
                <input className={`${inputClass} w-20`} value={ttCompUom} onChange={(e) => setTtCompUom(e.target.value)} required />
              </div>
            </Field>
            <Field label="Công đoạn Routing / SOP chính *">
              <input className={inputClass} value={ttStepName} onChange={(e) => setTtStepName(e.target.value)} required />
            </Field>

            <div className="sm:col-span-3 grid gap-2 sm:grid-cols-2">
              <Field label="Tóm tắt dữ liệu độ ổn định (Real-time / Tăng tốc / Sau mở nắp) *">
                <input className={inputClass} value={ttStability} onChange={(e) => setTtStability(e.target.value)} placeholder="Ổn định 12 tháng ở -20°C, 5 lần rã đông không giảm Ct..." required />
              </Field>
              <Field label="Tóm tắt kết quả thẩm định hiệu năng (LoD, Độ lặp lại, Lâm sàng) *">
                <input className={inputClass} value={ttValidation} onChange={(e) => setTtValidation(e.target.value)} placeholder="LoD95 = 8 copies/rxn, CV nội lô < 2.1%, độ nhạy lâm sàng 99.2%..." required />
              </Field>
            </div>
            <div className="sm:col-span-3 flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setAddingTt(false)}>Hủy</Button>
              <Button type="submit" disabled={createTtMut.isPending}>Tạo & Gửi gói chuyển giao</Button>
            </div>
          </form>
        )}

        {transfers.data?.length === 0 && <Empty>Chưa có gói chuyển giao công nghệ nào.</Empty>}
        {transfers.data && transfers.data.length > 0 && (
          <div className="flex flex-col gap-3">
            {transfers.data.map((t) => (
              <div key={t.id} className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 text-xs flex flex-col gap-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className="font-mono font-bold text-sky-700 dark:text-sky-400">{t.code}</span> — <b>{t.title}</b>
                    <span className="ml-2 text-slate-500">
                      (Dự án <code className="font-mono">{t.project_code}</code> → Phòng nhận: <b>{t.target_org_unit_name}</b> · {DOMAIN_LABEL[t.target_domain] ?? t.target_domain})
                    </span>
                  </div>
                  <StatusBadge status={TT_STATUS[t.status]?.[0] ?? "QUARANTINE"} label={TT_STATUS[t.status]?.[1] ?? t.status} />
                </div>
                <div className="grid gap-2 sm:grid-cols-2 text-[11px] bg-slate-50/50 dark:bg-slate-900/40 p-2.5 rounded-lg">
                  <div><b>Độ ổn định:</b> {t.stability_summary}</div>
                  <div><b>Thẩm định hiệu năng:</b> {t.validation_summary}</div>
                  <div>
                    <b>Cấu trúc BOM chuyển giao:</b>{" "}
                    {Array.isArray(t.bom_specification)
                      ? t.bom_specification.map((b: any) => `${b.component_code} (${b.qty_per_kit} ${b.uom})`).join(", ")
                      : "—"}
                  </div>
                  <div>
                    <b>Tiêu chuẩn QC tự sinh bên QA/QC:</b>{" "}
                    {t.created_qc_spec_code ? (
                      <span className="font-mono font-bold text-emerald-700 dark:text-emerald-400">{t.created_qc_spec_code} (DRAFT)</span>
                    ) : (
                      "Sinh tự động khi phòng nhận ký duyệt"
                    )}
                  </div>
                </div>
                {t.accepted_by_name && (
                  <div className="text-[11px] text-slate-500">
                    Đã ký tiếp nhận bởi <b>{t.accepted_by_name}</b> ({fmtDate(t.accepted_at)})
                    {t.pilot_lot_ref && ` · Lô Pilot đạt: ${t.pilot_lot_ref}`}
                  </div>
                )}
                {(canManage || canAccept) && (
                  <ActionBar
                    endpoint={`/api/factory/rd/transfers/${t.id}/actions`}
                    version={t.version}
                    actions={(t.actions ?? []) as AllowedAction[]}
                    labels={TT_ACTIONS}
                    onDone={refresh}
                  />
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
      )}

      {/* 2. Software Releases (D6) */}
      <Card
        title="Phát hành Phần mềm & Thuật toán Y sinh (IEC 62304 Software Release — D6)"
        actions={canManage ? <Button variant="ghost" onClick={() => setAddingSw(!addingSw)}>+ Tạo bản phát hành phần mềm</Button> : undefined}
      >
        <ErrorNote error={swReleases.error ?? createSwMut.error} />

        {addingSw && (
          <form
            className="grid gap-3 sm:grid-cols-3 p-3 mb-3 rounded-xl border border-slate-200 dark:border-slate-800"
            onSubmit={(e) => {
              e.preventDefault();
              createSwMut.mutate();
            }}
          >
            <Field label="Dự án R&D *">
              <select className={inputClass} value={swProjId || projects.data?.[0]?.id || ""} onChange={(e) => setSwProjId(e.target.value)} required>
                {projects.data?.map((p) => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
              </select>
            </Field>
            <Field label="Phiên bản (Version Tag) *">
              <input className={inputClass} value={swVersion} onChange={(e) => setSwVersion(e.target.value)} placeholder="v1.2.0" required />
            </Field>
            <Field label="Loại phần mềm *">
              <select className={inputClass} value={swKind} onChange={(e) => setSwKind(e.target.value)}>
                <option value="ASSAY_CALLER">Thuật toán phân tích Ct / Assay Caller</option>
                <option value="FIRMWARE">Firmware Thiết bị Lab</option>
                <option value="LIMS_PLUGIN">Module LIMS / MES</option>
                <option value="STANDALONE">Phần mềm độc lập (SaMD)</option>
              </select>
            </Field>
            <div className="sm:col-span-3 grid gap-2 sm:grid-cols-2">
              <Field label="Nội dung phát hành (Release Notes) *">
                <input className={inputClass} value={swNotes} onChange={(e) => setSwNotes(e.target.value)} required />
              </Field>
              <Field label="Kết quả kiểm thử / Thẩm định (Validation Summary) *">
                <input className={inputClass} value={swValidation} onChange={(e) => setSwValidation(e.target.value)} required />
              </Field>
              <Field label="Commit / tag mã nguồn của bản dựng">
                <input className={`${inputClass} font-mono`} placeholder="git: ez32-fw@v1.2.0" value={swSourceRef} onChange={(e) => setSwSourceRef(e.target.value)} />
              </Field>
            </div>
            <div className="sm:col-span-3 flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setAddingSw(false)}>Hủy</Button>
              <Button type="submit" disabled={createSwMut.isPending}>Lưu bản nháp phát hành</Button>
            </div>
          </form>
        )}

        {swReleases.data?.length === 0 && <Empty>Chưa có bản phát hành phần mềm nào.</Empty>}
        {swReleases.data && swReleases.data.length > 0 && (
          <Table head={["Mã", "Dự án", "Phiên bản", "Loại", "Release Notes & Thẩm định", "Người ký phát hành", "Trạng thái", "Thao tác"]}>
            {swReleases.data.map((sr) => (
              <tr key={sr.id}>
                <td className="py-2 pr-3 font-mono font-semibold text-sky-700 dark:text-sky-400">{sr.code}</td>
                <td className="py-2 pr-3 font-mono">{sr.project_code}</td>
                <td className="py-2 pr-3 font-mono font-bold">{sr.version_tag}</td>
                <td className="py-2 pr-3 font-mono">{sr.target_kind}</td>
                <td className="py-2 pr-3">
                  <div>{sr.release_notes}</div>
                  <div className="text-[11px] text-slate-500">Thẩm định: {sr.validation_summary}</div>
                </td>
                <td className="py-2 pr-3">{sr.released_by_name || "—"}</td>
                <td className="py-2 pr-3">
                  <StatusBadge status={SW_STATUS[sr.status]?.[0] ?? "QUARANTINE"} label={SW_STATUS[sr.status]?.[1] ?? sr.status} />
                </td>
                <td className="py-2 pr-3">
                  <ActionBar
                    endpoint={`/api/factory/rd/software-releases/${sr.id}/actions`}
                    version={sr.version}
                    actions={(sr.actions ?? []) as AllowedAction[]}
                    labels={SW_ACTIONS}
                    onDone={refresh}
                  />
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}

"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Download, ExternalLink, FileCheck2, FilePlus2, Paperclip, Pencil, Plus, Trash2 } from "lucide-react";
import { api, fmtDate } from "../api";
import { Button, ErrorNote, inputClass, StatusBadge } from "../ui";
import type { TransferTemplateRow } from "./TransferTemplateModal";

const ITEM_STATUS_META: Record<string, { badge: string; label: string }> = {
  MISSING: { badge: "QUARANTINE", label: "Chưa nộp" },
  SUBMITTED: { badge: "PENDING_QC", label: "Đã nộp" },
  VERIFIED: { badge: "RELEASED", label: "SX/QA đã xác nhận" },
  WAIVED: { badge: "EXPIRED", label: "Miễn trừ" },
};

interface DossierFile {
  id: string;
  item_id: string | null;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  sha256: string;
  doc_label: string | null;
  uploaded_by_name: string | null;
  uploaded_at: string;
}

interface DossierItem {
  id: string;
  seq: number;
  section_code: string;
  section_name: string;
  doc_code: string;
  item_name: string;
  guidance: string | null;
  is_required: boolean;
  doc_ref_code: string | null;
  notes: string | null;
  status: "MISSING" | "SUBMITTED" | "VERIFIED" | "WAIVED";
  verified_by_name: string | null;
  verified_at: string | null;
  files: DossierFile[];
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes < 1024) return `${bytes || 0} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function ChecklistItemCard({
  packageId,
  packageStatus,
  item,
  canManage,
  canAccept,
  onChanged,
}: {
  packageId: string;
  packageStatus: string;
  item: DossierItem;
  canManage: boolean;
  canAccept: boolean;
  onChanged: () => void;
}) {
  const isDraft = packageStatus === "DRAFT";
  const canEditContent = isDraft && canManage;
  const canReview = (packageStatus === "SUBMITTED" || packageStatus === "ACCEPTED") && canAccept;
  const canAttach = packageStatus !== "COMPLETED" && (canManage || canAccept);

  const [docRef, setDocRef] = useState(item.doc_ref_code || "");
  const [notes, setNotes] = useState(item.notes || "");
  const [status, setStatus] = useState<DossierItem["status"]>(item.status);
  const [editingMeta, setEditingMeta] = useState(false);
  const [editItemName, setEditItemName] = useState(item.item_name);
  const [editDocCode, setEditDocCode] = useState(item.doc_code);
  const [editGuidance, setEditGuidance] = useState(item.guidance || "");
  const [editRequired, setEditRequired] = useState(item.is_required);
  const [uploadError, setUploadError] = useState<string | null>(null);

  useEffect(() => {
    setDocRef(item.doc_ref_code || "");
    setNotes(item.notes || "");
    setStatus(item.status);
    setEditItemName(item.item_name);
    setEditDocCode(item.doc_code);
    setEditGuidance(item.guidance || "");
    setEditRequired(item.is_required);
  }, [item]);

  const saveMut = useMutation({
    mutationFn: (overrideStatus?: DossierItem["status"]) =>
      api(`/api/factory/rd/transfers/${packageId}/items`, {
        method: "POST",
        json: {
          action: "upsert",
          id: item.id,
          item_name: editingMeta ? editItemName : item.item_name,
          doc_code: editingMeta ? editDocCode : item.doc_code,
          guidance: editingMeta ? editGuidance || null : item.guidance,
          is_required: editingMeta ? editRequired : item.is_required,
          doc_ref_code: docRef.trim() || null,
          notes: notes.trim() || null,
          status: overrideStatus ?? status,
        },
      }),
    onSuccess: () => {
      setEditingMeta(false);
      onChanged();
    },
  });

  const deleteItemMut = useMutation({
    mutationFn: () =>
      api(`/api/factory/rd/transfers/${packageId}/items?item_id=${encodeURIComponent(item.id)}`, {
        method: "DELETE",
      }),
    onSuccess: onChanged,
  });

  const uploadFilesMut = useMutation({
    mutationFn: async (files: File[]) => {
      setUploadError(null);
      const fd = new FormData();
      fd.append("item_id", item.id);
      for (const f of files) fd.append("files", f);
      const res = await fetch(`/api/factory/rd/transfers/${packageId}/files`, {
        method: "POST",
        body: fd,
        credentials: "same-origin",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Lỗi upload ${res.status}`);
    },
    onSuccess: onChanged,
    onError: (err: any) => setUploadError(err?.message || "Lỗi tải tệp lên"),
  });

  const removeFileMut = useMutation({
    mutationFn: (fileId: string) =>
      api(`/api/factory/rd/transfers/${packageId}/files?file_id=${encodeURIComponent(fileId)}`, {
        method: "DELETE",
      }),
    onSuccess: onChanged,
  });

  const stMeta = ITEM_STATUS_META[item.status] ?? ITEM_STATUS_META.MISSING;

  return (
    <div
      className={`p-3 rounded-xl border text-xs space-y-2 ${
        item.status === "VERIFIED" || item.status === "SUBMITTED"
          ? "bg-white dark:bg-slate-900 border-emerald-200/80 dark:border-emerald-900/60"
          : item.status === "WAIVED"
          ? "bg-slate-50 dark:bg-slate-900/40 border-slate-200 dark:border-slate-800"
          : item.is_required
          ? "bg-amber-50/40 dark:bg-amber-950/10 border-amber-200/80 dark:border-amber-900/50"
          : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-0.5 flex-1 min-w-[220px]">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
              #{item.seq} · {item.doc_code}
            </span>
            <span
              className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                item.is_required
                  ? "bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300"
                  : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400"
              }`}
            >
              {item.is_required ? "Bắt buộc" : "Khuyến nghị"}
            </span>
            <span className="font-bold text-slate-900 dark:text-white">{item.item_name}</span>
          </div>
          {item.guidance && <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-snug">{item.guidance}</p>}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <StatusBadge status={stMeta.badge} label={stMeta.label} />
          {canEditContent && (
            <>
              <button
                type="button"
                onClick={() => setEditingMeta((v) => !v)}
                className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 cursor-pointer"
                title="Chỉnh sửa tên / hướng dẫn hạng mục"
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                disabled={deleteItemMut.isPending}
                onClick={() => {
                  if (confirm(`Xóa hạng mục "${item.item_name}" khỏi gói chuyển giao này?`)) {
                    deleteItemMut.mutate();
                  }
                }}
                className="p-1 rounded hover:bg-rose-50 dark:hover:bg-rose-950/40 text-rose-600 cursor-pointer"
                title="Xóa hạng mục"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </>
          )}
        </div>
      </div>

      {editingMeta && canEditContent && (
        <div className="p-2.5 rounded-lg bg-sky-50/60 dark:bg-sky-950/20 border border-sky-200 dark:border-sky-800 grid gap-2 sm:grid-cols-12">
          <div className="sm:col-span-3">
            <label className="block text-[10px] font-bold text-slate-500 mb-0.5">Mã hồ sơ</label>
            <input className={`${inputClass} font-mono`} value={editDocCode} onChange={(e) => setEditDocCode(e.target.value)} />
          </div>
          <div className="sm:col-span-6">
            <label className="block text-[10px] font-bold text-slate-500 mb-0.5">Tên hạng mục hồ sơ *</label>
            <input className={inputClass} value={editItemName} onChange={(e) => setEditItemName(e.target.value)} />
          </div>
          <div className="sm:col-span-3 flex items-end pb-1.5">
            <label className="inline-flex items-center gap-1.5 font-semibold cursor-pointer">
              <input type="checkbox" checked={editRequired} onChange={(e) => setEditRequired(e.target.checked)} className="rounded accent-rose-600" />
              <span>Bắt buộc trước khi gửi</span>
            </label>
          </div>
          <div className="sm:col-span-12">
            <label className="block text-[10px] font-bold text-slate-500 mb-0.5">Hướng dẫn nội dung &amp; Tiêu chí</label>
            <input className={inputClass} value={editGuidance} onChange={(e) => setEditGuidance(e.target.value)} />
          </div>
        </div>
      )}

      <ErrorNote error={saveMut.error ?? deleteItemMut.error ?? removeFileMut.error ?? (uploadError ? new Error(uploadError) : null)} />

      {/* Reference code, status & upload row */}
      <div className="grid gap-2 sm:grid-cols-12 items-center pt-1">
        <div className="sm:col-span-3">
          <input
            className={`${inputClass} !py-1 !text-[11px] font-mono`}
            value={docRef}
            onChange={(e) => setDocRef(e.target.value)}
            disabled={!canEditContent && !canReview}
            placeholder="Mã SOP / ELN / DHF..."
            title="Mã tài liệu tham chiếu (VD: SOP-SX-012, EXP2611-0005)"
          />
        </div>
        <div className="sm:col-span-4">
          <input
            className={`${inputClass} !py-1 !text-[11px]`}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            disabled={!canEditContent && !canReview}
            placeholder="Ghi chú hồ sơ hoặc lý do miễn trừ..."
          />
        </div>
        <div className="sm:col-span-2">
          {canEditContent ? (
            <select
              className={`${inputClass} !py-1 !text-[11px] font-semibold`}
              value={status}
              onChange={(e) => setStatus(e.target.value as any)}
            >
              <option value="MISSING">Chưa nộp (MISSING)</option>
              <option value="SUBMITTED">Đã nộp (SUBMITTED)</option>
              <option value="WAIVED">Miễn trừ (WAIVED)</option>
            </select>
          ) : (
            <span className="text-[11px] text-slate-500">
              {item.verified_by_name ? `✓ ${item.verified_by_name} (${fmtDate(item.verified_at)})` : stMeta.label}
            </span>
          )}
        </div>
        <div className="sm:col-span-3 flex flex-wrap items-center justify-end gap-1.5">
          {(canEditContent || canReview) && (
            <Button
              type="button"
              variant="ghost"
              className="!min-h-7 !py-0.5 !px-2 !text-[11px]"
              disabled={saveMut.isPending}
              onClick={() => saveMut.mutate(undefined)}
            >
              {saveMut.isPending ? "Đang lưu..." : "Lưu mục"}
            </Button>
          )}
          {canReview && item.status !== "VERIFIED" && (
            <Button
              type="button"
              className="!min-h-7 !py-0.5 !px-2 !text-[11px]"
              disabled={saveMut.isPending}
              onClick={() => saveMut.mutate("VERIFIED")}
            >
              <CheckCircle2 className="w-3 h-3 mr-1" />
              Xác nhận đủ
            </Button>
          )}
          {canAttach && (
            <label className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-sky-50 dark:bg-sky-950/60 hover:bg-sky-100 dark:hover:bg-sky-900/70 text-sky-700 dark:text-sky-300 border border-sky-200 dark:border-sky-800 text-[11px] font-bold cursor-pointer">
              <Paperclip className="w-3 h-3" />
              <span>{uploadFilesMut.isPending ? "Đang tải..." : "Đính kèm file"}</span>
              <input
                type="file"
                multiple
                className="hidden"
                accept=".pdf,.docx,.xlsx,.csv,.txt,.zip,.png,.jpg,.jpeg,.webp"
                disabled={uploadFilesMut.isPending}
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  e.target.value = "";
                  if (files.length > 0) uploadFilesMut.mutate(files);
                }}
              />
            </label>
          )}
        </div>
      </div>

      {/* Attached files list for this item */}
      {item.files && item.files.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {item.files.map((f) => (
            <div
              key={f.id}
              className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-[11px]"
            >
              <FileCheck2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
              <a
                href={`/api/factory/rd/transfers/${packageId}/files?file_id=${f.id}&inline=1`}
                target="_blank"
                rel="noreferrer"
                className="font-semibold text-sky-700 dark:text-sky-400 hover:underline max-w-[220px] truncate"
                title={`${f.file_name} (${formatBytes(f.size_bytes)}) — SHA256: ${f.sha256.slice(0, 12)}`}
              >
                {f.file_name}
              </a>
              <span className="text-[10px] text-slate-400 font-mono">({formatBytes(f.size_bytes)})</span>
              <a
                href={`/api/factory/rd/transfers/${packageId}/files?file_id=${f.id}`}
                className="text-slate-500 hover:text-sky-600"
                title="Tải xuống"
              >
                <Download className="w-3 h-3" />
              </a>
              {canEditContent && (
                <button
                  type="button"
                  disabled={removeFileMut.isPending}
                  onClick={() => {
                    if (confirm(`Gỡ tệp "${f.file_name}" khỏi hồ sơ chuyển giao?`)) removeFileMut.mutate(f.id);
                  }}
                  className="text-rose-500 hover:text-rose-700 font-bold cursor-pointer ml-0.5"
                  title="Gỡ tệp này"
                >
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function TransferPackageDetailWorkspace({
  packageId,
  templates,
  canManage,
  canAccept,
  onPackageMutated,
}: {
  packageId: string;
  templates: TransferTemplateRow[];
  canManage: boolean;
  canAccept: boolean;
  onPackageMutated: () => void;
}) {
  const qc = useQueryClient();
  const [subTab, setSubTab] = useState<"checklist" | "bom_sop" | "qc_stability" | "files">("checklist");
  const [addingCustomItem, setAddingCustomItem] = useState(false);
  const [customSection, setCustomSection] = useState("9. Hồ sơ Bổ sung Tùy chỉnh");
  const [customDocCode, setCustomDocCode] = useState("DOC-EXT-01");
  const [customName, setCustomName] = useState("");
  const [customGuidance, setCustomGuidance] = useState("");
  const [customRequired, setCustomRequired] = useState(true);
  const [syncTplId, setSyncTplId] = useState("");
  const [generalLabel, setGeneralLabel] = useState("");
  const [generalUploadErr, setGeneralUploadErr] = useState<string | null>(null);

  const detailQuery = useQuery({
    queryKey: ["factory", "rd", "transfer-detail", packageId],
    queryFn: () => api<any>(`/api/factory/rd/transfers/${packageId}`),
  });

  const refreshDetail = () => {
    qc.invalidateQueries({ queryKey: ["factory", "rd", "transfer-detail", packageId] });
    onPackageMutated();
  };

  const addItemMut = useMutation({
    mutationFn: () =>
      api(`/api/factory/rd/transfers/${packageId}/items`, {
        method: "POST",
        json: {
          action: "upsert",
          section_code: "CUSTOM",
          section_name: customSection,
          doc_code: customDocCode,
          item_name: customName,
          guidance: customGuidance || null,
          is_required: customRequired,
          status: "MISSING",
        },
      }),
    onSuccess: () => {
      setAddingCustomItem(false);
      setCustomName("");
      setCustomGuidance("");
      refreshDetail();
    },
  });

  const applyTplMut = useMutation({
    mutationFn: (mode: "MERGE" | "REPLACE") =>
      api(`/api/factory/rd/transfers/${packageId}/items`, {
        method: "POST",
        json: { action: "apply_template", template_id: syncTplId, mode },
      }),
    onSuccess: refreshDetail,
  });

  const generalUploadMut = useMutation({
    mutationFn: async (files: File[]) => {
      setGeneralUploadErr(null);
      const fd = new FormData();
      if (generalLabel.trim()) fd.append("doc_label", generalLabel.trim());
      for (const f of files) fd.append("files", f);
      const res = await fetch(`/api/factory/rd/transfers/${packageId}/files`, {
        method: "POST",
        body: fd,
        credentials: "same-origin",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Lỗi upload ${res.status}`);
    },
    onSuccess: () => {
      setGeneralLabel("");
      refreshDetail();
    },
    onError: (err: any) => setGeneralUploadErr(err?.message || "Lỗi tải tệp chung"),
  });

  const deleteGeneralFileMut = useMutation({
    mutationFn: (fileId: string) =>
      api(`/api/factory/rd/transfers/${packageId}/files?file_id=${encodeURIComponent(fileId)}`, {
        method: "DELETE",
      }),
    onSuccess: refreshDetail,
  });

  const pkg = detailQuery.data;
  const items: DossierItem[] = pkg?.items ?? [];

  const groupedSections = useMemo(() => {
    const groups: { name: string; items: DossierItem[] }[] = [];
    const byName = new Map<string, DossierItem[]>();
    for (const it of items) {
      const arr = byName.get(it.section_name) ?? [];
      arr.push(it);
      byName.set(it.section_name, arr);
    }
    for (const [name, list] of byName.entries()) {
      groups.push({ name, items: list });
    }
    return groups;
  }, [items]);

  if (detailQuery.isLoading) {
    return <div className="p-4 text-xs text-slate-400">Đang tải chi tiết bộ hồ sơ chuyển giao...</div>;
  }
  if (detailQuery.error || !pkg) {
    return <ErrorNote error={detailQuery.error} />;
  }

  const isDraft = pkg.status === "DRAFT";
  const allItemFiles = items.flatMap((it) =>
    (it.files ?? []).map((f) => ({ ...f, itemTitle: `${it.doc_code}: ${it.item_name}` }))
  );
  const allFiles = [
    ...allItemFiles,
    ...((pkg.general_files ?? []) as DossierFile[]).map((f) => ({ ...f, itemTitle: "Tài liệu chung gói chuyển giao" })),
  ];
  const requiredItems = items.filter((i) => i.is_required);
  const requiredDone = requiredItems.filter((i) => i.status !== "MISSING").length;
  const meta = pkg.transfer_metadata ?? {};

  return (
    <div className="mt-2 pt-3 border-t border-slate-200 dark:border-slate-800 space-y-3">
      {/* Sub-navigation Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1.5">
          {[
            { id: "checklist" as const, label: `📑 Danh mục Hồ sơ (${requiredDone}/${requiredItems.length} bắt buộc)` },
            { id: "bom_sop" as const, label: `🧪 BOM (${pkg.bom_specification?.length ?? 0}) & Quy trình (${pkg.routing_steps?.length ?? 0})` },
            { id: "qc_stability" as const, label: `🛡️ QC (${pkg.qc_release_criteria?.length ?? 0}), Hiệu năng & Độ ổn định` },
            { id: "files" as const, label: `📎 Toàn bộ Tệp đính kèm (${allFiles.length})` },
          ].map((tb) => (
            <button
              key={tb.id}
              type="button"
              onClick={() => setSubTab(tb.id)}
              className={`px-3 py-1.5 rounded-xl text-[11px] font-bold transition-colors cursor-pointer ${
                subTab === tb.id
                  ? "bg-sky-700 text-white"
                  : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700"
              }`}
            >
              {tb.label}
            </button>
          ))}
        </div>
        {pkg.template_code && (
          <span className="text-[11px] text-slate-500 font-mono">
            Mẫu áp dụng: <b>{pkg.template_code}</b>
          </span>
        )}
      </div>

      {/* TAB 1: DOSSIER CHECKLIST */}
      {subTab === "checklist" && (
        <div className="space-y-3">
          {isDraft && canManage && (
            <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800">
              <div className="flex flex-wrap items-center gap-1.5">
                <Button
                  type="button"
                  variant="ghost"
                  className="!min-h-8 !py-1 !px-2.5 !text-[11px]"
                  onClick={() => setAddingCustomItem((v) => !v)}
                >
                  <Plus className="w-3.5 h-3.5 mr-1" />
                  Thêm hạng mục hồ sơ riêng
                </Button>
              </div>
              {templates.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <select
                    className={`${inputClass} !py-1 !text-[11px] w-60`}
                    value={syncTplId}
                    onChange={(e) => setSyncTplId(e.target.value)}
                  >
                    <option value="">-- Đồng bộ từ Bộ Mẫu chuẩn --</option>
                    {templates.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.code} ({t.items?.length ?? 0} mục)
                      </option>
                    ))}
                  </select>
                  <Button
                    type="button"
                    variant="ghost"
                    className="!min-h-8 !py-1 !px-2 !text-[11px]"
                    disabled={!syncTplId || applyTplMut.isPending}
                    onClick={() => applyTplMut.mutate("MERGE")}
                  >
                    Gộp thêm mục còn thiếu
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    className="!min-h-8 !py-1 !px-2 !text-[11px]"
                    disabled={!syncTplId || applyTplMut.isPending}
                    onClick={() => {
                      if (confirm("Thay thế danh mục bằng mẫu đã chọn? (Các tệp đã tải lên vẫn được giữ trong mục Tài liệu chung)")) {
                        applyTplMut.mutate("REPLACE");
                      }
                    }}
                  >
                    Thay bằng mẫu này
                  </Button>
                </div>
              )}
            </div>
          )}

          <ErrorNote error={addItemMut.error ?? applyTplMut.error} />

          {addingCustomItem && isDraft && canManage && (
            <form
              className="p-3 rounded-xl border border-sky-200 dark:border-sky-800 bg-sky-50/40 dark:bg-sky-950/20 grid gap-2 sm:grid-cols-12 text-xs"
              onSubmit={(e) => {
                e.preventDefault();
                addItemMut.mutate();
              }}
            >
              <div className="sm:col-span-4">
                <label className="block text-[10px] font-bold text-slate-500 mb-0.5">Nhóm hồ sơ</label>
                <input className={inputClass} value={customSection} onChange={(e) => setCustomSection(e.target.value)} required />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-[10px] font-bold text-slate-500 mb-0.5">Mã tài liệu</label>
                <input className={`${inputClass} font-mono`} value={customDocCode} onChange={(e) => setCustomDocCode(e.target.value)} required />
              </div>
              <div className="sm:col-span-4">
                <label className="block text-[10px] font-bold text-slate-500 mb-0.5">Tên tài liệu / hồ sơ bổ sung *</label>
                <input className={inputClass} value={customName} onChange={(e) => setCustomName(e.target.value)} placeholder="VD: Bảng đánh giá nhiễu ngoại sinh..." required />
              </div>
              <div className="sm:col-span-2 flex items-end pb-1.5">
                <label className="inline-flex items-center gap-1.5 font-semibold cursor-pointer">
                  <input type="checkbox" checked={customRequired} onChange={(e) => setCustomRequired(e.target.checked)} className="rounded accent-rose-600" />
                  <span>Bắt buộc</span>
                </label>
              </div>
              <div className="sm:col-span-9">
                <input className={inputClass} value={customGuidance} onChange={(e) => setCustomGuidance(e.target.value)} placeholder="Hướng dẫn chi tiết nội dung cần nộp..." />
              </div>
              <div className="sm:col-span-3 flex justify-end gap-1.5">
                <Button type="button" variant="ghost" onClick={() => setAddingCustomItem(false)}>Hủy</Button>
                <Button type="submit" disabled={addItemMut.isPending}>Lưu hạng mục</Button>
              </div>
            </form>
          )}

          {groupedSections.length === 0 ? (
            <div className="p-4 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 text-center text-xs text-slate-500">
              Gói chuyển giao này chưa có danh mục hồ sơ. Bạn có thể bấm &ldquo;+ Thêm hạng mục hồ sơ riêng&rdquo; hoặc đồng bộ từ Bộ Mẫu chuẩn.
            </div>
          ) : (
            groupedSections.map((sec) => {
              const secDone = sec.items.filter((i) => i.status !== "MISSING").length;
              return (
                <div key={sec.name} className="space-y-2">
                  <div className="flex items-center justify-between px-1">
                    <h4 className="font-bold text-xs text-slate-800 dark:text-slate-100">{sec.name}</h4>
                    <span className="text-[11px] font-mono text-slate-500">
                      {secDone}/{sec.items.length} mục đã có hồ sơ
                    </span>
                  </div>
                  <div className="space-y-1.5">
                    {sec.items.map((item) => (
                      <ChecklistItemCard
                        key={item.id}
                        packageId={packageId}
                        packageStatus={pkg.status}
                        item={item}
                        canManage={canManage}
                        canAccept={canAccept}
                        onChanged={refreshDetail}
                      />
                    ))}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* TAB 2: BOM & ROUTING */}
      {subTab === "bom_sop" && (
        <div className="space-y-3 text-xs">
          {Object.values(meta).some(Boolean) && (
            <div className="grid gap-2 sm:grid-cols-4 p-3 rounded-xl bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800 text-[11px]">
              {meta.pack_size && <div><b>Quy cách đóng gói:</b> {meta.pack_size}</div>}
              {meta.storage_temp && <div><b>Bảo quản:</b> {meta.storage_temp}</div>}
              {meta.shelf_life_months && <div><b>Hạn dùng mục tiêu:</b> {meta.shelf_life_months} tháng</div>}
              {meta.shipping_condition && <div><b>Chuỗi lạnh vận chuyển:</b> {meta.shipping_condition}</div>}
              {meta.cleanroom_class && <div><b>Cấp phòng sạch:</b> {meta.cleanroom_class}</div>}
              {meta.compatible_instruments && <div className="sm:col-span-2"><b>Hệ máy tương thích:</b> {meta.compatible_instruments}</div>}
              {meta.pilot_batch_plan && <div className="sm:col-span-4"><b>Kế hoạch lô Pilot:</b> {meta.pilot_batch_plan}</div>}
            </div>
          )}

          <div className="rounded-xl border border-slate-200 dark:border-slate-800 overflow-x-auto">
            <table className="w-full text-left border-collapse text-[11px]">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300">
                  <th className="py-2 px-2.5">#</th>
                  <th className="py-2 px-2.5">Mã thành phần</th>
                  <th className="py-2 px-2.5">Tên thành phần / Hóa chất / Vật tư</th>
                  <th className="py-2 px-2.5">Vai trò</th>
                  <th className="py-2 px-2.5">Định mức Thường</th>
                  <th className="py-2 px-2.5">Chia sẵn (.D.IC)</th>
                  <th className="py-2 px-2.5">ĐVT</th>
                  <th className="py-2 px-2.5">% Hao hụt</th>
                  <th className="py-2 px-2.5">Hộp</th>
                </tr>
              </thead>
              <tbody>
                {(pkg.bom_specification ?? []).map((b: any, idx: number) => (
                  <tr key={idx} className="border-t border-slate-100 dark:border-slate-800/60">
                    <td className="py-1.5 px-2.5 font-mono">{idx + 1}</td>
                    <td className="py-1.5 px-2.5 font-mono font-bold">{b.component_code}</td>
                    <td className="py-1.5 px-2.5">{b.component_name}</td>
                    <td className="py-1.5 px-2.5 text-slate-500">{b.role || "—"}</td>
                    <td className="py-1.5 px-2.5 font-mono font-bold">{b.qty_per_kit}</td>
                    <td className="py-1.5 px-2.5 font-mono">{b.qty_aliquoted ?? "—"}</td>
                    <td className="py-1.5 px-2.5 font-mono">{b.uom}</td>
                    <td className="py-1.5 px-2.5 font-mono">{b.scrap_pct ?? 0}%</td>
                    <td className="py-1.5 px-2.5 font-mono">Hộp {b.box_no ?? 1}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-800 overflow-x-auto">
            <table className="w-full text-left border-collapse text-[11px]">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300">
                  <th className="py-2 px-2.5">Bước</th>
                  <th className="py-2 px-2.5">Mã bước</th>
                  <th className="py-2 px-2.5">Tên công đoạn SOP</th>
                  <th className="py-2 px-2.5">Thông số &amp; Điều kiện thực hiện</th>
                  <th className="py-2 px-2.5">Kiểm soát IPQC</th>
                </tr>
              </thead>
              <tbody>
                {(pkg.routing_steps ?? []).length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-3 text-center text-slate-400">Chưa khai báo công đoạn quy trình.</td>
                  </tr>
                ) : (
                  (pkg.routing_steps ?? []).map((st: any, idx: number) => (
                    <tr key={idx} className="border-t border-slate-100 dark:border-slate-800/60">
                      <td className="py-1.5 px-2.5 font-mono font-bold">{st.seq ?? idx + 1}</td>
                      <td className="py-1.5 px-2.5 font-mono">{st.step_code}</td>
                      <td className="py-1.5 px-2.5 font-semibold">{st.step_name}</td>
                      <td className="py-1.5 px-2.5">{st.params || "—"}</td>
                      <td className="py-1.5 px-2.5 text-sky-700 dark:text-sky-400">{st.qc_check || "—"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 3: QC RELEASE & STABILITY */}
      {subTab === "qc_stability" && (
        <div className="space-y-3 text-xs">
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 overflow-x-auto">
            <table className="w-full text-left border-collapse text-[11px]">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300">
                  <th className="py-2 px-2.5">Giai đoạn</th>
                  <th className="py-2 px-2.5">Chỉ tiêu Kiểm nghiệm</th>
                  <th className="py-2 px-2.5">Phương pháp</th>
                  <th className="py-2 px-2.5">Đơn vị</th>
                  <th className="py-2 px-2.5">Tiêu chuẩn chấp nhận</th>
                </tr>
              </thead>
              <tbody>
                {(pkg.qc_release_criteria ?? []).length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-3 text-center text-slate-400">
                      Chưa khai báo bảng chỉ tiêu QC riêng (QA/QC sẽ tự sinh từ ma trận TPP của dự án khi ký tiếp nhận).
                    </td>
                  </tr>
                ) : (
                  (pkg.qc_release_criteria ?? []).map((qcRow: any, idx: number) => (
                    <tr key={idx} className="border-t border-slate-100 dark:border-slate-800/60">
                      <td className="py-1.5 px-2.5 font-mono font-bold">{qcRow.stage}</td>
                      <td className="py-1.5 px-2.5 font-semibold">{qcRow.parameter}</td>
                      <td className="py-1.5 px-2.5 text-slate-500">{qcRow.method || "—"}</td>
                      <td className="py-1.5 px-2.5 font-mono">{qcRow.unit || "—"}</td>
                      <td className="py-1.5 px-2.5 font-semibold text-emerald-700 dark:text-emerald-400">{qcRow.target}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 text-[11px]">
            <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/40 space-y-1">
              <div className="font-bold text-slate-800 dark:text-slate-100">Tóm tắt Nghiên cứu Độ ổn định</div>
              <p className="text-slate-600 dark:text-slate-300 whitespace-pre-line">{pkg.stability_summary}</p>
            </div>
            <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/40 space-y-1">
              <div className="font-bold text-slate-800 dark:text-slate-100">Tóm tắt Thẩm định Hiệu năng</div>
              <p className="text-slate-600 dark:text-slate-300 whitespace-pre-line">{pkg.validation_summary}</p>
            </div>
          </div>

          {pkg.notes && (
            <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 text-[11px]">
              <b>Ghi chú bàn giao:</b> {pkg.notes}
            </div>
          )}
        </div>
      )}

      {/* TAB 4: ALL FILES */}
      {subTab === "files" && (
        <div className="space-y-3 text-xs">
          {pkg.status !== "COMPLETED" && (canManage || canAccept) && (
            <div className="flex flex-wrap items-center gap-2 p-3 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800">
              <input
                className={`${inputClass} sm:w-72`}
                value={generalLabel}
                onChange={(e) => setGeneralLabel(e.target.value)}
                placeholder="Nhãn tài liệu đính kèm chung (tùy chọn)..."
              />
              <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-sky-700 hover:bg-sky-600 text-white font-bold cursor-pointer">
                <FilePlus2 className="w-3.5 h-3.5" />
                <span>{generalUploadMut.isPending ? "Đang tải lên..." : "Tải lên Tệp hồ sơ chung (Multi-file)"}</span>
                <input
                  type="file"
                  multiple
                  className="hidden"
                  accept=".pdf,.docx,.xlsx,.csv,.txt,.zip,.png,.jpg,.jpeg,.webp"
                  disabled={generalUploadMut.isPending}
                  onChange={(e) => {
                    const files = Array.from(e.target.files ?? []);
                    e.target.value = "";
                    if (files.length > 0) generalUploadMut.mutate(files);
                  }}
                />
              </label>
            </div>
          )}
          <ErrorNote error={deleteGeneralFileMut.error ?? (generalUploadErr ? new Error(generalUploadErr) : null)} />

          {allFiles.length === 0 ? (
            <div className="p-4 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 text-center text-slate-500">
              Chưa có tệp hồ sơ nào được đính kèm trong gói chuyển giao này.
            </div>
          ) : (
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 overflow-x-auto">
              <table className="w-full text-left border-collapse text-[11px]">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300">
                    <th className="py-2 px-2.5">Tên tệp</th>
                    <th className="py-2 px-2.5">Thuộc hạng mục / Nhãn</th>
                    <th className="py-2 px-2.5">Dung lượng</th>
                    <th className="py-2 px-2.5">SHA-256</th>
                    <th className="py-2 px-2.5">Người tải &amp; Ngày</th>
                    <th className="py-2 px-2.5 text-right">Thao tác</th>
                  </tr>
                </thead>
                <tbody>
                  {allFiles.map((f) => (
                    <tr key={f.id} className="border-t border-slate-100 dark:border-slate-800/60">
                      <td className="py-1.5 px-2.5 font-semibold text-sky-700 dark:text-sky-400">{f.file_name}</td>
                      <td className="py-1.5 px-2.5">
                        <div>{f.itemTitle}</div>
                        {f.doc_label && <div className="text-[10px] text-slate-500">Nhãn: {f.doc_label}</div>}
                      </td>
                      <td className="py-1.5 px-2.5 font-mono">{formatBytes(f.size_bytes)}</td>
                      <td className="py-1.5 px-2.5 font-mono text-slate-400">{f.sha256.slice(0, 12)}…</td>
                      <td className="py-1.5 px-2.5 text-slate-500">
                        {f.uploaded_by_name || "—"} · {fmtDate(f.uploaded_at)}
                      </td>
                      <td className="py-1.5 px-2.5 text-right space-x-2">
                        <a
                          href={`/api/factory/rd/transfers/${packageId}/files?file_id=${f.id}&inline=1`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-0.5 text-sky-600 hover:underline font-semibold"
                        >
                          <ExternalLink className="w-3 h-3" /> Xem
                        </a>
                        <a
                          href={`/api/factory/rd/transfers/${packageId}/files?file_id=${f.id}`}
                          className="inline-flex items-center gap-0.5 text-emerald-700 dark:text-emerald-400 hover:underline font-semibold"
                        >
                          <Download className="w-3 h-3" /> Tải
                        </a>
                        {isDraft && canManage && (
                          <button
                            type="button"
                            onClick={() => {
                              if (confirm(`Gỡ tệp "${f.file_name}"?`)) deleteGeneralFileMut.mutate(f.id);
                            }}
                            className="text-rose-600 hover:underline font-semibold cursor-pointer"
                          >
                            Gỡ
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

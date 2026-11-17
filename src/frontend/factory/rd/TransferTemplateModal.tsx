"use client";

import React, { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Plus, Settings2, Trash2, X } from "lucide-react";
import { api } from "../api";
import { Button, ErrorNote, Field, inputClass } from "../ui";

export interface TransferTemplateItemRow {
  id?: string;
  seq: number;
  section_code: string;
  section_name: string;
  doc_code: string;
  item_name: string;
  guidance: string | null;
  is_required: boolean;
}

export interface TransferTemplateRow {
  id: string;
  code: string;
  name: string;
  domain: "KIT" | "OLIGO" | "DEVICE" | "SOFTWARE" | "OTHER";
  description: string | null;
  is_default: boolean;
  package_count?: number;
  items: TransferTemplateItemRow[];
}

const SECTION_PRESETS = [
  { code: "1_PRODUCT_TPP", name: "1. Định danh Sản phẩm, TPP & Quản lý Rủi ro" },
  { code: "2_BOM_RAW_MAT", name: "2. Công thức Gốc, Định mức BOM & Tiêu chuẩn Nguyên vật liệu" },
  { code: "3_PROCESS_BMR", name: "3. Quy trình Công nghệ, SOP Sản xuất & Hồ sơ Lô Gốc (DMR/BMR)" },
  { code: "4_QC_RELEASE", name: "4. Tiêu chuẩn Kiểm nghiệm QA/QC & Bộ Mẫu chuẩn Tham chiếu" },
  { code: "5_ANALYTICAL_CLINICAL", name: "5. Báo cáo Thẩm định Hiệu năng Phân tích & Lâm sàng" },
  { code: "6_STABILITY_COLDCHAIN", name: "6. Nghiên cứu Độ ổn định & Chuỗi lạnh Bảo quản – Vận chuyển" },
  { code: "7_LABEL_IFU", name: "7. Nhãn, Bao bì, UDI & Bộ 4 Tài liệu Hướng dẫn Sử dụng (IFU)" },
  { code: "8_TRAINING_PILOT", name: "8. Đào tạo Chuyển giao & Thẩm định 03 Lô Pilot (PQ)" },
  { code: "9_CUSTOM", name: "9. Hồ sơ Bổ sung Tùy chỉnh" },
];

export function TransferTemplateModal({
  templates,
  onSaved,
  onClose,
}: {
  templates: TransferTemplateRow[];
  onSaved: () => void;
  onClose: () => void;
}) {
  const [selectedId, setSelectedId] = useState<string>(templates[0]?.id ?? "__NEW__");
  const [name, setName] = useState("");
  const [domain, setDomain] = useState<"KIT" | "OLIGO" | "DEVICE" | "SOFTWARE" | "OTHER">("KIT");
  const [description, setDescription] = useState("");
  const [isDefault, setIsDefault] = useState(false);
  const [items, setItems] = useState<TransferTemplateItemRow[]>([]);

  useEffect(() => {
    if (selectedId === "__NEW__") {
      setName("");
      setDomain("KIT");
      setDescription("");
      setIsDefault(false);
      setItems([
        {
          seq: 1,
          section_code: "1_PRODUCT_TPP",
          section_name: "1. Định danh Sản phẩm, TPP & Quản lý Rủi ro",
          doc_code: "TPP_FINAL",
          item_name: "Hồ sơ Đặc tính Mục tiêu Sản phẩm chốt cuối (TPP)",
          guidance: "Thông số kỹ thuật, mục đích sử dụng và quy cách đóng gói",
          is_required: true,
        },
      ]);
      return;
    }
    const found = templates.find((t) => t.id === selectedId) ?? templates[0];
    if (found) {
      setSelectedId(found.id);
      setName(found.name);
      setDomain(found.domain);
      setDescription(found.description || "");
      setIsDefault(Boolean(found.is_default));
      setItems(
        (found.items ?? []).map((it, idx) => ({
          ...it,
          seq: idx + 1,
          guidance: it.guidance ?? "",
        }))
      );
    }
  }, [selectedId, templates]);

  const saveMut = useMutation({
    mutationFn: () =>
      api<TransferTemplateRow>("/api/factory/rd/transfer-templates", {
        method: "POST",
        json: {
          id: selectedId === "__NEW__" ? null : selectedId,
          name,
          domain,
          description: description || null,
          is_default: isDefault,
          items: items.map((it, idx) => ({
            seq: idx + 1,
            section_code: it.section_code || "9_CUSTOM",
            section_name: it.section_name || "9. Hồ sơ Bổ sung Tùy chỉnh",
            doc_code: it.doc_code || `DOC-${idx + 1}`,
            item_name: it.item_name,
            guidance: it.guidance || null,
            is_required: Boolean(it.is_required),
          })),
        },
      }),
    onSuccess: (saved) => {
      if (saved?.id) setSelectedId(saved.id);
      onSaved();
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api(`/api/factory/rd/transfer-templates?id=${encodeURIComponent(id)}`, { method: "DELETE" }),
    onSuccess: () => {
      setSelectedId("__NEW__");
      onSaved();
    },
  });

  const moveItem = (index: number, delta: -1 | 1) => {
    const nextIdx = index + delta;
    if (nextIdx < 0 || nextIdx >= items.length) return;
    const copy = [...items];
    const [picked] = copy.splice(index, 1);
    copy.splice(nextIdx, 0, picked);
    setItems(copy.map((it, idx) => ({ ...it, seq: idx + 1 })));
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4">
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden text-xs">
        <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2 bg-slate-50/70 dark:bg-slate-800/40">
          <div className="flex items-center gap-2">
            <Settings2 className="w-4 h-4 text-sky-600" />
            <h3 className="font-bold text-sm text-slate-900 dark:text-white">
              Cài đặt Bộ Mẫu Hồ sơ Chuyển giao Công nghệ (ISO 13485 / Kit Chẩn đoán Phân tử)
            </h3>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 overflow-y-auto flex-1 space-y-4">
          <ErrorNote error={saveMut.error ?? deleteMut.error} />

          {/* Template Selector Pills */}
          <div className="flex flex-wrap items-center gap-1.5 pb-3 border-b border-slate-100 dark:border-slate-800">
            {templates.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setSelectedId(t.id)}
                className={`px-3 py-1.5 rounded-xl font-bold border transition-all cursor-pointer ${
                  selectedId === t.id
                    ? "bg-sky-700 text-white border-sky-700 shadow-xs"
                    : "bg-white dark:bg-slate-950 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:border-sky-400"
                }`}
              >
                <span>{t.code}</span>
                {t.is_default && <span className="ml-1 text-[10px] opacity-85">★ Mặc định ({t.domain})</span>}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setSelectedId("__NEW__")}
              className={`px-3 py-1.5 rounded-xl font-bold border transition-all cursor-pointer inline-flex items-center gap-1 ${
                selectedId === "__NEW__"
                  ? "bg-emerald-600 text-white border-emerald-600"
                  : "bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800"
              }`}
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Tạo mẫu mới</span>
            </button>
          </div>

          <form
            id="transfer-template-form"
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              saveMut.mutate();
            }}
          >
            <div className="grid gap-3 sm:grid-cols-4">
              <div className="sm:col-span-2">
                <Field label="Tên bộ mẫu hồ sơ chuyển giao *">
                  <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} required />
                </Field>
              </div>
              <Field label="Mảng áp dụng *">
                <select className={inputClass} value={domain} onChange={(e) => setDomain(e.target.value as any)}>
                  <option value="KIT">Sản xuất Kit IVD / PCR</option>
                  <option value="OLIGO">Tổng hợp Oligo & Probe</option>
                  <option value="DEVICE">Kỹ thuật – Thiết bị</option>
                  <option value="SOFTWARE">Phần mềm Y sinh</option>
                  <option value="OTHER">Khác</option>
                </select>
              </Field>
              <div className="flex items-end pb-1">
                <label className="inline-flex items-center gap-2 font-bold text-slate-700 dark:text-slate-200 cursor-pointer">
                  <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} className="rounded accent-sky-600 w-4 h-4" />
                  <span>Đặt làm mẫu mặc định</span>
                </label>
              </div>
            </div>

            <Field label="Mô tả phạm vi áp dụng">
              <input className={inputClass} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="VD: Áp dụng cho chuyển giao Kit Real-time PCR đa mồi..." />
            </Field>

            <div className="flex items-center justify-between pt-2">
              <span className="font-bold text-slate-800 dark:text-slate-200">
                Danh sách Hạng mục Hồ sơ Chuyển giao ({items.length} mục)
              </span>
              <Button
                type="button"
                variant="ghost"
                onClick={() =>
                  setItems([
                    ...items,
                    {
                      seq: items.length + 1,
                      section_code: "9_CUSTOM",
                      section_name: "9. Hồ sơ Bổ sung Tùy chỉnh",
                      doc_code: `DOC-${items.length + 1}`,
                      item_name: "",
                      guidance: "",
                      is_required: true,
                    },
                  ])
                }
              >
                + Thêm hạng mục hồ sơ
              </Button>
            </div>

            <div className="space-y-2">
              {items.map((it, idx) => (
                <div
                  key={`${idx}-${it.doc_code}`}
                  className="p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/40 grid gap-2 sm:grid-cols-12 items-start"
                >
                  <div className="sm:col-span-4 space-y-1">
                    <label className="block text-[10px] font-bold text-slate-500">Nhóm hồ sơ (#{idx + 1})</label>
                    <select
                      className={inputClass}
                      value={SECTION_PRESETS.some((s) => s.name === it.section_name) ? it.section_name : "__CUSTOM__"}
                      onChange={(e) => {
                        const preset = SECTION_PRESETS.find((s) => s.name === e.target.value);
                        const copy = [...items];
                        copy[idx] = {
                          ...it,
                          section_code: preset ? preset.code : "CUSTOM",
                          section_name: preset ? preset.name : it.section_name,
                        };
                        setItems(copy);
                      }}
                    >
                      {SECTION_PRESETS.map((s) => (
                        <option key={s.code} value={s.name}>{s.name}</option>
                      ))}
                      <option value="__CUSTOM__">Nhóm tự đặt tên…</option>
                    </select>
                    {!SECTION_PRESETS.some((s) => s.name === it.section_name) && (
                      <input
                        className={inputClass}
                        value={it.section_name}
                        onChange={(e) => {
                          const copy = [...items];
                          copy[idx] = { ...it, section_name: e.target.value };
                          setItems(copy);
                        }}
                        placeholder="Nhập tên nhóm hồ sơ"
                      />
                    )}
                  </div>

                  <div className="sm:col-span-2 space-y-1">
                    <label className="block text-[10px] font-bold text-slate-500">Mã hồ sơ *</label>
                    <input
                      className={`${inputClass} font-mono`}
                      value={it.doc_code}
                      onChange={(e) => {
                        const copy = [...items];
                        copy[idx] = { ...it, doc_code: e.target.value };
                        setItems(copy);
                      }}
                      required
                    />
                  </div>

                  <div className="sm:col-span-4 space-y-1">
                    <label className="block text-[10px] font-bold text-slate-500">Tên tài liệu / Hồ sơ yêu cầu *</label>
                    <input
                      className={inputClass}
                      value={it.item_name}
                      onChange={(e) => {
                        const copy = [...items];
                        copy[idx] = { ...it, item_name: e.target.value };
                        setItems(copy);
                      }}
                      required
                    />
                    <input
                      className={`${inputClass} !text-[11px]`}
                      value={it.guidance || ""}
                      onChange={(e) => {
                        const copy = [...items];
                        copy[idx] = { ...it, guidance: e.target.value };
                        setItems(copy);
                      }}
                      placeholder="Hướng dẫn nội dung & tiêu chí cần đính kèm..."
                    />
                  </div>

                  <div className="sm:col-span-2 flex sm:flex-col items-center sm:items-end justify-between gap-2 pt-1 sm:pt-4">
                    <label className="inline-flex items-center gap-1.5 cursor-pointer font-semibold">
                      <input
                        type="checkbox"
                        checked={it.is_required}
                        onChange={(e) => {
                          const copy = [...items];
                          copy[idx] = { ...it, is_required: e.target.checked };
                          setItems(copy);
                        }}
                        className="rounded accent-rose-600"
                      />
                      <span>Bắt buộc</span>
                    </label>
                    <div className="flex items-center gap-1">
                      <button type="button" onClick={() => moveItem(idx, -1)} disabled={idx === 0} className="p-1 rounded border border-slate-200 dark:border-slate-700 disabled:opacity-40 cursor-pointer" title="Lên">
                        <ArrowUp className="w-3 h-3" />
                      </button>
                      <button type="button" onClick={() => moveItem(idx, 1)} disabled={idx === items.length - 1} className="p-1 rounded border border-slate-200 dark:border-slate-700 disabled:opacity-40 cursor-pointer" title="Xuống">
                        <ArrowDown className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setItems(items.filter((_, i) => i !== idx).map((x, i) => ({ ...x, seq: i + 1 })))}
                        disabled={items.length <= 1}
                        className="p-1 rounded border border-rose-200 dark:border-rose-800 text-rose-600 disabled:opacity-40 cursor-pointer"
                        title="Xóa hạng mục"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </form>
        </div>

        <div className="px-5 py-3 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 bg-slate-50/70 dark:bg-slate-800/40">
          <div>
            {selectedId !== "__NEW__" && (
              <Button
                type="button"
                variant="danger"
                disabled={deleteMut.isPending}
                onClick={() => {
                  if (confirm("Xóa / vô hiệu hóa mẫu hồ sơ chuyển giao này?")) {
                    deleteMut.mutate(selectedId);
                  }
                }}
              >
                Xóa mẫu này
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Đóng
            </Button>
            <Button type="submit" form="transfer-template-form" disabled={saveMut.isPending || items.length === 0}>
              {saveMut.isPending ? "Đang lưu..." : "Lưu Bộ Mẫu Hồ sơ"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

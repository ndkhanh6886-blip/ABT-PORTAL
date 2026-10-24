"use client";

import React, { useState } from "react";
import { Paperclip, UploadCloud, X, FileText, Film } from "lucide-react";

export type Attachment = { name: string; url: string; size?: number; type?: string; uploaded_at?: string };

const isImage = (a: Attachment) => (a.type || "").startsWith("image/") || /\.(png|jpe?g|webp|gif|bmp)$/i.test(a.name || a.url);
const isVideo = (a: Attachment) => (a.type || "").startsWith("video/") || /\.(mp4|mov|webm|mkv|avi)$/i.test(a.name || a.url);

/** Tải file lên /api/upload; trả về danh sách file đã lưu (file lỗi được báo qua onError). */
export async function uploadFiles(files: FileList | File[], onError?: (msg: string) => void): Promise<Attachment[]> {
    const out: Attachment[] = [];
    for (const file of Array.from(files)) {
        const fd = new FormData();
        fd.append("file", file);
        try {
            const res = await fetch("/api/upload", { method: "POST", body: fd });
            const d = await res.json().catch(() => ({}));
            if (res.ok && d.success) {
                out.push({ name: d.name || file.name, url: d.url, size: d.size || file.size, type: d.type || file.type, uploaded_at: new Date().toISOString() });
            } else {
                onError?.(d.error || `Không tải lên được ${file.name}`);
            }
        } catch {
            onError?.(`Lỗi kết nối khi tải ${file.name}`);
        }
    }
    return out;
}

/** Danh sách file đính kèm: ảnh hiện ảnh nhỏ, video và tài liệu bấm để mở. */
export function AttachmentList({ files, onRemove }: { files: Attachment[]; onRemove?: (index: number) => void }) {
    if (!files || files.length === 0) return null;
    return (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {files.map((a, i) => (
                <div key={`${a.url}-${i}`} className="flex items-center gap-2 p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white/70 dark:bg-slate-900/70 min-w-0">
                    <a href={a.url} target="_blank" rel="noreferrer" className="w-10 h-10 shrink-0 rounded overflow-hidden bg-slate-100 dark:bg-slate-800 flex items-center justify-center" title="Mở tệp">
                        {isImage(a) ? <img src={a.url} alt={a.name} className="w-full h-full object-cover" /> : isVideo(a) ? <Film className="w-5 h-5 text-violet-500" /> : <FileText className="w-5 h-5 text-slate-400" />}
                    </a>
                    <a href={a.url} target="_blank" rel="noreferrer" className="flex-1 min-w-0 text-[11px] font-semibold text-slate-700 dark:text-slate-200 truncate hover:underline" title={a.name}>
                        {a.name}
                        {a.size ? <span className="block text-[10px] font-normal text-slate-400">{(a.size / 1024 / 1024).toFixed(a.size > 1024 * 1024 ? 1 : 2)} MB</span> : null}
                    </a>
                    {onRemove && (
                        <button type="button" onClick={() => onRemove(i)} className="p-1 rounded text-slate-400 hover:text-rose-500 cursor-pointer" title="Bỏ tệp này">
                            <X className="w-4 h-4" />
                        </button>
                    )}
                </div>
            ))}
        </div>
    );
}

/** Nút chọn & tải file (nhiều file) kèm danh sách đã đính kèm. */
export function AttachmentPicker({
    files, onChange, label = "Tệp đính kèm", hint, accept = "image/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.txt,.rtf,.xml,.zip,.rar,.7z,.tar,.gz",
}: {
    files: Attachment[];
    onChange: (files: Attachment[]) => void;
    label?: string;
    hint?: string;
    accept?: string;
}) {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const pick = async (list: FileList | null) => {
        if (!list || list.length === 0) return;
        setBusy(true);
        setError(null);
        const errs: string[] = [];
        const added = await uploadFiles(list, m => errs.push(m));
        if (errs.length) setError(errs.join("; "));
        onChange([...(files || []), ...added]);
        setBusy(false);
    };
    return (
        <div className="space-y-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="text-[11px] font-bold text-slate-600 dark:text-slate-300 flex items-center gap-1">
                    <Paperclip className="w-3.5 h-3.5 text-indigo-500" />
                    {label} ({files?.length || 0})
                </span>
                <label className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-white font-bold text-[11px] ${busy ? "bg-slate-500 cursor-wait" : "bg-indigo-600 hover:bg-indigo-700 cursor-pointer"}`}>
                    <UploadCloud className="w-3.5 h-3.5" />
                    {busy ? "Đang tải lên..." : "+ Đính kèm tệp"}
                    <input type="file" multiple disabled={busy} accept={accept} className="hidden"
                        onChange={(e) => { const l = e.target.files; pick(l); e.target.value = ""; }} />
                </label>
            </div>
            {hint && <p className="text-[10px] text-slate-400">{hint}</p>}
            {error && <p className="text-[11px] text-rose-500">{error}</p>}
            <AttachmentList files={files || []} onRemove={(i) => onChange((files || []).filter((_, k) => k !== i))} />
        </div>
    );
}

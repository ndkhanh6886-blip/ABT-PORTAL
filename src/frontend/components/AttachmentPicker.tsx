"use client";

import React, { useState } from "react";
import { Paperclip, UploadCloud, X, FileText, Film } from "lucide-react";

export type Attachment = { name: string; url: string; size?: number; type?: string; uploaded_at?: string };

const isImage = (a: Attachment) => (a.type || "").startsWith("image/") || /\.(png|jpe?g|webp|gif|bmp)$/i.test(a.name || a.url);
const isVideo = (a: Attachment) => (a.type || "").startsWith("video/") || /\.(mp4|mov|webm|mkv|avi)$/i.test(a.name || a.url);

// Kích thước mỗi mảnh (chunk): 2MB giúp vượt qua mọi giới hạn body size của Next.js Proxy (10MB), Nginx và Cloudflare
const CHUNK_SIZE = 2 * 1024 * 1024; // 2 MB

/**
 * Tải 1 tệp lên /api/upload.
 * - Với tệp <= 2MB: gửi 1 lần trực tiếp.
 * - Với tệp > 2MB (ví dụ hồ sơ năng lực .rar 34MB, .zip, .pdf, video): tự động cắt thành các mảnh 2MB
 *   và tải lên tuần tự có cơ chế thử lại (retry) từng mảnh, đảm bảo không bao giờ bị đứt kết nối hay lỗi 413/500.
 */
export async function uploadSingleFileSmart(
    file: File,
    onProgress?: (pct: number) => void
): Promise<{ success: boolean; name: string; fileName?: string; url: string; size: number; type: string; error?: string }> {
    try {
        if (file.size <= CHUNK_SIZE) {
            const fd = new FormData();
            fd.append("file", file);
            const res = await fetch("/api/upload", { method: "POST", body: fd });
            const d = await res.json().catch(() => ({}));
            if (res.ok && d.success && (d.url || d.fileUrl)) {
                onProgress?.(100);
                return {
                    success: true,
                    name: d.name || file.name,
                    fileName: d.fileName,
                    url: d.url || d.fileUrl,
                    size: d.size || file.size,
                    type: d.type || file.type || "application/octet-stream"
                };
            }
            return {
                success: false,
                name: file.name,
                url: "",
                size: file.size,
                type: file.type,
                error: d.error || `Không tải lên được "${file.name}" (Mã lỗi: ${res.status})`
            };
        }

        // Luồng tải lên phân mảnh (Chunked Upload) cho tệp > 2MB
        const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
        const uploadId = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

        for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
            const start = chunkIndex * CHUNK_SIZE;
            const end = Math.min(start + CHUNK_SIZE, file.size);
            const slice = file.slice(start, end);

            let lastErr = "";
            let chunkSuccess = false;
            let finalData: any = null;

            // Thử lại tối đa 3 lần cho mỗi mảnh 2MB nếu mạng chập chờn
            for (let attempt = 0; attempt < 3; attempt++) {
                try {
                    const fd = new FormData();
                    fd.append("chunk", slice, file.name);
                    fd.append("uploadId", uploadId);
                    fd.append("chunkIndex", String(chunkIndex));
                    fd.append("totalChunks", String(totalChunks));
                    fd.append("fileName", file.name);
                    fd.append("fileSize", String(file.size));
                    fd.append("fileType", file.type || "application/octet-stream");

                    const res = await fetch("/api/upload", { method: "POST", body: fd });
                    const d = await res.json().catch(() => ({}));
                    if (res.ok && d.success) {
                        chunkSuccess = true;
                        finalData = d;
                        break;
                    } else {
                        lastErr = d.error || `Lỗi máy chủ (HTTP ${res.status}) ở phần ${chunkIndex + 1}/${totalChunks}`;
                        // Nếu lỗi 400/413 (định dạng hoặc quá 250MB) thì dừng ngay không cần retry
                        if (res.status === 400 || res.status === 413) break;
                    }
                } catch (e: any) {
                    lastErr = e?.message || "Lỗi kết nối mạng";
                }
            }

            if (!chunkSuccess) {
                return {
                    success: false,
                    name: file.name,
                    url: "",
                    size: file.size,
                    type: file.type,
                    error: lastErr || `Không tải lên được "${file.name}"`
                };
            }

            onProgress?.(Math.round(((chunkIndex + 1) / totalChunks) * 100));

            if (chunkIndex === totalChunks - 1 && finalData) {
                return {
                    success: true,
                    name: finalData.name || file.name,
                    fileName: finalData.fileName,
                    url: finalData.url || finalData.fileUrl,
                    size: finalData.size || file.size,
                    type: finalData.type || file.type || "application/octet-stream"
                };
            }
        }

        return {
            success: false,
            name: file.name,
            url: "",
            size: file.size,
            type: file.type,
            error: `Không hoàn tất ghép tệp "${file.name}"`
        };
    } catch (err: any) {
        return {
            success: false,
            name: file.name,
            url: "",
            size: file.size,
            type: file.type,
            error: err?.message || `Lỗi kết nối khi tải "${file.name}"`
        };
    }
}

/** Tải file lên /api/upload; trả về danh sách file đã lưu (file lỗi được báo qua onError). */
export async function uploadFiles(files: FileList | File[], onError?: (msg: string) => void): Promise<Attachment[]> {
    const out: Attachment[] = [];
    for (const file of Array.from(files)) {
        const res = await uploadSingleFileSmart(file);
        if (res.success && res.url) {
            out.push({
                name: res.name || file.name,
                url: res.url,
                size: res.size || file.size,
                type: res.type || file.type,
                uploaded_at: new Date().toISOString()
            });
        } else {
            onError?.(res.error || `Không tải lên được ${file.name}`);
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
    files, onChange, label = "Tệp đính kèm", hint, accept = "image/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.xlsm,.ppt,.pptx,.csv,.txt,.rtf,.xml,.zip,.rar,.7z,.tar,.gz",
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
        if (added.length > 0) {
            onChange([...(files || []), ...added]);
        }
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

"use client";

import React, { useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, fmtDateTime } from "../api";
import { Button, ErrorNote } from "../ui";

interface DrawingFile {
  id: string;
  file_name: string;
  uploaded_at: string;
  uploaded_by_name: string | null;
}

/** The drawing(s) with the measured IQC values of one subcontract line (required before accepting parts). */
export function LineDrawings({ lineId }: { lineId: string }) {
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const files = useQuery({ queryKey: ["factory", "device", "line-drawings", lineId], queryFn: () => api<DrawingFile[]>(`/api/factory/device/subcontract-lines/${lineId}/files`) });
  const upload = useMutation({
    mutationFn: async (file: File) => {
      const body = new FormData();
      body.append("file", file);
      return api(`/api/factory/device/subcontract-lines/${lineId}/files`, { method: "POST", body });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["factory", "device", "line-drawings", lineId] }),
  });
  const list = files.data ?? [];
  return (
    <div className="flex flex-col gap-1.5 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-bold text-slate-600 dark:text-slate-300">Bản vẽ ghi kết quả QC (bắt buộc khi có SL Đạt):</span>
        {list.length === 0 && <span className="text-amber-600 font-semibold">Chưa có bản vẽ</span>}
        {list.map((f) => (
          <a key={f.id} href={`/api/factory/device/subcontract-lines/${lineId}/files/${f.id}`} target="_blank" rel="noreferrer" className="text-sky-700 dark:text-sky-400 underline" title={`${f.uploaded_by_name ?? ""} · ${fmtDateTime(f.uploaded_at)}`}>
            📎 {f.file_name}
          </a>
        ))}
        <input
          ref={input}
          type="file"
          accept="application/pdf,image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) upload.mutate(f);
            e.target.value = "";
          }}
        />
        <Button variant="ghost" disabled={upload.isPending} onClick={() => input.current?.click()}>
          {upload.isPending ? "Đang tải…" : "+ Tải bản vẽ (PDF / ảnh)"}
        </Button>
      </div>
      <ErrorNote error={upload.error ?? files.error} />
    </div>
  );
}

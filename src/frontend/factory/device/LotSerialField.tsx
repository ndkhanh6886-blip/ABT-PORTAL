"use client";

import React from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { inputClass } from "../ui";

interface LotPreview {
  lot_no: string;
  suggested: string;
  serials: string[];
  lot_taken: boolean;
  taken_serials: string[];
}

/**
 * Số Lô thiết bị (QT 21): the system suggests Model-YYMMDD-Cỡ lô, the user may change it; the serials it will give
 * (YYMMDD + cỡ lô - STT) are previewed, with the ones already used elsewhere flagged before the order is created.
 */
export function LotSerialField({ modelId, qty, value, onChange }: { modelId: string; qty: number; value: string; onChange: (lot: string) => void }) {
  const preview = useQuery({
    queryKey: ["factory", "device", "lot-preview", modelId, qty, value.trim()],
    queryFn: () =>
      api<LotPreview>(`/api/factory/device/lot-preview?model_id=${modelId}&qty=${qty}${value.trim() ? `&lot_no=${encodeURIComponent(value.trim())}` : ""}`),
    enabled: Boolean(modelId) && qty > 0,
    placeholderData: keepPreviousData,
  });
  const p = preview.data;
  const serials = p?.serials ?? [];
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400">Số Lô (hệ thống gợi ý, được sửa)</span>
      <div className="flex gap-2">
        <input
          className={`${inputClass} font-mono flex-1`}
          placeholder={p?.suggested ?? "Model-YYMMDD-Cỡ lô"}
          value={value}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
        />
        {p && value.trim().toUpperCase() !== p.suggested && (
          <button type="button" className="px-2 rounded-lg border border-sky-200 dark:border-sky-800 text-[11px] font-bold text-sky-700 dark:text-sky-300 cursor-pointer whitespace-nowrap" onClick={() => onChange(p.suggested)}>
            Dùng {p.suggested}
          </button>
        )}
      </div>
      {!modelId ? (
        <span className="text-[11px] text-slate-400">Chọn model để hệ thống gợi ý số Lô.</span>
      ) : p ? (
        <span className="text-[11px] text-slate-500 dark:text-slate-400">
          Lô <b className="font-mono">{p.lot_no}</b> → Serial{" "}
          <b className="font-mono">{serials.length > 2 ? `${serials[0]} … ${serials[serials.length - 1]}` : serials.join(", ")}</b>
        </span>
      ) : null}
      {p?.lot_taken && <span className="text-[11px] font-bold text-rose-600">Số Lô này đã được dùng cho lệnh khác.</span>}
      {!!p?.taken_serials.length && (
        <span className="text-[11px] font-bold text-rose-600">
          Trùng Serial đã có: {p.taken_serials.join(", ")} — sửa phần ngày / cỡ lô của số Lô hoặc nhập danh sách Serial thủ công.
        </span>
      )}
    </div>
  );
}

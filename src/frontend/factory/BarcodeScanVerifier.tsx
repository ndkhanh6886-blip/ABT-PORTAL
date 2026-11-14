"use client";

import React, { useMemo, useState } from "react";
import { inputClass } from "./ui";

/**
 * Lightweight shopfloor barcode scan-to-verify widget (USB barcode wedge or manual entry):
 * verifies scanned Lot / Bottle codes against expected FEFO / installed port codes before dispensing or running.
 */
export function BarcodeScanVerifier({
  expectedCodes,
  label = "Quét mã vạch đối chiếu (Scan-to-Verify)",
  placeholder = "Quét hoặc nhập mã lô / mã vạch rồi nhấn Enter...",
  onVerified,
}: {
  expectedCodes: string[];
  label?: string;
  placeholder?: string;
  onVerified?: (matchedCode: string) => void;
}) {
  const [scanInput, setScanInput] = useState("");
  const [verifiedSet, setVerifiedSet] = useState<string[]>([]);
  const [lastResult, setLastResult] = useState<{ ok: boolean; code: string } | null>(null);

  const normalizedMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const raw of expectedCodes) {
      const cleaned = String(raw || "").trim();
      if (cleaned) map.set(cleaned.toUpperCase(), cleaned);
    }
    return map;
  }, [expectedCodes]);

  const verifyCode = () => {
    const candidate = scanInput.trim();
    if (!candidate) return;
    const matched = normalizedMap.get(candidate.toUpperCase());
    if (matched) {
      setLastResult({ ok: true, code: matched });
      setVerifiedSet((prev) => (prev.includes(matched) ? prev : [...prev, matched]));
      onVerified?.(matched);
      setScanInput("");
    } else {
      setLastResult({ ok: false, code: candidate });
    }
  };

  if (normalizedMap.size === 0) return null;

  return (
    <div className="rounded-lg border border-sky-200 dark:border-sky-900/60 bg-sky-50/50 dark:bg-sky-950/20 p-2.5 text-xs space-y-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold text-sky-900 dark:text-sky-200">{label}</span>
        <span className="font-mono text-[11px] text-slate-600 dark:text-slate-300">
          Đã xác minh: <b>{verifiedSet.length}</b> / {normalizedMap.size} mã
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input
          className={`${inputClass} flex-1 min-w-[220px] font-mono`}
          value={scanInput}
          placeholder={placeholder}
          aria-label={label}
          onChange={(e) => setScanInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              verifyCode();
            }
          }}
        />
        <button
          type="button"
          onClick={verifyCode}
          className="px-3 py-1.5 rounded-lg font-semibold bg-sky-600 hover:bg-sky-700 text-white cursor-pointer"
        >
          Đối chiếu
        </button>
      </div>
      {lastResult && (
        <div
          role="status"
          className={`px-2 py-1 rounded font-mono font-semibold ${
            lastResult.ok
              ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-300"
              : "bg-red-100 text-red-900 dark:bg-red-950/60 dark:text-red-300"
          }`}
        >
          {lastResult.ok
            ? `✔ KHỚP MÃ ${lastResult.code} — Đúng lô được cấp phát / đang lắp`
            : `✖ SAI MÃ LÔ "${lastResult.code}" — Không nằm trong danh sách FEFO / cổng máy!`}
        </div>
      )}
    </div>
  );
}

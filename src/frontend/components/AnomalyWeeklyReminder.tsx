"use client";

import React, { useEffect, useState } from "react";
import { AlertTriangle, X } from "lucide-react";

/** Tuần ISO theo giờ Việt Nam, vd "2026-W48". */
function isoWeekKeyVN(): string {
  const vn = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Ho_Chi_Minh" }));
  const d = new Date(Date.UTC(vn.getFullYear(), vn.getMonth(), vn.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/**
 * Nhắc báo cáo bất thường hàng tuần: lần đầu trong tuần Quản trị viên / BGĐ mở phần mềm, nếu 7 ngày qua có mục bất thường
 * thì hiện một dải thông báo (ẩn được, chỉ hiện lại ở tuần sau). Không cần máy chủ chạy lịch hẹn giờ.
 */
export function AnomalyWeeklyReminder({ userKey, onOpen }: { userKey: string; onOpen: () => void }) {
  const [summary, setSummary] = useState<{ total: number; high: number; week: string } | null>(null);
  const storageKey = `tbr_anomaly_seen_${userKey}`;

  useEffect(() => {
    const week = isoWeekKeyVN();
    let seen = "";
    try { seen = localStorage.getItem(storageKey) || ""; } catch {}
    if (seen === week) return;
    let cancelled = false;
    fetch("/api/reports?action=anomaly_summary&days=7")
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (cancelled || !d) return;
        const total = Number(d.total) || 0;
        if (total === 0) {
          try { localStorage.setItem(storageKey, week); } catch {}
          return;
        }
        const high = (d.sections || []).filter((s: any) => s.severity === "high").reduce((n: number, s: any) => n + (Number(s.count) || 0), 0);
        setSummary({ total, high, week });
      })
      .catch(err => console.warn("[anomaly] Không tải được tóm tắt báo cáo bất thường:", err));
    return () => { cancelled = true; };
  }, [storageKey]);

  if (!summary) return null;
  const dismiss = () => {
    try { localStorage.setItem(storageKey, summary.week); } catch {}
    setSummary(null);
  };
  return (
    <div className="mb-3 rounded-xl border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
      <span className="flex items-center gap-2 text-amber-800 dark:text-amber-200 font-semibold">
        <AlertTriangle className="w-4 h-4" />
        Báo cáo bất thường tuần {summary.week.split("-W")[1]}: {summary.total} mục cần xem
        {summary.high > 0 ? ` (${summary.high} mục mức cao)` : ""}.
      </span>
      <span className="flex items-center gap-2">
        <button type="button" onClick={() => { dismiss(); onOpen(); }}
          className="px-3 py-1 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-bold cursor-pointer">
          Xem báo cáo
        </button>
        <button type="button" onClick={dismiss} title="Ẩn đến tuần sau"
          className="p-1 rounded text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/50 cursor-pointer">
          <X className="w-3.5 h-3.5" />
        </button>
      </span>
    </div>
  );
}

"use client";

import React, { useEffect, useState } from "react";
import { hydrateServerBackedKeys } from "@/frontend/utils/storageSync";

/**
 * Loads the server copy of shared data that modules read from localStorage before those modules
 * mount, and warns the user when a save was rejected because someone else changed the same data.
 */
export function DataSyncGate({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [offline, setOffline] = useState(false);
  const [conflictKey, setConflictKey] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Do not block the portal forever if the server is slow; shared keys are then only merged (never wiped)
    const timer = setTimeout(() => { if (!cancelled) setReady(true); }, 8000);
    hydrateServerBackedKeys().then(ok => {
      if (cancelled) return;
      clearTimeout(timer);
      setOffline(!ok);
      setReady(true);
    });
    return () => { cancelled = true; clearTimeout(timer); };
  }, []);

  useEffect(() => {
    const onConflict = (e: any) => setConflictKey(e?.detail?.key || "dữ liệu");
    window.addEventListener("tbr:storage-conflict", onConflict);
    return () => window.removeEventListener("tbr:storage-conflict", onConflict);
  }, []);

  if (!ready) {
    return (
      <div className="min-h-[50vh] flex items-center justify-center text-slate-500">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-3 border-orange-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-xs font-mono">Đang đồng bộ dữ liệu từ máy chủ...</span>
        </div>
      </div>
    );
  }

  return (
    <>
      {offline && (
        <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
          Không tải được một phần dữ liệu dùng chung từ máy chủ. Thay đổi vẫn được gửi lên máy chủ khi có kết nối; vui lòng tải lại trang để xem dữ liệu mới nhất.
        </div>
      )}
      {conflictKey && (
        <div className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-700 dark:bg-red-950 dark:text-red-200">
          <span>Thay đổi gần nhất của bạn ({conflictKey}) chưa được lưu vì dữ liệu vừa được người khác cập nhật. Vui lòng tải lại trang và thao tác lại.</span>
          <button className="shrink-0 rounded border border-red-300 px-2 py-1 font-semibold" onClick={() => window.location.reload()}>Tải lại</button>
        </div>
      )}
      {children}
    </>
  );
}

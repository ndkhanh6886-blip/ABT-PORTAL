"use client";

import React, { useEffect, useState } from "react";
import { hydrateServerBackedKeys } from "@/frontend/utils/storageSync";

/**
 * Loads the server copy of shared data that modules read from localStorage before those modules
 * mount, and warns the user when a save was rejected because someone else changed the same data.
 */
const STORAGE_KEY_LABELS: Record<string, string> = {
  sales_factory_orders: "Đơn hàng (SO)",
  sales_delivery_slips: "Phiếu giao hàng",
  sales_quotations: "Báo giá",
  sales_contracts: "Hợp đồng",
  sales_customers: "Khách hàng",
  sales_tasks: "Công việc Kinh doanh",
  sales_plans: "Kế hoạch Kinh doanh",
  sales_daily_logs: "Nhật ký Kinh doanh",
  sales_commercial_products: "Danh mục sản phẩm",
  workspace_proposals: "Đề xuất / phê duyệt",
  tbr_activity_notifications: "Thông báo",
};
function storageKeyLabel(key: string): string {
  return STORAGE_KEY_LABELS[key] || key;
}

export function DataSyncGate({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState<boolean>(() => {
    if (typeof window !== "undefined") {
      try {
        return Boolean(
          window.localStorage.getItem("tbr_data_epoch") ||
          window.localStorage.getItem("tbr_current_user") ||
          window.localStorage.getItem("current_user")
        );
      } catch {}
    }
    return false;
  });
  const [offline, setOffline] = useState(false);
  const [conflictKey, setConflictKey] = useState<string | null>(null);
  // Các khối dữ liệu lưu lên máy chủ thất bại (chưa có lần lưu thành công sau đó)
  const [saveFailures, setSaveFailures] = useState<Record<string, string>>({});

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

  useEffect(() => {
    const onFailed = (e: any) => {
      const key = String(e?.detail?.key || "dữ liệu");
      setSaveFailures(prev => ({ ...prev, [key]: String(e?.detail?.message || "Lỗi không xác định") }));
    };
    const onOk = (e: any) => {
      const key = String(e?.detail?.key || "");
      setSaveFailures(prev => {
        if (!(key in prev)) return prev;
        const next = { ...prev };
        delete next[key];
        return next;
      });
    };
    window.addEventListener("tbr:storage-save-failed", onFailed);
    window.addEventListener("tbr:storage-save-ok", onOk);
    return () => {
      window.removeEventListener("tbr:storage-save-failed", onFailed);
      window.removeEventListener("tbr:storage-save-ok", onOk);
    };
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
      {Object.keys(saveFailures).length > 0 && (
        <div role="alert" className="mb-3 flex items-start justify-between gap-3 rounded-lg border border-red-400 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-700 dark:bg-red-950 dark:text-red-200">
          <div className="space-y-1">
            <div className="font-bold">⚠ Có thay đổi CHƯA được lưu lên máy chủ — hiện chỉ có trên máy này, người khác không thấy:</div>
            {Object.entries(saveFailures).map(([key, msg]) => (
              <div key={key}>• <b>{storageKeyLabel(key)}</b>: {msg}</div>
            ))}
            <div>Không đóng trang. Kiểm tra lại thao tác (quyền, dữ liệu) rồi lưu lại; nếu vẫn lỗi, chụp màn hình gửi Quản trị viên.</div>
          </div>
          <button className="shrink-0 rounded border border-red-300 px-2 py-1 font-semibold" onClick={() => setSaveFailures({})}>Đã hiểu</button>
        </div>
      )}
      {children}
    </>
  );
}

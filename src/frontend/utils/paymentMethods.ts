"use client";

import { useEffect, useState } from "react";

/** Khóa app_storage của danh sách phương thức thanh toán (Cài đặt > Tài chính) */
export const PAYMENT_METHODS_KEY = "finance_payment_methods";
export const PAYMENT_METHODS_UPDATED_EVENT = "finance_payment_methods_updated";

/** Mặc định khi chưa cấu hình trong Cài đặt */
export const DEFAULT_PAYMENT_METHODS = ["Chuyển khoản ACB", "Chuyển khoản Techcombank", "Chi tiền mặt"];

export const normalizePaymentMethods = (v: unknown): string[] => {
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  return v.map((x) => String(x ?? "").trim()).filter((x) => x && !seen.has(x) && (seen.add(x), true));
};

/** Danh sách phương thức thanh toán đang dùng (tự cập nhật khi Cài đặt lưu thay đổi) */
export const usePaymentMethods = (): string[] => {
  const [methods, setMethods] = useState<string[]>(DEFAULT_PAYMENT_METHODS);
  useEffect(() => {
    let alive = true;
    fetch(`/api/storage?key=${PAYMENT_METHODS_KEY}`)
      .then((r) => r.json())
      .then((d) => {
        const list = normalizePaymentMethods(d?.data);
        if (alive && list.length > 0) setMethods(list);
      })
      .catch(() => {});
    const onUpdate = (e: Event) => {
      const list = normalizePaymentMethods((e as CustomEvent).detail);
      if (list.length > 0) setMethods(list);
    };
    window.addEventListener(PAYMENT_METHODS_UPDATED_EVENT, onUpdate);
    return () => {
      alive = false;
      window.removeEventListener(PAYMENT_METHODS_UPDATED_EVENT, onUpdate);
    };
  }, []);
  return methods;
};

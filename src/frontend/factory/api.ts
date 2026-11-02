"use client";

import { useEffect, useState } from "react";
import { QueryClient, useQuery } from "@tanstack/react-query";

/** Hook trì hoãn giá trị tìm kiếm (Debounce) để tránh bắn truy vấn SQL dồn dập trên mỗi phím gõ khi dữ liệu lớn. */
export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState<T>(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

/** Error from a factory API call; `message` is the server's Vietnamese explanation. */
export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string, readonly details?: unknown) {
    super(message);
  }
}

export async function api<T>(path: string, init: RequestInit & { json?: unknown; idempotent?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
  const method = (init.method ?? "GET").toUpperCase();
  if (init.json !== undefined || (typeof init.body === "string" && !headers["Content-Type"])) {
    headers["Content-Type"] = "application/json";
  }
  if ((init.idempotent || ["POST", "PUT", "PATCH"].includes(method)) && !headers["Idempotency-Key"]) {
    headers["Idempotency-Key"] = crypto.randomUUID();
  }
  const res = await fetch(path, {
    ...init,
    headers,
    body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
    credentials: "same-origin",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error || `Lỗi ${res.status}`, res.status, data.code, data.details);
  return data as T;
}

export const factoryQueryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 15_000, retry: (n, e) => n < 2 && !(e instanceof ApiError && e.status < 500) } },
});

export interface FactoryMe {
  profile: { user_id: number; display_name: string; org_unit_id: string | null; has_pin: boolean };
  /** Root administrator: every factory permission, grants roles to others. */
  is_root: boolean;
  permissions: string[];
}

export function useFactoryMe(enabled = true) {
  return useQuery({ queryKey: ["factory", "me"], queryFn: () => api<FactoryMe>("/api/factory/me"), enabled, staleTime: 60_000 });
}

export function hasAny(me: FactoryMe | undefined, prefixes: string[]): boolean {
  return Boolean(me?.permissions.some((p) => prefixes.some((x) => p === x || p.startsWith(`${x}.`))));
}

const qtyFmt = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 6 });
export const fmtQty = (v: string | number | null | undefined) => (v == null || v === "" ? "—" : qtyFmt.format(Number(v)));

/** YYYY-MM-DD → dd/mm/yyyy (calendar dates carry no time zone). */
export const fmtDate = (v: string | null | undefined) => (v ? v.slice(0, 10).split("-").reverse().join("/") : "—");

/** Ngày hiện tại theo múi giờ Việt Nam (Asia/Ho_Chi_Minh) dạng YYYY-MM-DD, tránh lệch ngày từ 00:00–07:00 sáng so với UTC. */
export const vnToday = (): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date());

/** Chuẩn hóa chuỗi chống XSS khi chèn vào cửa sổ in HTML (`win.document.write`). */
export const escHtml = (v: unknown): string =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

export const fmtDateTime = (v: string | null | undefined) =>
  v ? new Date(v).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }) : "—";

const vndFmt = new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND", maximumFractionDigits: 0 });
export const fmtVnd = (v: string | number | null | undefined) => (v == null || v === "" ? "—" : vndFmt.format(Number(v)));

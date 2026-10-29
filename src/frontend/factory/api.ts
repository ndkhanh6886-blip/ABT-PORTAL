"use client";

import { QueryClient, useQuery } from "@tanstack/react-query";

/** Error from a factory API call; `message` is the server's Vietnamese explanation. */
export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string, readonly details?: unknown) {
    super(message);
  }
}

export async function api<T>(path: string, init: RequestInit & { json?: unknown; idempotent?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
  if (init.json !== undefined) headers["Content-Type"] = "application/json";
  if (init.idempotent) headers["Idempotency-Key"] = crypto.randomUUID();
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

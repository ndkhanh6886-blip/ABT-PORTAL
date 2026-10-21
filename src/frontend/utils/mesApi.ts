/**
 * Shared utility to resolve the active MES Production API Base URL.
 * Defaults to "" so no external MES API requests are sent unless NEXT_PUBLIC_MES_API_URL is explicitly configured.
 */
export function getMesApiBase(): string {
  return process.env.NEXT_PUBLIC_MES_API_URL || "";
}


/**
 * HTML escaping for pages built with template strings (PDF/print views).
 * Customer names, product names, notes... come from users (portal forms, Zalo bot, Excel imports);
 * inserted raw they could carry <script> that runs with a signed-in employee's session.
 * Numeric entities are used so the result stays valid after .toUpperCase().
 */

const ENTITIES: Record<string, string> = { "&": "&#38;", "<": "&#60;", ">": "&#62;", '"': "&#34;", "'": "&#39;", "`": "&#96;" };

export function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).replace(/[&<>"'`]/g, ch => ENTITIES[ch]);
}

/** Escapes every string inside a value (objects / arrays recursively); numbers, booleans and dates are kept. */
export function escapeDeep<T>(value: T): T {
  if (typeof value === "string") return escapeHtml(value) as unknown as T;
  if (Array.isArray(value)) return value.map(v => escapeDeep(v)) as unknown as T;
  if (value && typeof value === "object" && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = escapeDeep(v);
    return out as T;
  }
  return value;
}

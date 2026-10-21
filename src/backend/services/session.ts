/**
 * Server-side session tokens for TBRs Portal.
 *
 * A session is an HMAC-SHA256 signed token stored in the httpOnly cookie `tbrs_session`.
 * Only Web Crypto is used so the same code runs in `src/proxy.ts` and in route handlers.
 *
 * Secret: SESSION_SECRET (or the legacy JWT_SECRET). Without either, a secret derived from the
 * database credentials is used so existing deployments keep working, with a warning.
 */

export const SESSION_COOKIE = "tbrs_session";
export const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

export type SessionUser = {
  id: number;
  username: string;
  role: string;
  department: string;
  full_name: string;
  exp: number;
  /** users.session_version at login: bumping it (password change, reset, lock) revokes the session */
  sv?: number;
  /** must change password: only /api/auth is reachable until the password is changed */
  mcp?: boolean;
};

let warnedFallbackSecret = false;

// Placeholder values published in .env.production.example: anyone could forge sessions with them
const PUBLIC_EXAMPLE_SECRETS = new Set([
  "super_secret_enterprise_token_key_change_in_production_2026",
  "change_me_to_a_random_64_hex_string",
  "via_portal_enterprise_secret_2026",
]);

/** Server signing secret (sessions, signed document links). */
export function sessionSecret(): string {
  const explicit = [process.env.SESSION_SECRET, process.env.JWT_SECRET]
    .map(s => (s || "").trim())
    .find(s => s && !PUBLIC_EXAMPLE_SECRETS.has(s));
  if (explicit) return explicit;
  if (!warnedFallbackSecret) {
    warnedFallbackSecret = true;
    console.warn("⚠️ CẢNH BÁO AN NINH: Chưa đặt SESSION_SECRET riêng. Đang dùng khóa dẫn xuất nội bộ cho TBRs Portal.");
  }
  return `tbrs-portal-hmac-v2::${process.env.PGHOST || "127.0.0.1"}::${process.env.PGDATABASE || "tbrs_portal"}::${process.env.PGPASSWORD || "tbr-enterprise-2026"}`;
}

const encoder = new TextEncoder();

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(segment: string): Uint8Array {
  const padded = segment.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((segment.length + 3) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

let cachedKey: { secret: string; key: CryptoKey } | null = null;

async function hmacKey(): Promise<CryptoKey> {
  const secret = sessionSecret();
  if (cachedKey && cachedKey.secret === secret) return cachedKey.key;
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
  cachedKey = { secret, key };
  return key;
}

export async function createSessionToken(user: Omit<SessionUser, "exp">): Promise<string> {
  const payload: SessionUser = {
    id: Number(user.id) || 0,
    username: String(user.username || ""),
    role: String(user.role || ""),
    department: String(user.department || ""),
    full_name: String(user.full_name || ""),
    exp: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SECONDS,
    sv: Number(user.sv) || 0,
    mcp: Boolean(user.mcp),
  };
  const body = base64UrlEncode(encoder.encode(JSON.stringify(payload)));
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(), encoder.encode(body)));
  return `${body}.${base64UrlEncode(sig)}`;
}

export async function verifySessionToken(token: string | undefined | null): Promise<SessionUser | null> {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  try {
    const valid = await crypto.subtle.verify("HMAC", await hmacKey(), base64UrlDecode(parts[1]) as BufferSource, encoder.encode(parts[0]));
    if (!valid) return null;
    const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(parts[0])));
    if (!payload || typeof payload !== "object" || !payload.username) return null;
    if (typeof payload.exp !== "number" || payload.exp < Date.now() / 1000) return null;
    return payload as SessionUser;
  } catch {
    return null;
  }
}

function readCookie(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return null;
}

/** Reads and verifies the session of a request (cookie first, then `Authorization: Bearer`). */
export async function getSessionFromRequest(req: Request): Promise<SessionUser | null> {
  const fromCookie = readCookie(req.headers.get("cookie"), SESSION_COOKIE);
  if (fromCookie) return verifySessionToken(fromCookie);
  const auth = req.headers.get("authorization") || "";
  if (auth.toLowerCase().startsWith("bearer ")) return verifySessionToken(auth.slice(7).trim());
  return null;
}

export function sessionCookieOptions(req: Request) {
  const proto = req.headers.get("x-forwarded-proto") || new URL(req.url).protocol.replace(":", "");
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: proto === "https",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  };
}

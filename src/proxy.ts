import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/backend/services/session";

const IS_DEV = process.env.NODE_ENV !== "production";

/** Headers of every response (pages, API, files). The Content-Security-Policy is built per request below. */
const SECURITY_HEADERS: Record<string, string> = {
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
  "X-Frame-Options": "SAMEORIGIN",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(self), microphone=(), geolocation=(), browsing-topics=(), payment=(), usb=(), interest-cohort=()",
  "X-DNS-Prefetch-Control": "off",
  "X-Permitted-Cross-Domain-Policies": "none",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Origin-Agent-Cluster": "?1",
};

/**
 * Policy of a page. Scripts run only when they carry this request's nonce (Next puts it on its own scripts) or
 * come from this site: no 'unsafe-inline', no 'unsafe-eval' in production. Inline styles stay allowed: React
 * `style` attributes cannot carry a nonce.
 */
function pageCsp(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' https://static.cloudflareinsights.com${IS_DEV ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data: https://fonts.gstatic.com",
    `connect-src 'self' https://cloudflareinsights.com${IS_DEV ? " ws: wss:" : ""}`,
    "media-src 'self' data: blob:",
    "worker-src 'self' blob:",
    "frame-src 'self' blob: data:",
    "frame-ancestors 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    ...(IS_DEV ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

/**
 * API responses are data or files: scripts are forbidden outright. `default-src 'self'` stays so that the browser's
 * PDF / image viewers keep working for attachments opened inline.
 */
const API_CSP = "default-src 'self'; script-src 'none'; object-src 'none'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'";

/** Routes that answer with their own page (own CSP with a nonce) or stream files: no policy added here. */
const OWN_CSP_ROUTES = new Set(["/api/upload", "/api/zalo/quotation-pdf", "/api/zalo/contract-pdf"]);

function applyHeaders(res: NextResponse, extra: Record<string, string> = {}): NextResponse {
  for (const [k, v] of Object.entries({ ...SECURITY_HEADERS, ...extra })) {
    if (!res.headers.has(k)) res.headers.set(k, v);
  }
  return res;
}

function apiResponse(res: NextResponse, pathname: string): NextResponse {
  applyHeaders(res, OWN_CSP_ROUTES.has(pathname) ? {} : { "Content-Security-Policy": API_CSP });
  if (!res.headers.has("Cache-Control")) res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
  return res;
}

/**
 * Every /api route requires a valid staff session, except the endpoints listed here:
 * login, health check, Zalo webhook / PDF links opened from Zalo, and the customer portal
 * (which authenticates customers itself and checks staff sessions for its internal actions).
 */
function isPublicApi(pathname: string, method: string): boolean {
  if (pathname === "/api/health") return true;
  if (pathname === "/api/auth" && method === "POST") return true; // login / change_password check credentials themselves
  if (pathname === "/api/zalo/webhook") return true;
  if (pathname === "/api/zalo/quotation-pdf" || pathname === "/api/zalo/contract-pdf") return true;
  if (pathname === "/api/portal/customer") return true;
  return false;
}

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * CSRF defence next to SameSite cookies: a browser always sends `Origin` on a cross-site write, and it must be this
 * site. Requests without `Origin` (the Zalo webhook, scripts, Bearer clients) are not browser form posts and
 * pass: they still need a session or their own signature.
 */
function isCrossSiteWrite(request: NextRequest): boolean {
  if (!MUTATING.has(request.method.toUpperCase())) return false;
  const origin = request.headers.get("origin");
  if (!origin) return request.headers.get("sec-fetch-site") === "cross-site";
  let originHost: string;
  try {
    originHost = new URL(origin).host.toLowerCase();
  } catch {
    return true; // "null" origin (sandboxed / data: documents) or garbage
  }
  const hosts = new Set<string>();
  for (const h of [request.headers.get("x-forwarded-host"), request.headers.get("host"), request.nextUrl.host]) {
    for (const part of String(h || "").split(",")) if (part.trim()) hosts.add(part.trim().toLowerCase());
  }
  try {
    if (process.env.NEXT_PUBLIC_APP_URL) hosts.add(new URL(process.env.NEXT_PUBLIC_APP_URL).host.toLowerCase());
  } catch { /* ignore a malformed URL */ }
  for (const extra of String(process.env.ALLOWED_ORIGINS || "").split(",")) {
    const e = extra.trim();
    if (!e) continue;
    try { hosts.add(new URL(e).host.toLowerCase()); } catch { hosts.add(e.toLowerCase()); }
  }
  return !hosts.has(originHost);
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Pages: a fresh nonce per request, handed to Next through the request headers and sent back in the policy
  if (!pathname.startsWith("/api/")) {
    const nonce = btoa(crypto.randomUUID());
    const csp = pageCsp(nonce);
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("x-nonce", nonce);
    requestHeaders.set("Content-Security-Policy", csp);
    const res = NextResponse.next({ request: { headers: requestHeaders } });
    res.headers.set("Content-Security-Policy", csp);
    return applyHeaders(res);
  }

  if (isCrossSiteWrite(request)) {
    return apiResponse(NextResponse.json({ error: "Yêu cầu bị từ chối: nguồn gửi không thuộc hệ thống.", code: "CROSS_SITE" }, { status: 403 }), pathname);
  }
  if (isPublicApi(pathname, request.method.toUpperCase())) {
    return apiResponse(NextResponse.next(), pathname);
  }

  const session = await getSessionFromRequest(request);
  if (!session) {
    return apiResponse(
      NextResponse.json(
        { error: "Phiên đăng nhập không hợp lệ hoặc đã hết hạn. Vui lòng đăng nhập lại.", unauthorized: true },
        { status: 401 }
      ),
      pathname
    );
  }
  // Default password still in use: only the account endpoints work until it is changed
  if (session.mcp && pathname !== "/api/auth") {
    return apiResponse(
      NextResponse.json(
        { error: "Bạn cần đổi mật khẩu mặc định trước khi sử dụng hệ thống.", must_change_password: true },
        { status: 403 }
      ),
      pathname
    );
  }
  return apiResponse(NextResponse.next(), pathname);
}

export const config = {
  matcher: [
    "/api/:path*",
    // every page (not files): static assets get their headers from next.config.ts
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpe?g|gif|svg|webp|ico|pdf|xlsx?|docx?|txt|json|xml|woff2?)$).*)",
  ],
};

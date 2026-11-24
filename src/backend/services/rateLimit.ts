/**
 * Small in-memory fixed-window limiter (per server process) for public endpoints:
 * login / password change attempts per IP, customer-portal submissions.
 */

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

export function clientIp(req: Request): string {
  const trustProxy = process.env.TRUST_PROXY === "true";
  if (trustProxy) {
    const cfIp = req.headers.get("cf-connecting-ip");
    if (cfIp && cfIp.trim()) return cfIp.trim();
    const realIp = req.headers.get("x-real-ip");
    if (realIp && realIp.trim()) return realIp.trim();
  }
  const fwd = req.headers.get("x-forwarded-for") || "";
  let ip = "";
  if (fwd.trim()) {
    const parts = fwd.split(",").map(s => s.trim()).filter(Boolean);
    if (parts.length > 0) ip = parts[parts.length - 1];
  }
  if (!ip) ip = (req.headers.get("x-real-ip") || "").split(",")[0].trim();
  // Chạy sau Cloudflare Tunnel (cloudflared trên chính máy chủ): mọi yêu cầu đều đến từ 127.0.0.1, nên giới hạn theo IP
  // trở thành giới hạn chung cho cả công ty (vài người gõ sai là khóa đăng nhập của tất cả). Khi kết nối đến từ máy
  // chủ nội bộ thì dùng IP thật Cloudflare chuyển kèm (cf-connecting-ip).
  const cfIp = (req.headers.get("cf-connecting-ip") || "").trim();
  if (cfIp && (!ip || isLoopbackIp(ip))) return cfIp;
  return ip || cfIp || "unknown";
}

function isLoopbackIp(ip: string): boolean {
  return ip === "::1" || ip === "127.0.0.1" || ip.startsWith("127.") || ip === "::ffff:127.0.0.1" || ip === "localhost";
}

/** IP không phân biệt được người dùng (loopback / không rõ): không dùng để khóa theo IP. */
export function isSharedIp(ip: string): boolean {
  return !ip || ip === "unknown" || isLoopbackIp(ip);
}

/** Counts one hit for `key`; returns false (and the seconds to wait) when the limit is exceeded. */
export function hitRateLimit(key: string, limit: number, windowMs: number): { allowed: boolean; retryAfterSec: number } {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    b = { count: 0, resetAt: now + windowMs };
    buckets.set(key, b);
  }
  b.count += 1;
  if (buckets.size > 10000) {
    for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
  }
  return { allowed: b.count <= limit, retryAfterSec: Math.max(1, Math.ceil((b.resetAt - now) / 1000)) };
}

export function isRateLimited(key: string, limit: number): boolean {
  const b = buckets.get(key);
  return Boolean(b && b.resetAt > Date.now() && b.count >= limit);
}

export function resetRateLimit(key: string) {
  buckets.delete(key);
}

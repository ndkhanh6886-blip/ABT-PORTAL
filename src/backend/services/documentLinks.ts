import crypto from "crypto";
import { sessionSecret, getSessionFromRequest } from "@/backend/services/session";

/**
 * Signed, expiring links for documents sent outside the portal (Zalo messages).
 * Without a signature anybody could enumerate quotation/contract codes (BG26-XX-1001, ...) and read
 * every customer's prices. Staff with a valid portal session can still open documents without one.
 */

export type DocumentKind = "quotation" | "contract";

const DEFAULT_TTL_DAYS = Number(process.env.DOCUMENT_LINK_TTL_DAYS || 30);
const BASE_APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://abt-portal.com";

function signature(kind: DocumentKind, code: string, exp: number): string {
  return crypto
    .createHmac("sha256", `doc-link::${sessionSecret()}`)
    .update(`${kind}|${code}|${exp}`)
    .digest("base64url");
}

/** Full URL of a document with an expiring signature, for use in Zalo messages. */
export function signedDocumentUrl(kind: DocumentKind, code: string, ttlDays = DEFAULT_TTL_DAYS): string {
  const exp = Math.floor(Date.now() / 1000) + Math.max(1, ttlDays) * 24 * 60 * 60;
  const path = kind === "quotation" ? "/api/zalo/quotation-pdf" : "/api/zalo/contract-pdf";
  const params = new URLSearchParams({ code, exp: String(exp), sig: signature(kind, code, exp) });
  return `${BASE_APP_URL}${path}?${params.toString()}`;
}

function validSignature(kind: DocumentKind, code: string, expRaw: string | null, sig: string | null): boolean {
  const exp = Number(expRaw);
  if (!code || !sig || !Number.isFinite(exp) || exp < Date.now() / 1000) return false;
  const expected = Buffer.from(signature(kind, code, exp));
  const actual = Buffer.from(sig);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

/** True when the request may read the document: a valid signed link, or a signed-in staff member. */
export async function canAccessDocument(req: Request, kind: DocumentKind, code: string): Promise<boolean> {
  const { searchParams } = new URL(req.url);
  if (validSignature(kind, code, searchParams.get("exp"), searchParams.get("sig"))) return true;
  const session = await getSessionFromRequest(req);
  return Boolean(session && session.role !== "customer");
}

export function documentAccessDeniedResponse(): Response {
  return new Response(
    "<h1>Liên kết không hợp lệ hoặc đã hết hạn</h1><p>Vui lòng yêu cầu nhân viên kinh doanh gửi lại liên kết tài liệu mới, hoặc đăng nhập ABT Portal để xem.</p>",
    { status: 403, headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
}

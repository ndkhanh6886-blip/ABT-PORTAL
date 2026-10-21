import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/backend/services/session";

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

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (isPublicApi(pathname, request.method.toUpperCase())) return NextResponse.next();

  const session = await getSessionFromRequest(request);
  if (!session) {
    return NextResponse.json(
      { error: "Phiên đăng nhập không hợp lệ hoặc đã hết hạn. Vui lòng đăng nhập lại.", unauthorized: true },
      { status: 401 }
    );
  }
  // Default password still in use: only the account endpoints work until it is changed
  if (session.mcp && pathname !== "/api/auth") {
    return NextResponse.json(
      { error: "Bạn cần đổi mật khẩu mặc định trước khi sử dụng hệ thống.", must_change_password: true },
      { status: 403 }
    );
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/api/:path*"],
};

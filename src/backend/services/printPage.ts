import { NextResponse } from "next/server";
import { internalErrorResponse } from "@/backend/services/apiErrors";

/**
 * Answers a printable HTML document (quotation / contract opened from a Zalo link) with its own strict policy:
 * no script runs except the one small print handler, which carries this response's nonce. Inline `onclick`
 * attributes would be blocked, so the print button is wired by that script.
 */
export function printablePageResponse(html: string, status = 200): NextResponse {
  const nonce = btoa(crypto.randomUUID());
  const script = `<script nonce="${nonce}">document.querySelectorAll("[data-print]").forEach(function(b){b.addEventListener("click",function(){window.print();});});</script>`;
  const body = html.includes("</body>") ? html.replace("</body>", `${script}</body>`) : html + script;
  return new NextResponse(body, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data: https:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`,
      "Cache-Control": "no-store",
    },
  });
}

export function printableErrorResponse(error: unknown, context: string): NextResponse {
  const res = internalErrorResponse(error, 500, context);
  return new NextResponse("Lỗi hệ thống khi kết xuất tài liệu. Vui lòng liên hệ quản trị viên.", {
    status: res.status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Content-Security-Policy": "default-src 'none'" },
  });
}

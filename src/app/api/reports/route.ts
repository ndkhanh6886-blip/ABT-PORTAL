import { NextRequest, NextResponse } from "next/server";
import { getAuthorizedUser, isAdminUser, unauthorizedResponse, forbiddenResponse, setAuditActor } from "@/backend/services/authz";
import { hasPermission } from "@/backend/services/permissions";
import { buildAnomalyReport } from "@/backend/services/anomalyReport";

/** Báo cáo bất thường: chỉ Quản trị viên / BGĐ và người có quyền duyệt đơn hoặc xem nhật ký. */
function canViewAnomalies(user: any): boolean {
  return isAdminUser(user) || hasPermission(user, "sales.approve_orders") || hasPermission(user, "settings.view_audit");
}

export async function GET(req: NextRequest) {
  try {
    const me = await getAuthorizedUser(req);
    setAuditActor(me);
    if (!me) return unauthorizedResponse();
    if (!canViewAnomalies(me)) return forbiddenResponse("Chỉ Ban Giám Đốc / quản lý được xem báo cáo bất thường.");
    const { searchParams } = new URL(req.url);
    const action = searchParams.get("action") || "anomalies";
    if (action === "anomalies" || action === "anomaly_summary") {
      const days = Number(searchParams.get("days")) || 7;
      const report = await buildAnomalyReport(days);
      if (action === "anomaly_summary") {
        return NextResponse.json({
          total: report.total,
          days: report.days,
          sections: report.sections.filter(s => s.rows.length > 0).map(s => ({ key: s.key, title: s.title, severity: s.severity, count: s.rows.length })),
        });
      }
      return NextResponse.json(report);
    }
    return NextResponse.json({ error: "Hành động không hợp lệ" }, { status: 400 });
  } catch (error: any) {
    console.error("[reports] Lỗi tạo báo cáo:", error);
    return NextResponse.json({ error: error?.message || "Không tạo được báo cáo" }, { status: 500 });
  }
}

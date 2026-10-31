import { NextResponse } from "next/server";
import { getAuthorizedUser, isAdminUser, unauthorizedResponse } from "@/backend/services/authz";
import { clientIp } from "@/backend/services/rateLimit";
import { withTransaction } from "@/factory/core/db";
import { FactoryError } from "@/factory/core/errors";
import { exportRoadmapIcs } from "@/factory/rd/projects";

export const GET = async (req: Request) => {
  const user = await getAuthorizedUser(req);
  if (!user) return unauthorizedResponse();
  const url = new URL(req.url);
  const projectId = url.searchParams.get("project_id") ?? undefined;
  const actor = { userId: Number(user.id), name: user.full_name || user.username, isPortalAdmin: isAdminUser(user), isRootAdmin: user.role === "admin", ip: clientIp(req) };
  try {
    const ics = await withTransaction((tx) => exportRoadmapIcs(tx, actor, projectId));
    return new NextResponse(ics, {
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": `attachment; filename="abt-rd-roadmap.ics"`,
      },
    });
  } catch (e: any) {
    if (e instanceof FactoryError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: "Không xuất được lịch .ics" }, { status: 500 });
  }
};

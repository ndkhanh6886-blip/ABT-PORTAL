import { NextResponse } from "next/server";
import { getAuthorizedUser, isAdminUser, unauthorizedResponse } from "@/backend/services/authz";
import { clientIp } from "@/backend/services/rateLimit";
import { withTransaction } from "@/factory/core/db";
import { FactoryError, invalid } from "@/factory/core/errors";
import { factoryRoute } from "@/factory/http";
import { attachDeliverableFile, readDeliverableFile, updateGateDeliverable } from "@/factory/rd/projects";

export const PUT = factoryRoute((tx, { actor, params, body }) => updateGateDeliverable(tx, actor, params.id, body));

export const GET = async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const user = await getAuthorizedUser(req);
  if (!user) return unauthorizedResponse();
  const { id } = await params;
  const actor = { userId: Number(user.id), name: user.full_name || user.username, isPortalAdmin: isAdminUser(user), isRootAdmin: user.role === "admin", ip: clientIp(req) };
  try {
    const file = await withTransaction((tx) => readDeliverableFile(tx, actor, id));
    return new NextResponse(new Uint8Array(file.data), {
      headers: {
        "Content-Type": file.mimeType,
        "Content-Disposition": `attachment; filename="${encodeURIComponent(file.fileName)}"`,
      },
    });
  } catch (e: any) {
    if (e instanceof FactoryError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: "Không tải được file hồ sơ cổng." }, { status: 500 });
  }
};

export const POST = async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const user = await getAuthorizedUser(req);
  if (!user) return unauthorizedResponse();
  const { id } = await params;
  const actor = { userId: Number(user.id), name: user.full_name || user.username, isPortalAdmin: isAdminUser(user), isRootAdmin: user.role === "admin", ip: clientIp(req) };
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw invalid("Chọn file hồ sơ để đính kèm.");
    const data = Buffer.from(await file.arrayBuffer());
    const saved = await withTransaction((tx) => attachDeliverableFile(tx, actor, id, { fileName: file.name, mimeType: file.type, data }));
    return NextResponse.json(saved);
  } catch (e: any) {
    if (e instanceof FactoryError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: "Không đính kèm được file hồ sơ cổng." }, { status: 500 });
  }
};

import { NextResponse } from "next/server";
import { getAuthorizedUser, isAdminUser, unauthorizedResponse } from "@/backend/services/authz";
import { clientIp } from "@/backend/services/rateLimit";
import { withTransaction } from "@/factory/core/db";
import { FactoryError, invalid } from "@/factory/core/errors";
import { attachExperimentEntryFile, readExperimentEntryFile } from "@/factory/rd/eln";

export const GET = async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const user = await getAuthorizedUser(req);
  if (!user) return unauthorizedResponse();
  const { id } = await params;
  const url = new URL(req.url);
  const entryId = url.searchParams.get("entry_id") ?? "";
  const actor = { userId: Number(user.id), name: user.full_name || user.username, isPortalAdmin: isAdminUser(user), isRootAdmin: user.role === "admin", ip: clientIp(req) };
  try {
    const file = await withTransaction((tx) => readExperimentEntryFile(tx, actor, id, entryId));
    return new NextResponse(new Uint8Array(file.data), {
      headers: {
        "Content-Type": file.mimeType,
        "Content-Disposition": `attachment; filename="${encodeURIComponent(file.fileName)}"`,
      },
    });
  } catch (e: any) {
    if (e instanceof FactoryError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: "Không tải được file dữ liệu ELN." }, { status: 500 });
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
    const title = form.get("title")?.toString() ?? undefined;
    if (!(file instanceof File)) throw invalid("Chọn file ảnh hoặc dữ liệu thô để đính kèm vào ELN.");
    const data = Buffer.from(await file.arrayBuffer());
    const entry = await withTransaction((tx) =>
      attachExperimentEntryFile(tx, actor, id, { fileName: file.name, mimeType: file.type, data, title })
    );
    return NextResponse.json(entry);
  } catch (e: any) {
    if (e instanceof FactoryError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: "Không đính kèm được file dữ liệu ELN." }, { status: 500 });
  }
};

import { NextResponse } from "next/server";
import { getAuthorizedUser, isAdminUser, unauthorizedResponse } from "@/backend/services/authz";
import { clientIp } from "@/backend/services/rateLimit";
import { withTransaction } from "@/factory/core/db";
import { FactoryError, invalid } from "@/factory/core/errors";
import { attachTechTransferFile, deleteTechTransferFile, readTechTransferFile } from "@/factory/rd/transfer";

export const GET = async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const user = await getAuthorizedUser(req);
  if (!user) return unauthorizedResponse();
  const { id } = await params;
  const url = new URL(req.url);
  const fileId = url.searchParams.get("file_id") ?? "";
  if (!fileId) return NextResponse.json({ error: "Thiếu file_id." }, { status: 400 });
  const inline = url.searchParams.get("inline") === "1";
  const actor = {
    userId: Number(user.id),
    name: user.full_name || user.username,
    isPortalAdmin: isAdminUser(user),
    isRootAdmin: user.role === "admin",
    ip: clientIp(req),
  };
  try {
    const file = await withTransaction((tx) => readTechTransferFile(tx, actor, id, fileId));
    const disp = inline ? "inline" : "attachment";
    return new NextResponse(new Uint8Array(file.data), {
      headers: {
        "Content-Type": file.mimeType,
        "Content-Disposition": `${disp}; filename="${encodeURIComponent(file.fileName)}"`,
      },
    });
  } catch (e: any) {
    if (e instanceof FactoryError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: "Không tải được tệp hồ sơ chuyển giao." }, { status: 500 });
  }
};

export const POST = async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const user = await getAuthorizedUser(req);
  if (!user) return unauthorizedResponse();
  const { id } = await params;
  const actor = {
    userId: Number(user.id),
    name: user.full_name || user.username,
    isPortalAdmin: isAdminUser(user),
    isRootAdmin: user.role === "admin",
    ip: clientIp(req),
  };
  try {
    const form = await req.formData();
    const rawFiles = [
      ...form.getAll("files"),
      ...form.getAll("file"),
    ].filter((f): f is File => f instanceof File && f.size > 0);
    if (rawFiles.length === 0) throw invalid("Chọn ít nhất 1 tệp hồ sơ để đính kèm.");

    const itemId = form.get("item_id")?.toString()?.trim() || null;
    const docLabel = form.get("doc_label")?.toString()?.trim() || null;

    const prepared = await Promise.all(
      rawFiles.map(async (file) => ({
        fileName: file.name,
        mimeType: file.type || "application/octet-stream",
        data: Buffer.from(await file.arrayBuffer()),
      }))
    );

    const saved = await withTransaction(async (tx) => {
      const out = [];
      for (const f of prepared) {
        out.push(
          await attachTechTransferFile(tx, actor, id, {
            itemId,
            docLabel,
            fileName: f.fileName,
            mimeType: f.mimeType,
            data: f.data,
          })
        );
      }
      return out;
    });

    return NextResponse.json(saved.length === 1 ? saved[0] : { files: saved });
  } catch (e: any) {
    if (e instanceof FactoryError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: "Không đính kèm được tệp hồ sơ chuyển giao." }, { status: 500 });
  }
};

export const DELETE = async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const user = await getAuthorizedUser(req);
  if (!user) return unauthorizedResponse();
  const { id } = await params;
  const url = new URL(req.url);
  const fileId = url.searchParams.get("file_id") ?? "";
  if (!fileId) return NextResponse.json({ error: "Thiếu file_id cần gỡ." }, { status: 400 });
  const actor = {
    userId: Number(user.id),
    name: user.full_name || user.username,
    isPortalAdmin: isAdminUser(user),
    isRootAdmin: user.role === "admin",
    ip: clientIp(req),
  };
  try {
    const res = await withTransaction((tx) => deleteTechTransferFile(tx, actor, id, fileId));
    return NextResponse.json(res);
  } catch (e: any) {
    if (e instanceof FactoryError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: "Không gỡ được tệp hồ sơ chuyển giao." }, { status: 500 });
  }
};

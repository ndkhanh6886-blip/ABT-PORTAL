import { factoryRoute } from "@/factory/http";
import { invalid } from "@/factory/core/errors";
import { attachToServiceTicket, listServiceTicketFiles } from "@/factory/device/serviceTickets";

export const GET = factoryRoute((tx, { actor, params }) => listServiceTicketFiles(tx, actor, params.id));

export const POST = async (req: Request, segment: { params: Promise<any> }) => {
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  const handler = factoryRoute(async (tx, { actor, params }) => {
    if (!file || typeof file === "string") throw invalid("Chọn file (PDF, Word, Excel hoặc ảnh).");
    return attachToServiceTicket(tx, actor, params.id, {
      fileName: file.name,
      mimeType: file.type,
      data: Buffer.from(await file.arrayBuffer()),
    });
  });
  return handler(req, segment);
};

import { factoryRoute } from "@/factory/http";
import { invalid } from "@/factory/core/errors";
import { attachToEvent, listEventFiles } from "@/factory/asset/events";

export const GET = factoryRoute((tx, { actor, params }) => listEventFiles(tx, actor, params.id));

/** multipart/form-data with `file`: hand-over record, invoice, service or calibration report. */
export const POST = async (req: Request, segment: { params: Promise<any> }) => {
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  const handler = factoryRoute(async (tx, { actor, params }) => {
    if (!file || typeof file === "string") throw invalid("Chọn file (PDF, Word, Excel hoặc ảnh).");
    return attachToEvent(tx, actor, params.id, { fileName: file.name, mimeType: file.type, data: Buffer.from(await file.arrayBuffer()) });
  });
  return handler(req, segment);
};

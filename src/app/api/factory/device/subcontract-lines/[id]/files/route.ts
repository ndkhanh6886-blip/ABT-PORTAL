import { factoryRoute } from "@/factory/http";
import { invalid } from "@/factory/core/errors";
import { attachLineDrawing, listLineDrawings } from "@/factory/device/subcontract";

export const GET = factoryRoute((tx, { actor, params }) => listLineDrawings(tx, actor, params.id));

/** multipart/form-data with `file`: the drawing with the measured IQC values (PDF or image). */
export const POST = async (req: Request, segment: { params: Promise<any> }) => {
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  const handler = factoryRoute(async (tx, { actor, params }) => {
    if (!file || typeof file === "string") throw invalid("Chọn file bản vẽ (PDF hoặc ảnh).");
    return attachLineDrawing(tx, actor, params.id, { fileName: file.name, mimeType: file.type, data: Buffer.from(await file.arrayBuffer()) });
  });
  return handler(req, segment);
};

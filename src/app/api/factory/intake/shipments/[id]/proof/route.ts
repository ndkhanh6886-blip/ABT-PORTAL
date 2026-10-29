import { factoryRoute } from "@/factory/http";
import { invalid } from "@/factory/core/errors";
import { deliverDropShipWithProof } from "@/factory/intake/shipments";

/** multipart/form-data with `file`: the hand-over record signed by the end customer. */
export const POST = async (req: Request, segment: { params: Promise<any> }) => {
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  const handler = factoryRoute(async (tx, { actor, params }) => {
    if (!file || typeof file === "string") throw invalid("Chọn file biên bản giao nhận (PDF hoặc ảnh).");
    await deliverDropShipWithProof(tx, actor, params.id, { fileName: file.name, mimeType: file.type, data: Buffer.from(await file.arrayBuffer()) });
    return { ok: true };
  });
  return handler(req, segment);
};

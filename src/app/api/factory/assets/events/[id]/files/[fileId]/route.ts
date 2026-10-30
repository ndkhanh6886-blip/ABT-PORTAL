import { factoryRoute } from "@/factory/http";
import { readEventFile } from "@/factory/asset/events";

/** Downloads one attached file (checksum verified on read). */
export const GET = async (req: Request, segment: { params: Promise<any> }) => {
  let out: { fileName: string; mimeType: string; data: Buffer } | null = null;
  const res = await factoryRoute(async (tx, { actor, params }) => {
    out = await readEventFile(tx, actor, params.id, params.fileId);
    return { ok: true };
  })(req, segment);
  if (!out || res.status !== 200) return res;
  const f = out as { fileName: string; mimeType: string; data: Buffer };
  return new Response(new Uint8Array(f.data), {
    headers: { "Content-Type": f.mimeType, "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(f.fileName)}`, "X-Content-Type-Options": "nosniff" },
  });
};

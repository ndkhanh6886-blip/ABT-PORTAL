import { factoryRoute } from "@/factory/http";
import {
  addBomLine,
  addBomLineSubstitute,
  addKitPackaging,
  bulkAddBomLines,
  deleteBomLine,
  deleteKitPackaging,
  fastActivateBom,
  getBomDetail,
  syncPackagingFromBomLines,
  updateBomHeader,
  updateBomLabelIfuSpec,
  updateBomLine,
  updateKitPackaging,
} from "@/factory/kit/bomRouting";

export const GET = factoryRoute(async (tx, { actor, params, url }) => {
  const q = url.searchParams.get("q") || undefined;
  const box_no = url.searchParams.get("box_no") ? Number(url.searchParams.get("box_no")) : undefined;
  const limit = url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : undefined;
  const offset = url.searchParams.get("offset") ? Number(url.searchParams.get("offset")) : undefined;
  return getBomDetail(tx, actor, params.id, { q, box_no, limit, offset });
});

export const POST = factoryRoute(async (tx, { actor, params, body }) => {
  const b = body as Record<string, unknown>;
  if (b.kind === "update_header") {
    const bom = await updateBomHeader(tx, actor, params.id, b);
    return { bom };
  }
  if (b.kind === "label_ifu") {
    const bom = await updateBomLabelIfuSpec(tx, actor, params.id, b);
    return { bom };
  }
  if (b.kind === "fast_activate") {
    const bom = await fastActivateBom(tx, actor, params.id);
    return { bom };
  }
  if (b.kind === "packaging") {
    const packaging = await addKitPackaging(tx, actor, { ...b, bom_id: params.id });
    return { packaging };
  }
  if (b.kind === "update_packaging") {
    const packaging = await updateKitPackaging(tx, actor, params.id, b);
    return { packaging };
  }
  if (b.kind === "delete_packaging") {
    return deleteKitPackaging(tx, actor, params.id, String(b.pack_id || ""));
  }
  if (b.kind === "sync_packaging") {
    return syncPackagingFromBomLines(tx, actor, params.id);
  }
  if (b.kind === "substitute") {
    const substitute = await addBomLineSubstitute(tx, actor, b);
    return { substitute };
  }
  if (b.kind === "bulk_lines") {
    return bulkAddBomLines(tx, actor, { ...b, bom_id: params.id });
  }
  if (b.kind === "update_line") {
    const line = await updateBomLine(tx, actor, params.id, b);
    return { line };
  }
  if (b.kind === "delete_line") {
    return deleteBomLine(tx, actor, params.id, String(b.line_id || ""));
  }
  const line = await addBomLine(tx, actor, { ...b, bom_id: params.id });
  return { line };
});

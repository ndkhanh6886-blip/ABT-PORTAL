import { factoryRoute } from "@/factory/http";
import {
  addBomLine,
  addBomLineSubstitute,
  addKitPackaging,
  bulkAddBomLines,
  fastActivateBom,
  getBomDetail,
  updateBomLabelIfuSpec,
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
  if (b.kind === "substitute") {
    const substitute = await addBomLineSubstitute(tx, actor, b);
    return { substitute };
  }
  if (b.kind === "bulk_lines") {
    return bulkAddBomLines(tx, actor, { ...b, bom_id: params.id });
  }
  const line = await addBomLine(tx, actor, { ...b, bom_id: params.id });
  return { line };
});

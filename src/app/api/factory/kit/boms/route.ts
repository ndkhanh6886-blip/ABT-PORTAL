import { factoryRoute, idempotent } from "@/factory/http";
import { createBom, listBoms } from "@/factory/kit/bomRouting";

export const GET = factoryRoute(async (tx, { actor, url }) => {
  const q = url.searchParams.get("q") || undefined;
  const status = url.searchParams.get("status") || undefined;
  const product_item_id = url.searchParams.get("product_item_id") || undefined;
  const bom_type = url.searchParams.get("bom_type") || undefined;
  const bom_category = url.searchParams.get("bom_category") || undefined;
  const limit = url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : undefined;
  const offset = url.searchParams.get("offset") ? Number(url.searchParams.get("offset")) : undefined;
  return { boms: await listBoms(tx, actor, { q, status, product_item_id, bom_type, bom_category, limit, offset }) };
});

export const POST = factoryRoute(async (tx, ctx) => {
  const bom = await idempotent(tx, ctx, "kit:boms", () => createBom(tx, ctx.actor, ctx.body));
  return { bom };
});

import { factoryRoute, idempotent } from "@/factory/http";
import { createAsset, listAssets } from "@/factory/asset/service";

export const GET = factoryRoute((tx, { actor, url }) =>
  listAssets(tx, actor, url.searchParams.get("type") || undefined, url.searchParams.get("dept") || undefined)
);
export const POST = factoryRoute((tx, ctx) => idempotent(tx, ctx, "assets.create", () => createAsset(tx, ctx.actor, ctx.body)));

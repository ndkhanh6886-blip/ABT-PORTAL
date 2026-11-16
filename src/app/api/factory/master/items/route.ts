import { factoryRoute, idempotent, queryObject } from "@/factory/http";
import { createItem, listItems } from "@/factory/master/service";
import { syncPortalCatalogToFactoryItems } from "@/factory/portalCatalogSync";

export const GET = factoryRoute(async (tx, { actor, url }) => {
  await syncPortalCatalogToFactoryItems(tx);
  return listItems(tx, actor, queryObject(url));
});
export const POST = factoryRoute((tx, ctx) => idempotent(tx, ctx, "master.items.create", () => createItem(tx, ctx.actor, ctx.body)));

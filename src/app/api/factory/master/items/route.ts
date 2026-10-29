import { factoryRoute, idempotent, queryObject } from "@/factory/http";
import { createItem, listItems } from "@/factory/master/service";

export const GET = factoryRoute((tx, { actor, url }) => listItems(tx, actor, queryObject(url)));
export const POST = factoryRoute((tx, ctx) => idempotent(tx, ctx, "master.items.create", () => createItem(tx, ctx.actor, ctx.body)));

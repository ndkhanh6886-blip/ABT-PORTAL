import { factoryRoute, idempotent } from "@/factory/http";
import { createPrepOrder, listPrepOrders } from "@/factory/prep/orders";

export const GET = factoryRoute((tx, { actor, url }) => listPrepOrders(tx, actor, url.searchParams.get("dept") ?? undefined));
export const POST = factoryRoute((tx, ctx) => idempotent(tx, ctx, "prep.orders.create", () => createPrepOrder(tx, ctx.actor, ctx.body)));

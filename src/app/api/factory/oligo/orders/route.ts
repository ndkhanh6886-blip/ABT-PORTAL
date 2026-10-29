import { factoryRoute, idempotent } from "@/factory/http";
import { createOligoOrder, listOligoOrders } from "@/factory/oligo/orders";

export const GET = factoryRoute((tx, { actor, url }) => listOligoOrders(tx, actor, url.searchParams.get("status") || undefined));
export const POST = factoryRoute((tx, ctx) => idempotent(tx, ctx, "oligo.orders.create", () => createOligoOrder(tx, ctx.actor, ctx.body)));

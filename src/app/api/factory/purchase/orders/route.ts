import { factoryRoute, idempotent } from "@/factory/http";
import { createOrder, listOrders } from "@/factory/purchase/orders";

export const GET = factoryRoute((tx, { actor, url }) => listOrders(tx, actor, url.searchParams.get("status") || undefined));
export const POST = factoryRoute((tx, ctx) => idempotent(tx, ctx, "purchase.orders.create", () => createOrder(tx, ctx.actor, ctx.body)));

import { factoryRoute, idempotent } from "@/factory/http";
import { createProductionOrder, listDailyProductionSteps, listProductionOrders } from "@/factory/kit/ordersEbr";

export const GET = factoryRoute(async (tx, { actor }) => {
  const [orders, daily_steps] = await Promise.all([
    listProductionOrders(tx, actor),
    listDailyProductionSteps(tx, actor),
  ]);
  return { orders, daily_steps };
});

export const POST = factoryRoute(async (tx, ctx) => {
  const order = await idempotent(tx, ctx, "kit:orders", () => createProductionOrder(tx, ctx.actor, ctx.body));
  return { order };
});

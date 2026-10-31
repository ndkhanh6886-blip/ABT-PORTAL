import { factoryRoute, idempotent } from "@/factory/http";
import { createReworkOrder, listReworkOrders } from "@/factory/kit/qualityTrace";

export const GET = factoryRoute(async (tx, { actor }) => {
  return { reworks: await listReworkOrders(tx, actor) };
});

export const POST = factoryRoute(async (tx, ctx) => {
  const rework = await idempotent(tx, ctx, "kit:reworks", () => createReworkOrder(tx, ctx.actor, ctx.body));
  return { rework };
});

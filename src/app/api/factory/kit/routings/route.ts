import { factoryRoute, idempotent } from "@/factory/http";
import { createRouting, listRoutings } from "@/factory/kit/bomRouting";

export const GET = factoryRoute(async (tx, { actor }) => {
  return { routings: await listRoutings(tx, actor) };
});

export const POST = factoryRoute(async (tx, ctx) => {
  const routing = await idempotent(tx, ctx, "kit:routings", () => createRouting(tx, ctx.actor, ctx.body));
  return { routing };
});

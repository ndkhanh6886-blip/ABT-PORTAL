import { factoryRoute, idempotent } from "@/factory/http";
import { executePrepOrder } from "@/factory/prep/orders";

export const POST = factoryRoute((tx, ctx) => idempotent(tx, ctx, "prep.orders.execute", () => executePrepOrder(tx, ctx.actor, ctx.params.id, ctx.body)));

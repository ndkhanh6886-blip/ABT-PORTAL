import { factoryRoute, idempotent } from "@/factory/http";
import { createDelivery, listDeliveryQueue } from "@/factory/oligo/fulfilment";

export const GET = factoryRoute((tx, { actor }) => listDeliveryQueue(tx, actor));
export const POST = factoryRoute((tx, ctx) => idempotent(tx, ctx, "oligo.deliveries.create", () => createDelivery(tx, ctx.actor, ctx.body)));

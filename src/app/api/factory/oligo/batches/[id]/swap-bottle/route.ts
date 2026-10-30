import { factoryRoute, idempotent } from "@/factory/http";
import { swapBottle } from "@/factory/oligo/synthPorts";

export const POST = factoryRoute((tx, ctx) => idempotent(tx, ctx, "oligo.batches.swap-bottle", () => swapBottle(tx, ctx.actor, ctx.params.id, ctx.body)));

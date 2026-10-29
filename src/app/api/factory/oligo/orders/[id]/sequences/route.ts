import { factoryRoute, idempotent } from "@/factory/http";
import { addSequences } from "@/factory/oligo/orders";

/** Body { text, defaults: { scale_code, purification, format } }: all lines are saved or none. */
export const POST = factoryRoute((tx, ctx) => idempotent(tx, ctx, "oligo.sequences.add", () => addSequences(tx, ctx.actor, ctx.params.id, ctx.body)));

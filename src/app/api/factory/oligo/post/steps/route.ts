import { factoryRoute, idempotent } from "@/factory/http";
import { logStep } from "@/factory/oligo/postSop";

/** Confirms the next SOP step for one or several sequences. */
export const POST = factoryRoute((tx, ctx) => idempotent(tx, ctx, "oligo.post.step", () => logStep(tx, ctx.actor, ctx.body)));

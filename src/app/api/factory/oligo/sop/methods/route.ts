import { factoryRoute, idempotent } from "@/factory/http";
import { saveMethod } from "@/factory/oligo/postSop";

export const POST = factoryRoute((tx, ctx) => idempotent(tx, ctx, "oligo.sop.method.create", () => saveMethod(tx, ctx.actor, null, ctx.body)));

import { factoryRoute, idempotent } from "@/factory/http";
import { saveFragments } from "@/factory/oligo/analysis";

export const POST = factoryRoute((tx, ctx) => idempotent(tx, ctx, "oligo.sequence.fragments", () => saveFragments(tx, ctx.actor, ctx.params.id, ctx.body)));

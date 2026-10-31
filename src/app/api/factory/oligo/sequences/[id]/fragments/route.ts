import { factoryRoute, idempotent } from "@/factory/http";
import { saveFragments } from "@/factory/oligo/analysis";
import { unsplitSequence } from "@/factory/oligo/sequences";

export const POST = factoryRoute((tx, ctx) => idempotent(tx, ctx, "oligo.sequence.fragments", () => saveFragments(tx, ctx.actor, ctx.params.id, ctx.body)));

export const DELETE = factoryRoute((tx, ctx) => idempotent(tx, ctx, "oligo.sequence.unsplit", () => unsplitSequence(tx, ctx.actor, ctx.params.id)));

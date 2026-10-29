import { factoryRoute, idempotent } from "@/factory/http";
import { planBatch } from "@/factory/oligo/batches";
import { listBatches } from "@/factory/oligo/batchQueries";

export const GET = factoryRoute((tx, { actor, url }) => listBatches(tx, actor, url.searchParams.get("status") || undefined));
export const POST = factoryRoute((tx, ctx) => idempotent(tx, ctx, "oligo.batches.plan", () => planBatch(tx, ctx.actor, ctx.body)));

import { factoryRoute, idempotent } from "@/factory/http";
import { listPools, poolCandidates, poolSequences } from "@/factory/oligo/sequences";

export const GET = factoryRoute(async (tx, { actor }) => ({ pools: await listPools(tx, actor), candidates: await poolCandidates(tx, actor) }));
export const POST = factoryRoute((tx, ctx) => idempotent(tx, ctx, "oligo.pools.create", () => poolSequences(tx, ctx.actor, ctx.body)));

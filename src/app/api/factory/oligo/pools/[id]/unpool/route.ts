import { factoryRoute } from "@/factory/http";
import { unpoolSequences } from "@/factory/oligo/sequences";

/** `id` is the pool master sequence. */
export const POST = factoryRoute(async (tx, { actor, params }) => {
  await unpoolSequences(tx, actor, params.id);
  return { ok: true };
});

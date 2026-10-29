import { factoryRoute } from "@/factory/http";
import { cancelSequence } from "@/factory/oligo/sequences";

export const POST = factoryRoute(async (tx, { actor, params, body }) => {
  await cancelSequence(tx, actor, params.id, body?.reason);
  return { ok: true };
});

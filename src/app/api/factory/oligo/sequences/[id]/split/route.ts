import { factoryRoute } from "@/factory/http";
import { splitSequence } from "@/factory/oligo/sequences";

export const POST = factoryRoute(async (tx, { actor, params, body }) => {
  await splitSequence(tx, actor, params.id, body);
  return { ok: true };
});

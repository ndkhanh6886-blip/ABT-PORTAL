import { factoryRoute } from "@/factory/http";
import { editSequence } from "@/factory/oligo/sequences";

export const PATCH = factoryRoute(async (tx, { actor, params, body }) => {
  await editSequence(tx, actor, params.id, body);
  return { ok: true };
});

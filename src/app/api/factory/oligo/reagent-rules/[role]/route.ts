import { factoryRoute } from "@/factory/http";
import { updateReagentRule } from "@/factory/oligo/batchQueries";

export const PATCH = factoryRoute(async (tx, { actor, params, body }) => {
  await updateReagentRule(tx, actor, decodeURIComponent(params.role), body);
  return { ok: true };
});

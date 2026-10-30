import { factoryRoute } from "@/factory/http";
import { createReagentRule, listReagentRules } from "@/factory/oligo/batchQueries";

export const GET = factoryRoute((tx, { actor }) => listReagentRules(tx, actor));
export const POST = factoryRoute(async (tx, { actor, body }) => {
  await createReagentRule(tx, actor, body);
  return { ok: true };
});

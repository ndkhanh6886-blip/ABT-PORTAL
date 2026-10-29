import { allowedActionsFor, factoryRoute } from "@/factory/http";
import { getRequest, prMachine, updateRequestDraft } from "@/factory/purchase/requests";

export const GET = factoryRoute(async (tx, { actor, params }) => {
  const pr = await getRequest(tx, actor, params.id);
  return { ...pr, actions: await allowedActionsFor(tx, prMachine, actor, pr) };
});
export const PATCH = factoryRoute((tx, { actor, params, body }) => updateRequestDraft(tx, actor, params.id, body));

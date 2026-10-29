import { allowedActionsFor, factoryRoute } from "@/factory/http";
import { getOrder, poMachine } from "@/factory/purchase/orders";

export const GET = factoryRoute(async (tx, { actor, params }) => {
  const po = await getOrder(tx, actor, params.id);
  return { ...po, actions: await allowedActionsFor(tx, poMachine, actor, po) };
});

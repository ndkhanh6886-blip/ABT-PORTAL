import { allowedActionsFor, factoryRoute } from "@/factory/http";
import { getOrder, orderMachine } from "@/factory/intake/orders";

export const GET = factoryRoute(async (tx, { actor, params }) => {
  const order = await getOrder(tx, actor, params.id);
  return { ...order, actions: await allowedActionsFor(tx, orderMachine, actor, order) };
});

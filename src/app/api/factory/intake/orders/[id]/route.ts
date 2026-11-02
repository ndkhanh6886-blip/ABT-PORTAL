import { allowedActionsFor, factoryRoute } from "@/factory/http";
import { getOrder, orderMachine, updateInternalOrderNotes } from "@/factory/intake/orders";

export const GET = factoryRoute(async (tx, { actor, params }) => {
  const order = await getOrder(tx, actor, params.id);
  return { ...order, actions: await allowedActionsFor(tx, orderMachine, actor, order) };
});

export const PATCH = factoryRoute((tx, { actor, params, body }) =>
  updateInternalOrderNotes(tx, actor, params.id, body)
);

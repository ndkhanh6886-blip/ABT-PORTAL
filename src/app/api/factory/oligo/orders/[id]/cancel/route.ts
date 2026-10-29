import { factoryRoute } from "@/factory/http";
import { cancelOligoOrder } from "@/factory/oligo/orders";

export const POST = factoryRoute(async (tx, { actor, params, body }) => {
  await cancelOligoOrder(tx, actor, params.id, body?.reason);
  return { ok: true };
});

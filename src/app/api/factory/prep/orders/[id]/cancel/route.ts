import { factoryRoute } from "@/factory/http";
import { cancelPrepOrder } from "@/factory/prep/orders";

export const POST = factoryRoute(async (tx, { actor, params, body }) => {
  await cancelPrepOrder(tx, actor, params.id, (body as { reason?: unknown } | null)?.reason);
  return { ok: true };
});

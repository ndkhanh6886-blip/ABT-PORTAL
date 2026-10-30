import { factoryRoute } from "@/factory/http";
import { cancelPreparation } from "@/factory/prep/service";

export const POST = factoryRoute(async (tx, { actor, params, body }) => {
  await cancelPreparation(tx, actor, params.id, (body as { reason?: unknown } | null)?.reason);
  return { ok: true };
});

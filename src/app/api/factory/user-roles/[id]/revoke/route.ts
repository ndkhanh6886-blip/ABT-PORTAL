import { factoryRoute } from "@/factory/http";
import { revokeRole } from "@/factory/core/roles";

export const POST = factoryRoute(async (tx, { actor, params, body }) => {
  await revokeRole(tx, actor, params.id, body?.reason);
  return { ok: true };
});

import { factoryRoute } from "@/factory/http";
import { setTaskStatus } from "@/factory/plan/service";

export const POST = factoryRoute(async (tx, { actor, params, body }) => {
  await setTaskStatus(tx, actor, params.id, body);
  return { ok: true };
});

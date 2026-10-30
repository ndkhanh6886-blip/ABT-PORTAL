import { factoryRoute } from "@/factory/http";
import { updateTask } from "@/factory/plan/service";

export const PUT = factoryRoute(async (tx, { actor, params, body }) => {
  await updateTask(tx, actor, params.id, body);
  return { ok: true };
});

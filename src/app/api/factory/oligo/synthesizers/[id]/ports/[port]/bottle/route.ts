import { factoryRoute } from "@/factory/http";
import { setBottle } from "@/factory/oligo/synthPorts";

export const PUT = factoryRoute(async (tx, { actor, params, body }) => {
  await setBottle(tx, actor, params.id, Number(params.port), body);
  return { ok: true };
});

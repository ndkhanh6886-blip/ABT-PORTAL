import { factoryRoute } from "@/factory/http";
import { setSlotBottle } from "@/factory/asset/slots";

export const PUT = factoryRoute(async (tx, { actor, params, body }) => {
  await setSlotBottle(tx, actor, params.id, Number(params.slot), body);
  return { ok: true };
});

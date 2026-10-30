import { factoryRoute } from "@/factory/http";
import { configureSlots, listSlots } from "@/factory/asset/slots";

export const GET = factoryRoute((tx, { actor, params }) => listSlots(tx, actor, params.id));
export const PUT = factoryRoute(async (tx, { actor, params, body }) => {
  await configureSlots(tx, actor, params.id, body);
  return listSlots(tx, actor, params.id);
});

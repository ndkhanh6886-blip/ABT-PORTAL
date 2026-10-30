import { factoryRoute } from "@/factory/http";
import { setPlasmid } from "@/factory/oligo/analysis";

export const PUT = factoryRoute(async (tx, { actor, params, body }) => {
  await setPlasmid(tx, actor, params.id, body);
  return { ok: true };
});

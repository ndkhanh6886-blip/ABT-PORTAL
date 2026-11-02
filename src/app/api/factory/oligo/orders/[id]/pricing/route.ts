import { factoryRoute } from "@/factory/http";
import { recalculateOrderPricing } from "@/factory/oligo/pricing";

export const POST = factoryRoute((tx, { actor, params, body }) =>
  recalculateOrderPricing(tx, actor, params.id, body)
);

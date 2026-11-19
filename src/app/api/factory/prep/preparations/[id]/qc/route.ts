import { factoryRoute } from "@/factory/http";
import { confirmPreparationQc } from "@/factory/prep/service";

export const POST = factoryRoute((tx, { actor, params, body }) =>
  confirmPreparationQc(tx, actor, params.id, body)
);

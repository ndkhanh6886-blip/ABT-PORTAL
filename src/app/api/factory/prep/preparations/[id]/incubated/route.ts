import { factoryRoute } from "@/factory/http";
import { finishIncubation } from "@/factory/prep/orders";

export const POST = factoryRoute((tx, { actor, params, body }) => finishIncubation(tx, actor, params.id, body));

import { factoryRoute } from "@/factory/http";
import { getPreparation } from "@/factory/prep/orders";

export const GET = factoryRoute((tx, { actor, params }) => getPreparation(tx, actor, params.id));

import { factoryRoute } from "@/factory/http";
import { getOligoOrder } from "@/factory/oligo/orders";

export const GET = factoryRoute((tx, { actor, params }) => getOligoOrder(tx, actor, params.id));

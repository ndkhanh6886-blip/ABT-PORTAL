import { factoryRoute } from "@/factory/http";
import { getOligoOrder, updateOligoOrderMeta } from "@/factory/oligo/orders";

export const GET = factoryRoute((tx, { actor, params }) => getOligoOrder(tx, actor, params.id));

export const PATCH = factoryRoute((tx, { actor, params, body }) =>
  updateOligoOrderMeta(tx, actor, params.id, body)
);

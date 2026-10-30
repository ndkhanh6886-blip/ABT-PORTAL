import { factoryRoute } from "@/factory/http";
import { aliquotPool, poolAliquotView } from "@/factory/oligo/poolAliquot";

export const GET = factoryRoute((tx, { actor, params }) => poolAliquotView(tx, actor, params.id));
export const PUT = factoryRoute((tx, { actor, params, body }) => aliquotPool(tx, actor, params.id, body));

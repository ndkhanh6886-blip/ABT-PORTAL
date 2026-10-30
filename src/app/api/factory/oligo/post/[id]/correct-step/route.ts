import { factoryRoute } from "@/factory/http";
import { correctStep } from "@/factory/oligo/poolAliquot";

export const POST = factoryRoute((tx, { actor, params, body }) => correctStep(tx, actor, params.id, body));

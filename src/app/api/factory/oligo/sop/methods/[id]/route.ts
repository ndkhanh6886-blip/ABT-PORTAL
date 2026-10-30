import { factoryRoute } from "@/factory/http";
import { saveMethod } from "@/factory/oligo/postSop";

export const PUT = factoryRoute((tx, { actor, params, body }) => saveMethod(tx, actor, params.id, body));

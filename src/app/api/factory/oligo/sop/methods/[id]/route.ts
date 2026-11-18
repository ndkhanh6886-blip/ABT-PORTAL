import { factoryRoute } from "@/factory/http";
import { deleteMethod, saveMethod } from "@/factory/oligo/postSop";

export const PUT = factoryRoute((tx, { actor, params, body }) => saveMethod(tx, actor, params.id, body));
export const DELETE = factoryRoute((tx, { actor, params, body }) => deleteMethod(tx, actor, params.id, body));

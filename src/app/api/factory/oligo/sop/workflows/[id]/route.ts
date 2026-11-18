import { factoryRoute } from "@/factory/http";
import { deleteWorkflow, saveWorkflow } from "@/factory/oligo/postSop";

export const PUT = factoryRoute((tx, { actor, params, body }) => saveWorkflow(tx, actor, params.id, body));
export const DELETE = factoryRoute((tx, { actor, params, body }) => deleteWorkflow(tx, actor, params.id, body));

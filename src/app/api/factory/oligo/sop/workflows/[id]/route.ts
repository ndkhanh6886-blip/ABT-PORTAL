import { factoryRoute } from "@/factory/http";
import { saveWorkflow } from "@/factory/oligo/postSop";

export const PUT = factoryRoute((tx, { actor, params, body }) => saveWorkflow(tx, actor, params.id, body));

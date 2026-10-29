import { factoryRoute } from "@/factory/http";
import { getPostProcess, savePostProcess } from "@/factory/oligo/postProcess";

export const GET = factoryRoute((tx, { actor, params }) => getPostProcess(tx, actor, params.id));
export const PATCH = factoryRoute((tx, { actor, params, body }) => savePostProcess(tx, actor, params.id, body));

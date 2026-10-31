import { factoryRoute } from "@/factory/http";
import { evaluateIdea, getIdeaDetail, updateIdeaDraft } from "@/factory/rd/ideas";

export const GET = factoryRoute((tx, { actor, params }) => getIdeaDetail(tx, actor, params.id));

export const PUT = factoryRoute((tx, { actor, params, body }) => updateIdeaDraft(tx, actor, params.id, body));

export const POST = factoryRoute((tx, { actor, params, body }) => evaluateIdea(tx, actor, params.id, body));

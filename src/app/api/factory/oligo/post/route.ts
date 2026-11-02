import { factoryRoute } from "@/factory/http";
import { batchPostProcessAction, listPostQueue } from "@/factory/oligo/postProcess";

export const GET = factoryRoute((tx, { actor, url }) => listPostQueue(tx, actor, url.searchParams.get("status") || undefined));
export const POST = factoryRoute((tx, { actor, body }) => batchPostProcessAction(tx, actor, body));


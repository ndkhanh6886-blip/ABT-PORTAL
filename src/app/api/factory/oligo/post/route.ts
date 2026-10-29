import { factoryRoute } from "@/factory/http";
import { listPostQueue } from "@/factory/oligo/postProcess";

export const GET = factoryRoute((tx, { actor, url }) => listPostQueue(tx, actor, url.searchParams.get("status") || undefined));

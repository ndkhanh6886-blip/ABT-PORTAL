import { factoryRoute } from "@/factory/http";
import { listByType } from "@/factory/oligo/analysis";

export const GET = factoryRoute((tx, { actor, url }) => listByType(tx, actor, Object.fromEntries(url.searchParams)));

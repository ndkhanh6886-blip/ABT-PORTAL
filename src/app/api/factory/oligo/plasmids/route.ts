import { factoryRoute } from "@/factory/http";
import { listPlasmids, savePlasmid } from "@/factory/oligo/analysis";

export const GET = factoryRoute((tx, { actor }) => listPlasmids(tx, actor));
export const POST = factoryRoute((tx, { actor, body }) => savePlasmid(tx, actor, null, body));

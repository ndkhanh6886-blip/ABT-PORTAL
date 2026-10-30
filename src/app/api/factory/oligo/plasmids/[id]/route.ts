import { factoryRoute } from "@/factory/http";
import { savePlasmid } from "@/factory/oligo/analysis";

export const PUT = factoryRoute((tx, { actor, params, body }) => savePlasmid(tx, actor, params.id, body));

import { factoryRoute } from "@/factory/http";
import { listReagentRules } from "@/factory/oligo/batchQueries";

export const GET = factoryRoute((tx, { actor }) => listReagentRules(tx, actor));

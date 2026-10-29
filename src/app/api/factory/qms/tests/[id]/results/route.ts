import { factoryRoute } from "@/factory/http";
import { saveResults } from "@/factory/qms/qcTests";

export const PUT = factoryRoute((tx, { actor, params, body }) => saveResults(tx, actor, params.id, body));

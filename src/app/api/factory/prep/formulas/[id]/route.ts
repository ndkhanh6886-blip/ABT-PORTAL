import { factoryRoute } from "@/factory/http";
import { saveFormula } from "@/factory/prep/service";

export const PUT = factoryRoute((tx, { actor, params, body }) => saveFormula(tx, actor, params.id, body));

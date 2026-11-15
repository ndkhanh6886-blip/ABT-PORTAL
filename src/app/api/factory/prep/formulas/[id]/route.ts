import { factoryRoute } from "@/factory/http";
import { deleteFormula, saveFormula } from "@/factory/prep/service";

export const PUT = factoryRoute((tx, { actor, params, body }) => saveFormula(tx, actor, params.id, body));

export const DELETE = factoryRoute((tx, { actor, params, body }) => deleteFormula(tx, actor, params.id, body));

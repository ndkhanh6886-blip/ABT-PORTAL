import { factoryRoute, idempotent } from "@/factory/http";
import { listFormulas, saveFormula } from "@/factory/prep/service";

export const GET = factoryRoute((tx, { actor }) => listFormulas(tx, actor));
export const POST = factoryRoute((tx, ctx) => idempotent(tx, ctx, "prep.formula.create", () => saveFormula(tx, ctx.actor, null, ctx.body)));

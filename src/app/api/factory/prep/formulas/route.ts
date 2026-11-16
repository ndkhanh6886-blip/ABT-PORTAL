import { factoryRoute, idempotent } from "@/factory/http";
import { listFormulas, saveFormula } from "@/factory/prep/service";

export const GET = factoryRoute((tx, { actor, url }) => listFormulas(tx, actor, url.searchParams.get("dept") ?? undefined));
export const POST = factoryRoute((tx, ctx) => idempotent(tx, ctx, "prep.formula.create", () => saveFormula(tx, ctx.actor, null, ctx.body)));

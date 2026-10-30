import { factoryRoute, idempotent } from "@/factory/http";
import { listPreparations, prepare } from "@/factory/prep/service";

export const GET = factoryRoute((tx, { actor }) => listPreparations(tx, actor));
export const POST = factoryRoute((tx, ctx) => idempotent(tx, ctx, "prep.prepare", () => prepare(tx, ctx.actor, ctx.body)));

import { factoryRoute, idempotent } from "@/factory/http";
import { listPreparations, prepare } from "@/factory/prep/service";

export const GET = factoryRoute((tx, { actor, url }) => listPreparations(tx, actor, url.searchParams.get("dept") ?? undefined));
export const POST = factoryRoute((tx, ctx) => idempotent(tx, ctx, "prep.prepare", () => prepare(tx, ctx.actor, ctx.body)));

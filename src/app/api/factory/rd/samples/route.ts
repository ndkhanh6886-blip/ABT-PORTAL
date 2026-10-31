import { factoryRoute, idempotent } from "@/factory/http";
import { createSample, listSamples } from "@/factory/rd/samples";

export const GET = factoryRoute((tx, { actor, url }) => listSamples(tx, actor, url.searchParams.get("project_id") ?? undefined));

export const POST = factoryRoute((tx, ctx) => idempotent(tx, ctx, "rd.sample.create", () => createSample(tx, ctx.actor, ctx.body)));

import { factoryRoute, idempotent } from "@/factory/http";
import { createExperiment, listExperiments } from "@/factory/rd/eln";

export const GET = factoryRoute((tx, { actor, url }) => listExperiments(tx, actor, url.searchParams.get("project_id") ?? undefined));

export const POST = factoryRoute((tx, ctx) => idempotent(tx, ctx, "rd.experiment.create", () => createExperiment(tx, ctx.actor, ctx.body)));

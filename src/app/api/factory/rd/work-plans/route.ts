import { factoryRoute, idempotent } from "@/factory/http";
import { createOrGetWorkPlan, listWorkPlans } from "@/factory/rd/workPlans";

export const GET = factoryRoute((tx, { actor, url }) => listWorkPlans(tx, actor, url.searchParams.get("org_unit_id") ?? undefined));

export const POST = factoryRoute((tx, ctx) => idempotent(tx, ctx, "work.plan.create", () => createOrGetWorkPlan(tx, ctx.actor, ctx.body)));

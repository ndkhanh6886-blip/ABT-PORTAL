import { factoryRoute, idempotent } from "@/factory/http";
import { createTask } from "@/factory/plan/service";

export const POST = factoryRoute((tx, ctx) => idempotent(tx, ctx, "plan.tasks.create", () => createTask(tx, ctx.actor, ctx.body)));

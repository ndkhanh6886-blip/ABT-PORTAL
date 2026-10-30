import { factoryRoute, idempotent } from "@/factory/http";
import { saveWorkflow } from "@/factory/oligo/postSop";

export const POST = factoryRoute((tx, ctx) => idempotent(tx, ctx, "oligo.sop.workflow.create", () => saveWorkflow(tx, ctx.actor, null, ctx.body)));

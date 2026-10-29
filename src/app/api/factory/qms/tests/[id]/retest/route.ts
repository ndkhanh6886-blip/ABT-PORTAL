import { factoryRoute, idempotent } from "@/factory/http";
import { createRetest } from "@/factory/qms/qcTests";

export const POST = factoryRoute((tx, ctx) => idempotent(tx, ctx, "qms.tests.retest", () => createRetest(tx, ctx.actor, ctx.params.id, ctx.body?.reason)));

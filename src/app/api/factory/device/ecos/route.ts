import { factoryRoute, idempotent } from "@/factory/http";
import { createEcoRequest } from "@/factory/device/models";

export const POST = factoryRoute((tx, ctx) =>
  idempotent(tx, ctx, "POST /api/factory/device/ecos", () => createEcoRequest(tx, ctx.actor, ctx.body))
);

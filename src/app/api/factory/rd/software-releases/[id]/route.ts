import { factoryRoute, idempotent } from "@/factory/http";
import { updateSoftwareRelease } from "@/factory/rd/transfer";

export const PUT = factoryRoute((tx, ctx) =>
  idempotent(tx, ctx, "rd.sw_release.update", () => updateSoftwareRelease(tx, ctx.actor, ctx.params.id, ctx.body))
);

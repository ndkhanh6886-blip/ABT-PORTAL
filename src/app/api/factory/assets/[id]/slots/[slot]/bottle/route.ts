import { factoryRoute, idempotent } from "@/factory/http";
import { reportSlotBottleEmpty, setSlotBottle } from "@/factory/asset/slots";

export const PUT = factoryRoute(async (tx, { actor, params, body }) => {
  await setSlotBottle(tx, actor, params.id, Number(params.slot), body);
  return { ok: true };
});

export const POST = factoryRoute((tx, ctx) =>
  idempotent(tx, ctx, "asset.slot.bottle.empty", () =>
    reportSlotBottleEmpty(tx, ctx.actor, ctx.params.id, Number(ctx.params.slot), ctx.body ?? {})
  )
);

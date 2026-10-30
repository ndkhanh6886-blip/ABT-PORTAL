import { factoryRoute, idempotent } from "@/factory/http";
import { logSlotUsage } from "@/factory/asset/slots";

export const POST = factoryRoute((tx, ctx) => idempotent(tx, ctx, "asset.slot.usage", () => logSlotUsage(tx, ctx.actor, ctx.params.id, Number(ctx.params.slot), ctx.body)));

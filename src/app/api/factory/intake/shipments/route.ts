import { factoryRoute, idempotent } from "@/factory/http";
import { postShipment } from "@/factory/intake/shipments";

export const POST = factoryRoute((tx, ctx) => idempotent(tx, ctx, "intake.shipments.create", () => postShipment(tx, ctx.actor, ctx.body)));

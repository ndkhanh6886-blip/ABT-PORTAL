import { factoryRoute, idempotent } from "@/factory/http";
import { putAwayLot } from "@/factory/inv/manual";

/** Moves a released lot from quarantine onto a shelf. */
export const POST = factoryRoute((tx, ctx) => idempotent(tx, ctx, "inv.lots.putaway", () => putAwayLot(tx, ctx.actor, { ...ctx.body, lot_id: ctx.params.id })));

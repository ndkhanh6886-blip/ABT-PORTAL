import { factoryRoute, idempotent } from "@/factory/http";
import { postGoodsReceipt } from "@/factory/purchase/receipts";

export const POST = factoryRoute((tx, ctx) => idempotent(tx, ctx, "purchase.receipts.create", () => postGoodsReceipt(tx, ctx.actor, ctx.body)));

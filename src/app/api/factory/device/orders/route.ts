import { factoryRoute, idempotent } from "@/factory/http";
import { createDeviceOrder, listDeviceOrders } from "@/factory/device/assembly";

export const GET = factoryRoute((tx, { actor }) => listDeviceOrders(tx, actor));

export const POST = factoryRoute((tx, ctx) =>
  idempotent(tx, ctx, "POST /api/factory/device/orders", () => createDeviceOrder(tx, ctx.actor, ctx.body))
);

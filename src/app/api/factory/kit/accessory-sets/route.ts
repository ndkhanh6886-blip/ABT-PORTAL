import { factoryRoute } from "@/factory/http";
import { listAccessorySetConfig, setAccessoryQty } from "@/factory/kit/ordersEbr";
import "@/factory/kit/permissions";

export const GET = factoryRoute(async (tx, { actor }) => listAccessorySetConfig(tx, actor));

export const POST = factoryRoute(async (tx, ctx) => setAccessoryQty(tx, ctx.actor, ctx.body));

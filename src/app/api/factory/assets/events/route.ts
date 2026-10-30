import { factoryRoute, idempotent } from "@/factory/http";
import { listEvents, planEvent } from "@/factory/asset/events";

export const GET = factoryRoute((tx, { actor, url }) => listEvents(tx, actor, Object.fromEntries(url.searchParams)));
export const POST = factoryRoute((tx, ctx) => idempotent(tx, ctx, "asset.events.plan", () => planEvent(tx, ctx.actor, ctx.body)));

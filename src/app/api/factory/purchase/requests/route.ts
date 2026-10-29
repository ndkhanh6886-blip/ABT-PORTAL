import { factoryRoute, idempotent } from "@/factory/http";
import { createRequest, listRequests } from "@/factory/purchase/requests";

export const GET = factoryRoute((tx, { actor, url }) => listRequests(tx, actor, url.searchParams.get("status") || undefined));
export const POST = factoryRoute((tx, ctx) => idempotent(tx, ctx, "purchase.requests.create", () => createRequest(tx, ctx.actor, ctx.body)));

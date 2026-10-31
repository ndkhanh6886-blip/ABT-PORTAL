import { factoryRoute, idempotent } from "@/factory/http";
import { createIdea, listIdeas } from "@/factory/rd/ideas";

export const GET = factoryRoute((tx, { actor, url }) => listIdeas(tx, actor, url.searchParams.get("status") ?? undefined));

export const POST = factoryRoute((tx, ctx) => idempotent(tx, ctx, "rd.idea.create", () => createIdea(tx, ctx.actor, ctx.body)));

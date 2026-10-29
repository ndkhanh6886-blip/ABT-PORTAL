import { factoryRoute, idempotent } from "@/factory/http";
import { createPartner, listPartners } from "@/factory/master/service";

export const GET = factoryRoute((tx, { actor, url }) => listPartners(tx, actor, { q: url.searchParams.get("q") ?? "", role: url.searchParams.get("role") ?? "" }));
export const POST = factoryRoute((tx, ctx) => idempotent(tx, ctx, "master.partners.create", () => createPartner(tx, ctx.actor, ctx.body)));

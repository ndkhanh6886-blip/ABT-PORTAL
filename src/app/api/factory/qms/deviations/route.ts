import { factoryRoute, idempotent } from "@/factory/http";
import { listDeviations, reportIncident } from "@/factory/qms/deviations";

export const GET = factoryRoute((tx, { actor, url }) => listDeviations(tx, actor, Object.fromEntries(url.searchParams)));
export const POST = factoryRoute((tx, ctx) => idempotent(tx, ctx, "qms.deviations.report", () => reportIncident(tx, ctx.actor, ctx.body)));

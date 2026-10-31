import { factoryRoute, idempotent } from "@/factory/http";
import { createSoftwareRelease, listSoftwareReleases } from "@/factory/rd/transfer";

export const GET = factoryRoute((tx, { actor, url }) => listSoftwareReleases(tx, actor, url.searchParams.get("project_id") ?? undefined));

export const POST = factoryRoute((tx, ctx) => idempotent(tx, ctx, "rd.sw_release.create", () => createSoftwareRelease(tx, ctx.actor, ctx.body)));

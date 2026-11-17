import { factoryRoute, idempotent } from "@/factory/http";
import { createProject, listProjects } from "@/factory/rd/projects";

export const GET = factoryRoute((tx, { actor, url }) =>
  listProjects(tx, actor, {
    domain: url.searchParams.get("domain") || null,
    excludeDomain: url.searchParams.get("exclude_domain") || null,
    activeOnly: url.searchParams.get("active_only") === "1",
    performer: url.searchParams.get("performer") || null,
  })
);

export const POST = factoryRoute((tx, ctx) => idempotent(tx, ctx, "rd.project.create", () => createProject(tx, ctx.actor, ctx.body)));

import { factoryRoute, idempotent } from "@/factory/http";
import { createProject, listProjects } from "@/factory/rd/projects";

export const GET = factoryRoute((tx, { actor, url }) => listProjects(tx, actor, url.searchParams.get("domain") ?? undefined));

export const POST = factoryRoute((tx, ctx) => idempotent(tx, ctx, "rd.project.create", () => createProject(tx, ctx.actor, ctx.body)));

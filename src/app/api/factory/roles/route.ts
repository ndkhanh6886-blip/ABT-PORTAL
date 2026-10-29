import { factoryRoute, idempotent } from "@/factory/http";
import { createRole, listRoles } from "@/factory/core/roles";

export const GET = factoryRoute((tx, { actor }) => listRoles(tx, actor));
export const POST = factoryRoute((tx, ctx) => idempotent(tx, ctx, "core.roles.create", () => createRole(tx, ctx.actor, ctx.body)));

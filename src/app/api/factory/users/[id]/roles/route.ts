import { factoryRoute, idempotent } from "@/factory/http";
import { grantRole } from "@/factory/core/roles";
import { portalDirectory } from "@/factory/portalBridge";

export const POST = factoryRoute((tx, ctx) =>
  idempotent(tx, ctx, "core.users.grant", () => grantRole(tx, ctx.actor, portalDirectory, { ...ctx.body, user_id: Number(ctx.params.id) }))
);

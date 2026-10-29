import { factoryRoute, idempotent } from "@/factory/http";
import { createDelegation, listDelegations } from "@/factory/core/roles";
import { portalDirectory } from "@/factory/portalBridge";

export const GET = factoryRoute((tx, { actor }) => listDelegations(tx, actor));
export const POST = factoryRoute((tx, ctx) => idempotent(tx, ctx, "core.delegations.create", () => createDelegation(tx, ctx.actor, portalDirectory, ctx.body)));

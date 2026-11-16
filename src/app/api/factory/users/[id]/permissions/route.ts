import { factoryRoute } from "@/factory/http";
import { setUserCustomPermission } from "@/factory/core/roles";
import { portalDirectory } from "@/factory/portalBridge";

export const POST = factoryRoute((tx, { actor, params, body }) =>
  setUserCustomPermission(tx, actor, portalDirectory, Number(params.id), body)
);

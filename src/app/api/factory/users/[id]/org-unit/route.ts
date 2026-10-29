import { factoryRoute } from "@/factory/http";
import { setUserOrgUnit } from "@/factory/core/roles";
import { portalDirectory } from "@/factory/portalBridge";

export const PUT = factoryRoute(async (tx, { actor, params, body }) => {
  await setUserOrgUnit(tx, actor, portalDirectory, Number(params.id), typeof body?.org_unit_id === "string" && body.org_unit_id ? body.org_unit_id : null);
  return { ok: true };
});

import { factoryRoute } from "@/factory/http";
import { setUserOrgUnit } from "@/factory/core/roles";
import { portalDirectory } from "@/factory/portalBridge";
import { syncFactoryOrgUnitToPortal } from "@/factory/orgSync";

export const PUT = factoryRoute(async (tx, { actor, params, body }) => {
  const userId = Number(params.id);
  const orgUnitId = typeof body?.org_unit_id === "string" && body.org_unit_id ? body.org_unit_id : null;
  await setUserOrgUnit(tx, actor, portalDirectory, userId, orgUnitId);
  await syncFactoryOrgUnitToPortal(tx, userId, orgUnitId);
  return { ok: true };
});

import { factoryRoute } from "@/factory/http";
import { authorize, syncPermissions } from "@/factory/core/authz";
import { listPermissionCatalogue } from "@/factory/core/roles";

export const GET = factoryRoute(async (tx, { actor }) => {
  await authorize(tx, actor, "core.role.manage");
  await syncPermissions(tx);
  return listPermissionCatalogue(tx);
});

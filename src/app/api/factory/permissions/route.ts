import { factoryRoute } from "@/factory/http";
import { authorize } from "@/factory/core/authz";
import { listPermissionCatalogue } from "@/factory/core/roles";

export const GET = factoryRoute(async (tx, { actor }) => {
  await authorize(tx, actor, "core.role.manage");
  return listPermissionCatalogue(tx);
});

import { factoryRoute } from "@/factory/http";
import { hasFactoryPermission } from "@/factory/core/authz";
import { forbidden } from "@/factory/core/errors";
import { createLocation } from "@/factory/master/service";
import { listLocations, viewableWarehouses } from "@/factory/inv/queries";

export const GET = factoryRoute(async (tx, { actor, params }) => {
  const manager = await hasFactoryPermission(tx, actor, "master.warehouse.manage");
  if (!manager && !(await viewableWarehouses(tx, actor)).some((w) => w.id === params.id)) throw forbidden("Bạn không có quyền xem kho này.");
  return listLocations(tx, params.id);
});
export const POST = factoryRoute((tx, { actor, params, body }) => createLocation(tx, actor, { ...body, warehouse_id: params.id }));

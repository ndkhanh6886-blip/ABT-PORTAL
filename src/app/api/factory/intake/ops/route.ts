import { factoryRoute } from "@/factory/http";
import { invalid } from "@/factory/core/errors";
import {
  createInternalOrderManual,
  dispatchInternalOrderLineToProduction,
  getInternalOrderCatalogOptions,
} from "@/factory/intake/orderDispatchOps";

export const GET = factoryRoute((tx, { actor }) => getInternalOrderCatalogOptions(tx, actor));

export const POST = factoryRoute(async (tx, { actor, body: rawBody }) => {
  const body = (rawBody ?? {}) as Record<string, any>;
  const op = String(body.op ?? "");
  switch (op) {
    case "create_internal_order":
      return createInternalOrderManual(tx, actor, body);
    case "dispatch_to_production":
      return dispatchInternalOrderLineToProduction(tx, actor, body);
    default:
      throw invalid(`Thao tác đơn nội bộ không hợp lệ: ${op}`);
  }
});

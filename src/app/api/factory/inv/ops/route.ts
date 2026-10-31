import { factoryRoute } from "@/factory/http";
import { invalid } from "@/factory/core/errors";
import {
  createReplenishmentPrFromWarehouse,
  dispatchInterWarehouseFefo,
  getWarehouseHubOverview,
  holdNearExpiryLot,
  putAwayReleasedLotOneClick,
} from "@/factory/inv/warehouseOps";

export const GET = factoryRoute((tx, { actor }) => getWarehouseHubOverview(tx, actor));

export const POST = factoryRoute(async (tx, { actor, body: rawBody }) => {
  const body = (rawBody ?? {}) as Record<string, any>;
  const op = String(body.op ?? "");
  switch (op) {
    case "dispatch_inter_warehouse":
      return dispatchInterWarehouseFefo(tx, actor, body);
    case "put_away_one_click":
      return putAwayReleasedLotOneClick(tx, actor, body);
    case "create_replenish_pr":
      return createReplenishmentPrFromWarehouse(tx, actor, body);
    case "hold_lot":
      return holdNearExpiryLot(tx, actor, body);
    default:
      throw invalid(`Thao tác kho không hợp lệ: ${op}`);
  }
});

import { factoryRoute } from "@/factory/http";
import { invalid } from "@/factory/core/errors";
import {
  createDirectReplenishmentPo,
  fastTrackApprovePr,
  fulfillPrLineFromCentralHub,
  getSupplyChainOverview,
  updateSupplierAsl,
} from "@/factory/purchase/supplyChainOps";

export const GET = factoryRoute((tx, { actor }) => getSupplyChainOverview(tx, actor));

export const POST = factoryRoute(async (tx, { actor, body: rawBody }) => {
  const body = (rawBody ?? {}) as Record<string, any>;
  const op = String(body.op ?? "");
  switch (op) {
    case "fulfill_from_hub":
      return fulfillPrLineFromCentralHub(tx, actor, body);
    case "fast_track_approve_pr":
      return fastTrackApprovePr(tx, actor, body);
    case "create_direct_replenish_po":
      return createDirectReplenishmentPo(tx, actor, body);
    case "update_supplier_asl":
      return updateSupplierAsl(tx, actor, body);
    default:
      throw invalid(`Thao tác cung ứng không hợp lệ: ${op}`);
  }
});

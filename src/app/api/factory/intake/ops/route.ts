import { factoryRoute } from "@/factory/http";
import { invalid } from "@/factory/core/errors";
import {
  addOligoSequencesToInternalOrder,
  createInternalOrderManual,
  createPrFromOrderMrp,
  createProductionFromDxknmProposal,
  createQuarterlyForecastAndSplitToDepartments,
  dispatchInternalOrderLineToProduction,
  getInternalOrderCatalogOptions,
  getInternalOrderForecastMrp,
} from "@/factory/intake/orderDispatchOps";

export const GET = factoryRoute((tx, { actor, url }) => {
  const orderId = url.searchParams.get("mrp_order_id");
  if (orderId) {
    return getInternalOrderForecastMrp(tx, actor, orderId);
  }
  return getInternalOrderCatalogOptions(tx, actor);
});

export const POST = factoryRoute(async (tx, { actor, body: rawBody }) => {
  const body = (rawBody ?? {}) as Record<string, any>;
  const op = String(body.op ?? "");
  switch (op) {
    case "create_internal_order":
      return createInternalOrderManual(tx, actor, body);
    case "create_quarterly_forecast":
      return createQuarterlyForecastAndSplitToDepartments(tx, actor, body);
    case "create_pr_from_order_mrp":
      return createPrFromOrderMrp(tx, actor, body);
    case "dispatch_to_production":
      return dispatchInternalOrderLineToProduction(tx, actor, body);
    case "add_oligo_sequences_to_order":
      return addOligoSequencesToInternalOrder(tx, actor, body);
    case "create_production_from_dxknm":
      return createProductionFromDxknmProposal(tx, actor, body);
    default:
      throw invalid(`Thao tác đơn nội bộ không hợp lệ: ${op}`);
  }
});

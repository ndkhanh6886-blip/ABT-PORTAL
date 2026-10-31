import { factoryRoute } from "@/factory/http";
import { authorizeAnywhere } from "@/factory/core/authz";
import { invalid } from "@/factory/core/errors";
import {
  addSpcControlPoint,
  adjustBomScrapFromAnalytics,
  cascadeQuarantineLotTree,
  createCapaFromAnalytics,
  createForecastPrOneClick,
  fastTrackReleaseZeroExceptionBatch,
  getEnterpriseAnalyticsOverview,
  recordLotFreezeThaw,
  simulateWhatIfOrder,
  updateDynamicMinStock,
} from "@/factory/analytics/enterpriseAnalytics";

export const GET = factoryRoute((tx, { actor }) => getEnterpriseAnalyticsOverview(tx, actor));

export const POST = factoryRoute(async (tx, { actor, body: rawBody }) => {
  const body = (rawBody ?? {}) as Record<string, any>;
  const op = String(body.op ?? "");
  switch (op) {
    case "create_capa":
      await authorizeAnywhere(tx, actor, "qms.deviation.manage");
      return createCapaFromAnalytics(tx, actor, body);
    case "adjust_bom_scrap":
      await authorizeAnywhere(tx, actor, "kit.bom.manage");
      return adjustBomScrapFromAnalytics(tx, actor, body);
    case "update_dynamic_rop":
      await authorizeAnywhere(tx, actor, "inv.stock.view");
      return updateDynamicMinStock(tx, actor, body);
    case "create_forecast_pr":
      await authorizeAnywhere(tx, actor, "purchase.pr.create");
      return createForecastPrOneClick(tx, actor, body);
    case "add_spc_point":
      await authorizeAnywhere(tx, actor, "qms.qc.record");
      return addSpcControlPoint(tx, actor, body);
    case "simulate_what_if":
      return simulateWhatIfOrder(tx, actor, body);
    case "cascade_quarantine":
      await authorizeAnywhere(tx, actor, "qms.qc.review");
      return cascadeQuarantineLotTree(tx, actor, body);
    case "record_freeze_thaw":
      await authorizeAnywhere(tx, actor, "inv.document.create");
      return recordLotFreezeThaw(tx, actor, body);
    case "fast_track_release":
      await authorizeAnywhere(tx, actor, "qms.qc.review");
      return fastTrackReleaseZeroExceptionBatch(tx, actor, body);
    default:
      throw invalid(`Thao tác phân tích & dự báo không hợp lệ: ${op}`);
  }
});

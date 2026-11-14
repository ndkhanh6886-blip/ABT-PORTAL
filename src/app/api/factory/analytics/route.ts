import { factoryRoute } from "@/factory/http";
import { authorizeAnywhere } from "@/factory/core/authz";
import { invalid } from "@/factory/core/errors";
import { parseInput } from "@/factory/core/records";
import { authenticateSigner } from "@/factory/core/signature";
import { verifyPortalPassword } from "@/factory/portalBridge";
import "@/factory/master/permissions";
import "@/factory/inv/permissions";
import { z } from "zod";
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

const credSchema = z.object({ method: z.enum(["PIN", "PASSWORD"]), secret: z.string().min(1) });

export const GET = factoryRoute((tx, { actor }) => getEnterpriseAnalyticsOverview(tx, actor));

export const POST = factoryRoute(
  async (tx, { actor, body: rawBody }) => {
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
        await authorizeAnywhere(tx, actor, "master.item.manage");
        return updateDynamicMinStock(tx, actor, body);
      case "create_forecast_pr":
        await authorizeAnywhere(tx, actor, "purchase.pr.create");
        return createForecastPrOneClick(tx, actor, body);
      case "add_spc_point":
        await authorizeAnywhere(tx, actor, "qms.qc.record");
        return addSpcControlPoint(tx, actor, body);
      case "simulate_what_if":
        await authorizeAnywhere(tx, actor, "inv.stock.view");
        return simulateWhatIfOrder(tx, actor, body);
      case "cascade_quarantine":
        await authorizeAnywhere(tx, actor, "qms.qc.review");
        return cascadeQuarantineLotTree(tx, actor, body);
      case "record_freeze_thaw":
        await authorizeAnywhere(tx, actor, "inv.document.create");
        return recordLotFreezeThaw(tx, actor, body);
      case "fast_track_release":
        await authorizeAnywhere(tx, actor, "qms.qc.review");
        return fastTrackReleaseZeroExceptionBatch(tx, actor, body, {
          signerAuthenticated: Boolean(body.credential?.secret),
        });
      default:
        throw invalid(`Thao tác phân tích & dự báo không hợp lệ: ${op}`);
    }
  },
  {
    before: async (ctx) => {
      const body = (ctx.body ?? {}) as Record<string, any>;
      if (body.op === "fast_track_release" && body.batch_domain === "KIT") {
        if (!body.credential?.secret) {
          throw invalid("Bắt buộc xác thực chữ ký điện tử (PIN hoặc Mật khẩu) khi giải phóng lô Kit (21 CFR Part 11).", undefined, "SIGNATURE_REQUIRED");
        }
        const cred = parseInput(credSchema, body.credential);
        await authenticateSigner(ctx.actor.userId, cred, verifyPortalPassword);
      }
    },
  }
);

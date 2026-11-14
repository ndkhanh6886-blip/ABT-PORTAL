import { z } from "zod";
import { factoryRoute } from "@/factory/http";
import { FactoryError, invalid } from "@/factory/core/errors";
import { parseInput } from "@/factory/core/records";
import { authenticateSigner } from "@/factory/core/signature";
import { verifyPortalPassword } from "@/factory/portalBridge";
import {
  assignSpecToItem,
  getQaOpsDashboard,
  issueCoaFromQcTest,
  receiveAndCreateQcTest,
  recordStandardUsage,
  releaseLotFromQcTest,
  saveCoaTemplateConfig,
  saveQcMethod,
  saveReferenceStandard,
  saveRetentionSample,
  triggerStabilityQcTest,
  updateCoaCertificate,
} from "@/factory/qms/qaOps";

const credSchema = z.object({ method: z.enum(["PIN", "PASSWORD"]), secret: z.string().min(1) });
const SIGNED_OPS = new Set(["issue_coa_from_test", "release_lot_from_test", "update_coa_certificate"]);

export const GET = factoryRoute(async (tx, { actor }) => {
  return getQaOpsDashboard(tx, actor);
});

export const POST = factoryRoute(
  async (tx, { actor, body: rawBody }) => {
    const body = (rawBody ?? {}) as Record<string, any>;
    const op = body?.op;
    switch (op) {
      case "receive_lot_qc":
        return receiveAndCreateQcTest(tx, actor, body);
      case "issue_coa_from_test":
        return issueCoaFromQcTest(tx, actor, body, {
          signerAuthenticated: true,
          requireSignature: true,
          credential: body.credential,
        });
      case "release_lot_from_test":
        return releaseLotFromQcTest(tx, actor, body, {
          signerAuthenticated: true,
          requireSignature: true,
          credential: body.credential,
        });
      case "save_reference_standard":
        return saveReferenceStandard(tx, actor, body);
      case "record_standard_usage":
        return recordStandardUsage(tx, actor, body);
      case "save_qc_method":
        return saveQcMethod(tx, actor, body);
      case "save_retention_sample":
        return saveRetentionSample(tx, actor, body);
      case "trigger_stability_test":
        return triggerStabilityQcTest(tx, actor, body);
      case "save_coa_template":
        return saveCoaTemplateConfig(tx, actor, body);
      case "update_coa_certificate":
        return updateCoaCertificate(tx, actor, body, {
          signerAuthenticated: true,
          requireSignature: true,
          credential: body.credential,
        });
      case "assign_spec_item":
        return assignSpecToItem(tx, actor, body);
      default:
        throw invalid(`Thao tác QA/QC không hợp lệ: ${String(op)}`);
    }
  },
  {
    before: async (ctx) => {
      const body = (ctx.body ?? {}) as Record<string, any>;
      if (SIGNED_OPS.has(String(body?.op ?? ""))) {
        if (!body?.credential?.secret) {
          throw new FactoryError(
            422,
            "SIGNATURE_REQUIRED",
            "Bắt buộc xác thực chữ ký điện tử (PIN hoặc Mật khẩu) cho thao tác QA/QC trọng yếu (21 CFR Part 11)."
          );
        }
        const cred = parseInput(credSchema, body.credential);
        await authenticateSigner(ctx.actor.userId, cred, verifyPortalPassword);
      }
    },
  }
);

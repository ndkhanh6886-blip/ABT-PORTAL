import { factoryRoute } from "@/factory/http";
import { invalid } from "@/factory/core/errors";
import {
  getQaOpsDashboard,
  receiveAndCreateQcTest,
  recordStandardUsage,
  releaseLotFromQcTest,
  saveQcMethod,
  saveReferenceStandard,
  saveRetentionSample,
  triggerStabilityQcTest,
} from "@/factory/qms/qaOps";

export const GET = factoryRoute(async (tx, { actor }) => {
  return getQaOpsDashboard(tx, actor);
});

export const POST = factoryRoute(async (tx, { actor, body: rawBody }) => {
  const body = (rawBody ?? {}) as Record<string, any>;
  const op = body?.op;
  switch (op) {
    case "receive_lot_qc":
      return receiveAndCreateQcTest(tx, actor, body);
    case "release_lot_from_test":
      return releaseLotFromQcTest(tx, actor, body);
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
    default:
      throw invalid(`Thao tác QA/QC không hợp lệ: ${String(op)}`);
  }
});

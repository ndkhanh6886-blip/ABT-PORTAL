import { factoryRoute } from "@/factory/http";
import { invalid } from "@/factory/core/errors";
import { getProjectDetail, saveMilestone, saveRiskItem, saveSpecEvaluation } from "@/factory/rd/projects";

export const GET = factoryRoute((tx, { actor, params }) => getProjectDetail(tx, actor, params.id));

export const POST = factoryRoute(async (tx, { actor, params, body }) => {
  const kind = body?.kind;
  if (kind === "spec") {
    return saveSpecEvaluation(tx, actor, params.id, body.spec_id ?? null, body);
  }
  if (kind === "risk") {
    return saveRiskItem(tx, actor, params.id, body.risk_id ?? null, body);
  }
  if (kind === "milestone") {
    return saveMilestone(tx, actor, params.id, body.milestone_id ?? null, body);
  }
  throw invalid("Thao tác dự án không hợp lệ.");
});

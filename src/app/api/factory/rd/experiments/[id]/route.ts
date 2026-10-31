import { factoryRoute } from "@/factory/http";
import { invalid } from "@/factory/core/errors";
import { addExperimentEntry, consumeExperimentMaterial, createExperimentRevision, getExperimentDetail, logExperimentAsset, updateExperimentMeta } from "@/factory/rd/eln";

export const GET = factoryRoute((tx, { actor, params }) => getExperimentDetail(tx, actor, params.id));

export const PUT = factoryRoute((tx, { actor, params, body }) => updateExperimentMeta(tx, actor, params.id, body));

export const POST = factoryRoute(async (tx, { actor, params, body }) => {
  const kind = body?.kind;
  if (kind === "entry") return addExperimentEntry(tx, actor, params.id, body);
  if (kind === "material") return consumeExperimentMaterial(tx, actor, params.id, body);
  if (kind === "asset") return logExperimentAsset(tx, actor, params.id, body);
  if (kind === "revision") return createExperimentRevision(tx, actor, params.id, body);
  throw invalid("Thao tác thí nghiệm không hợp lệ.");
});

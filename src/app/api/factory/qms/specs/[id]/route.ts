import { allowedActionsFor, factoryRoute } from "@/factory/http";
import { authorize } from "@/factory/core/authz";
import { getSpec, specMachine, updateSpecDraft } from "@/factory/qms/specs";

export const GET = factoryRoute(async (tx, { actor, params }) => {
  await authorize(tx, actor, "qms.qc.view");
  const spec = await getSpec(tx, params.id);
  return { ...spec, actions: await allowedActionsFor(tx, specMachine, actor, spec) };
});
export const PATCH = factoryRoute((tx, { actor, params, body }) => updateSpecDraft(tx, actor, params.id, body));

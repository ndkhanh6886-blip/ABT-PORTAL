import { allowedActionsFor, factoryRoute } from "@/factory/http";
import { deviationMachine, getNcr, ncrMachine } from "@/factory/qms/ncr";

export const GET = factoryRoute(async (tx, { actor, params }) => {
  const ncr = await getNcr(tx, actor, params.id);
  const deviationActions = ncr.deviation_id
    ? await allowedActionsFor(tx, deviationMachine, actor, { id: ncr.deviation_id, status: ncr.deviation_status, version: ncr.deviation_version, severity: ncr.severity })
    : [];
  return { ...ncr, actions: await allowedActionsFor(tx, ncrMachine, actor, ncr), deviation_actions: deviationActions };
});

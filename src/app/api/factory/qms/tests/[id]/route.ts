import { allowedActionsFor, factoryRoute } from "@/factory/http";
import { authorize } from "@/factory/core/authz";
import { getQcTest, qcTestMachine } from "@/factory/qms/qcTests";

export const GET = factoryRoute(async (tx, { actor, params }) => {
  await authorize(tx, actor, "qms.qc.view");
  const test = await getQcTest(tx, params.id);
  return { ...test, actions: await allowedActionsFor(tx, qcTestMachine, actor, test) };
});

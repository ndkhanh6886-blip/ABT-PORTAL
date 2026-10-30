import { factoryRoute } from "@/factory/http";
import { editBatchTimes } from "@/factory/oligo/batchQueries";

export const PUT = factoryRoute(async (tx, { actor, params, body }) => {
  await editBatchTimes(tx, actor, params.id, body);
  return { ok: true };
});

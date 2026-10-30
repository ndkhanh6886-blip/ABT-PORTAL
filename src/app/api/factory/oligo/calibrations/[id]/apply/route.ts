import { factoryRoute } from "@/factory/http";
import { applyCalibration } from "@/factory/oligo/bottleCalibration";

export const POST = factoryRoute(async (tx, { actor, params, body }) => {
  await applyCalibration(tx, actor, params.id, (body as { reason?: unknown } | null)?.reason);
  return { ok: true };
});

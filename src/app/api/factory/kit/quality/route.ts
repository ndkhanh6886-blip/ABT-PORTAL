import { factoryRoute, idempotent } from "@/factory/http";
import {
  createRetainSample,
  createStabilityStudy,
  listQualityRecords,
  recordStabilityTimepoint,
} from "@/factory/kit/qualityTrace";

export const GET = factoryRoute(async (tx, { actor }) => {
  return listQualityRecords(tx, actor);
});

export const POST = factoryRoute(async (tx, ctx) => {
  const b = ctx.body as Record<string, unknown>;
  if (b.kind === "stability_study") {
    const study = await idempotent(tx, ctx, "kit:stability", () => createStabilityStudy(tx, ctx.actor, b));
    return { study };
  }
  if (b.kind === "stability_timepoint") {
    const timepoint = await recordStabilityTimepoint(tx, ctx.actor, String(b.study_id), b);
    return { timepoint };
  }
  const retain_sample = await idempotent(tx, ctx, "kit:retain", () => createRetainSample(tx, ctx.actor, b));
  return { retain_sample };
});

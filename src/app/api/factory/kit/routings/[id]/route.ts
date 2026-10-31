import { factoryRoute } from "@/factory/http";
import {
  addRoutingStep,
  cloneRouting,
  fastActivateRouting,
  getRoutingDetail,
  loadStandardKitRoutingSteps,
} from "@/factory/kit/bomRouting";

export const GET = factoryRoute(async (tx, { actor, params }) => {
  return getRoutingDetail(tx, actor, params.id);
});

export const POST = factoryRoute(async (tx, { actor, params, body }) => {
  const b = body as Record<string, unknown>;
  if (b.operation === "clone") {
    const routing = await cloneRouting(tx, actor, params.id);
    return { routing };
  }
  if (b.operation === "load_standard_steps") {
    await loadStandardKitRoutingSteps(tx, actor, params.id);
    return getRoutingDetail(tx, actor, params.id);
  }
  if (b.operation === "fast_activate") {
    const routing = await fastActivateRouting(tx, actor, params.id);
    return { routing };
  }
  const step = await addRoutingStep(tx, actor, { ...b, routing_id: params.id });
  return { step };
});

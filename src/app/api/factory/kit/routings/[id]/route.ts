import { factoryRoute } from "@/factory/http";
import {
  addRoutingStep,
  cloneRouting,
  deleteRoutingStep,
  fastActivateRouting,
  getRoutingDetail,
  loadStandardKitRoutingSteps,
  moveRoutingStep,
  replaceAllRoutingSteps,
  updateRoutingStep,
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
    const templateKey = typeof b.template_key === "string" ? b.template_key : "PCR_5_STEPS";
    await loadStandardKitRoutingSteps(tx, actor, params.id, templateKey);
    return getRoutingDetail(tx, actor, params.id);
  }
  if (b.operation === "fast_activate") {
    const routing = await fastActivateRouting(tx, actor, params.id);
    return { routing };
  }
  if (b.operation === "update_step") {
    const step = await updateRoutingStep(tx, actor, params.id, String(b.step_id || ""), b);
    return { step };
  }
  if (b.operation === "delete_step") {
    return deleteRoutingStep(tx, actor, params.id, String(b.step_id || ""));
  }
  if (b.operation === "move_step") {
    const dir = b.direction === "UP" ? "UP" : "DOWN";
    await moveRoutingStep(tx, actor, params.id, String(b.step_id || ""), dir);
    return getRoutingDetail(tx, actor, params.id);
  }
  if (b.operation === "save_all_steps" && Array.isArray(b.steps)) {
    await replaceAllRoutingSteps(tx, actor, params.id, b.steps);
    return getRoutingDetail(tx, actor, params.id);
  }
  const step = await addRoutingStep(tx, actor, { ...b, routing_id: params.id });
  return { step };
});

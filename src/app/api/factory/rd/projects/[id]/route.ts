import { factoryRoute } from "@/factory/http";
import { invalid } from "@/factory/core/errors";
import {
  applyTemplateToProjectGates,
  deleteProject,
  deleteProjectGate,
  deleteProjectGateDeliverable,
  getProjectDetail,
  saveMilestone,
  saveProjectGateDeliverable,
  saveProjectGateMeta,
  saveRiskItem,
  saveSpecEvaluation,
  updateProject,
} from "@/factory/rd/projects";

export const GET = factoryRoute((tx, { actor, params }) => getProjectDetail(tx, actor, params.id));

export const PUT = factoryRoute((tx, { actor, params, body }) => updateProject(tx, actor, params.id, body));

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
  if (kind === "gate_meta") {
    return saveProjectGateMeta(tx, actor, params.id, body.gate_id ?? null, body);
  }
  if (kind === "delete_gate") {
    return deleteProjectGate(tx, actor, params.id, String(body.gate_id || ""));
  }
  if (kind === "gate_deliverable") {
    return saveProjectGateDeliverable(tx, actor, params.id, body.deliverable_id ?? null, body);
  }
  if (kind === "delete_gate_deliverable") {
    return deleteProjectGateDeliverable(tx, actor, params.id, String(body.deliverable_id || ""));
  }
  if (kind === "apply_gate_template") {
    return applyTemplateToProjectGates(tx, actor, params.id, String(body.template_id || ""));
  }
  throw invalid("Thao tác dự án không hợp lệ.");
});

export const DELETE = factoryRoute((tx, { actor, params, body, url }) =>
  deleteProject(tx, actor, params.id, { reason: body?.reason ?? url.searchParams.get("reason") })
);

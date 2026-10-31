import { factoryRoute } from "@/factory/http";
import { invalid } from "@/factory/core/errors";
import {
  createOligoTrialForProject,
  createPrForProject,
  createQuickRdProject,
  createTransferFromProjectBom,
  getProjectOpsOverview,
  issueMaterialForProject,
  saveProjectTask,
  savePrototypeBom,
} from "@/factory/rd/projectOps";

export const GET = factoryRoute(async (tx, { actor, url }) => {
  const projectId = url.searchParams.get("project_id");
  if (!projectId) throw invalid("Thiếu project_id");
  return getProjectOpsOverview(tx, actor, projectId);
});

export const POST = factoryRoute(async (tx, { actor, body: rawBody }) => {
  const body = (rawBody ?? {}) as Record<string, any>;
  const op = body?.op;
  switch (op) {
    case "create_project":
      return createQuickRdProject(tx, actor, body);
    case "save_task":
      return saveProjectTask(tx, actor, body);
    case "issue_material":
      return issueMaterialForProject(tx, actor, body);
    case "create_pr":
      return createPrForProject(tx, actor, body);
    case "create_oligo_trial":
      return createOligoTrialForProject(tx, actor, body);
    case "save_prototype_bom":
      return savePrototypeBom(tx, actor, body);
    case "create_transfer_package":
      return createTransferFromProjectBom(tx, actor, body);
    default:
      throw invalid(`Thao tác R&D không hợp lệ: ${String(op)}`);
  }
});

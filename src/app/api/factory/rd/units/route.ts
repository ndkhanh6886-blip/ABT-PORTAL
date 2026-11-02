import { factoryRoute, idempotent } from "@/factory/http";
import { hasFactoryPermission } from "@/factory/core/authz";
import { invalid } from "@/factory/core/errors";
import { createStrategicGoal, listEvaluationCriteria, listStrategicGoals, saveEvaluationCriterion } from "@/factory/rd/ideas";
import { listGateTemplates } from "@/factory/rd/projects";
import { listRdStaffRoster } from "@/factory/rd/projectOps";

export const GET = factoryRoute(async (tx, { actor, url }) => {
  const perm = url.searchParams.get("perm") ?? "rd.view";
  if (!/^(rd|work|plan|asset|prep)\.[a-z.]+$/.test(perm)) throw invalid("Quyền không hợp lệ.");
  const allUnits = (
    await tx.query(
      "SELECT id, code, name, module_key FROM core.org_unit WHERE status = 'ACTIVE' AND module_key IN ('RD', 'DEVICE', 'KIT', 'OLIGO') ORDER BY CASE module_key WHEN 'RD' THEN 0 WHEN 'DEVICE' THEN 1 ELSE 2 END, code"
    )
  ).rows;
  const units = [];
  for (const u of allUnits) {
    if (["RD", "DEVICE"].includes(u.module_key) && (await hasFactoryPermission(tx, actor, perm, u.id))) {
      units.push(u);
    }
  }
  const targetUnits = allUnits.filter((u) => ["KIT", "OLIGO", "DEVICE", "RD"].includes(u.module_key));
  const goals = await listStrategicGoals(tx, actor);
  const criteria = await listEvaluationCriteria(tx, actor);
  const templates = await listGateTemplates(tx, actor);
  const rd_staff = await listRdStaffRoster(tx);
  const warehouses = (
    await tx.query(
      "SELECT id, code, name, owner_org_unit_id, purpose FROM master.warehouse WHERE status = 'ACTIVE' ORDER BY CASE purpose WHEN 'RD' THEN 0 ELSE 1 END, code"
    )
  ).rows;
  const locations = (
    await tx.query("SELECT id, warehouse_id, code, name, temperature_condition, is_quarantine FROM master.location WHERE status = 'ACTIVE' ORDER BY code")
  ).rows;
  const items = (
    await tx.query("SELECT id, code, name, item_type, base_uom FROM master.item WHERE status = 'ACTIVE' ORDER BY code LIMIT 500")
  ).rows;
  return { units, targetUnits, goals, criteria, templates, warehouses, locations, items, rd_staff };
});

export const POST = factoryRoute(async (tx, ctx) => {
  const kind = ctx.body?.kind;
  if (kind === "goal") {
    return idempotent(tx, ctx, "rd.goal.create", () => createStrategicGoal(tx, ctx.actor, ctx.body));
  }
  if (kind === "criterion") {
    return saveEvaluationCriterion(tx, ctx.actor, ctx.body.id ?? null, ctx.body);
  }
  throw invalid("Loại cấu hình R&D không hợp lệ.");
});

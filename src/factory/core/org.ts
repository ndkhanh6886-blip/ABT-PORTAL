import { z } from "zod";
import type { Tx } from "./db";
import { authorize, getPermission, grantablePermissions, hasFactoryPermission, isQaCrossDeptPermission, type AuthzActor } from "./authz";
import { invalid } from "./errors";
import { insertRecord, parseInput } from "./records";

export const MODULE_KEYS = ["RD", "KIT", "OLIGO", "DEVICE", "QA", "WH", "SALES", "PURCHASE", "HR", "BOD"] as const;

const createOrgUnitSchema = z.object({
  code: z
    .string()
    .trim()
    .min(2, "tối thiểu 2 ký tự")
    .max(30)
    .regex(/^[A-Za-z0-9_-]+$/, "chỉ gồm chữ không dấu, số, gạch ngang, gạch dưới")
    .transform((s) => s.toUpperCase()),
  name: z.string().trim().min(1, "bắt buộc").max(200),
  unit_type: z.enum(["COMPANY", "DEPARTMENT", "TEAM"]),
  parent_id: z.string().uuid().optional().nullable(),
  module_key: z.enum(MODULE_KEYS).optional().nullable(),
});

export async function createOrgUnit(tx: Tx, actor: AuthzActor, input: unknown) {
  await authorize(tx, actor, "core.org.manage");
  const data = parseInput(createOrgUnitSchema, input);
  if (data.unit_type !== "COMPANY" && !data.parent_id) throw invalid("Phòng ban / tổ phải thuộc một đơn vị cha.");
  return insertRecord(tx, actor, "core.org_unit", "org_unit", data);
}

export async function listOrgUnits(tx: Tx) {
  return (await tx.query("SELECT id, code, name, unit_type, parent_id, module_key, status FROM core.org_unit ORDER BY unit_type, code")).rows;
}

const STRICT_DEPT_MODULE: Record<string, string> = {
  kit: "KIT",
  oligo: "OLIGO",
  device: "DEVICE",
  rd: "RD",
  qms: "QA",
};

/** Permission codes the user effectively holds somewhere (respecting org-unit scopes and personal exclusions): drives UI tabs and buttons. */
export async function heldPermissions(tx: Tx, actor: AuthzActor): Promise<string[]> {
  if (actor.isRootAdmin) return grantablePermissions();
  const res = await tx.query(
    `SELECT DISTINCT rp.permission_code, ur.scope_org_unit_id, o.module_key, o.unit_type
       FROM core.user_role ur
       JOIN core.role r ON r.id = ur.role_id AND r.status = 'ACTIVE'
       JOIN core.role_permission rp ON rp.role_id = ur.role_id
       JOIN core.user_profile up ON up.user_id = ur.user_id AND up.status = 'ACTIVE'
       LEFT JOIN core.org_unit o ON o.id = ur.scope_org_unit_id
      WHERE ur.user_id = $1 AND ur.revoked_at IS NULL AND ur.valid_from <= now() AND (ur.valid_to IS NULL OR ur.valid_to > now())
     UNION
     SELECT DISTINCT rp.permission_code, ur.scope_org_unit_id, o.module_key, o.unit_type
       FROM core.delegation d
       JOIN core.user_role ur ON ur.user_id = d.from_user_id AND ur.role_id = d.role_id AND ur.revoked_at IS NULL
       JOIN core.role_permission rp ON rp.role_id = ur.role_id
       LEFT JOIN core.org_unit o ON o.id = ur.scope_org_unit_id
      WHERE d.to_user_id = $1 AND d.revoked_at IS NULL AND d.valid_from <= now() AND d.valid_to > now()`,
    [actor.userId]
  );
  const codes = new Set<string>();
  for (const r of res.rows) {
    const code = r.permission_code as string;
    const mod = code.split(".")[0];
    const ownerMod = STRICT_DEPT_MODULE[mod];
    const isGlobal = !r.scope_org_unit_id || r.unit_type === "COMPANY" || !r.module_key;
    const isAllowedInScope =
      isGlobal ||
      !ownerMod ||
      r.module_key === ownerMod ||
      (mod === "rd" && r.module_key === "DEVICE") ||
      (r.module_key === "QA" && isQaCrossDeptPermission(code));
    if (isAllowedInScope) codes.add(code);
  }
  // Every signed-in internal user (including Khối Kinh Doanh) can view and track internal orders transferred to production
  codes.add("intake.order.view");
  for (const code of ["core.org.manage", "core.role.manage", "core.sequence.manage", "core.setting.manage", "core.audit.view", "master.warehouse.manage"]) {
    if (getPermission(code)?.bootstrapAdmin && (await hasFactoryPermission(tx, actor, code))) codes.add(code);
  }
  const excluded = await tx.query("SELECT permission_code FROM core.user_permission_exclusion WHERE user_id = $1", [actor.userId]);
  for (const row of excluded.rows) {
    codes.delete(row.permission_code as string);
  }
  return [...codes].sort();
}

import { z } from "zod";
import type { Tx } from "./db";
import { authorize, getPermission, grantablePermissions, hasFactoryPermission, type AuthzActor } from "./authz";
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

/** Permission codes the user holds somewhere (any scope): drives which tabs/buttons the UI offers. Every action is re-checked server-side. */
export async function heldPermissions(tx: Tx, actor: AuthzActor): Promise<string[]> {
  if (actor.isRootAdmin) return grantablePermissions();
  const res = await tx.query(
    `SELECT DISTINCT rp.permission_code FROM core.user_role ur
       JOIN core.role r ON r.id = ur.role_id AND r.status = 'ACTIVE'
       JOIN core.role_permission rp ON rp.role_id = ur.role_id
       JOIN core.user_profile up ON up.user_id = ur.user_id AND up.status = 'ACTIVE'
      WHERE ur.user_id = $1 AND ur.revoked_at IS NULL AND ur.valid_from <= now() AND (ur.valid_to IS NULL OR ur.valid_to > now())
     UNION
     SELECT DISTINCT rp.permission_code FROM core.delegation d
       JOIN core.user_role ur ON ur.user_id = d.from_user_id AND ur.role_id = d.role_id AND ur.revoked_at IS NULL
       JOIN core.role_permission rp ON rp.role_id = ur.role_id
      WHERE d.to_user_id = $1 AND d.revoked_at IS NULL AND d.valid_from <= now() AND d.valid_to > now()`,
    [actor.userId]
  );
  const codes = new Set<string>(res.rows.map((r) => r.permission_code));
  for (const code of ["core.org.manage", "core.role.manage", "core.sequence.manage", "core.setting.manage", "core.audit.view", "master.warehouse.manage"]) {
    if (getPermission(code)?.bootstrapAdmin && (await hasFactoryPermission(tx, actor, code))) codes.add(code);
  }
  return [...codes].sort();
}

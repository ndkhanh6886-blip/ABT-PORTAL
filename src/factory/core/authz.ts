import type { Tx } from "./db";
import type { Actor } from "./audit";
import { forbidden } from "./errors";

export interface PermissionDef {
  code: string;
  description: string;
  gxpCritical?: boolean;
  /** ABT Portal administrators hold it without a factory role, so they can set the factory up. */
  bootstrapAdmin?: boolean;
  /** Only the system actor (jobs, automatic follow-ups) holds it; no role can grant it. */
  systemOnly?: boolean;
}

/**
 * Permission catalogue. Each module registers its permissions in code; `syncPermissions` mirrors
 * them into `core.permission` at deploy so roles can be configured in the UI.
 */
const registry = new Map<string, PermissionDef>();

export function registerPermissions(defs: PermissionDef[]): void {
  for (const d of defs) {
    if (!/^[a-z]+(\.[a-z_]+){1,3}$/.test(d.code)) throw new Error(`Mã quyền không hợp lệ: ${d.code}`);
    registry.set(d.code, d);
  }
}

/** Every permission a role can hold (system-only ones excluded). */
export function grantablePermissions(): string[] {
  return [...registry.values()].filter((d) => !d.systemOnly).map((d) => d.code).sort();
}

export function getPermission(code: string): PermissionDef | undefined {
  return registry.get(code);
}

registerPermissions([
  { code: "core.org.manage", description: "Quản lý cơ cấu tổ chức nhà máy", bootstrapAdmin: true },
  { code: "core.role.manage", description: "Quản lý vai trò và cấp quyền", bootstrapAdmin: true },
  { code: "core.sequence.manage", description: "Sửa mẫu mã số", bootstrapAdmin: true },
  { code: "core.setting.manage", description: "Sửa tham số cấu hình", bootstrapAdmin: true },
  { code: "core.audit.view", description: "Xem nhật ký kiểm tra (audit trail)", bootstrapAdmin: true },
]);

export async function syncPermissions(tx: Tx): Promise<void> {
  const defs = [...registry.values()];
  for (const d of defs) {
    const [module, ...rest] = d.code.split(".");
    await tx.query(
      `INSERT INTO core.permission (code, module, action, description, is_gxp_critical, is_active)
       VALUES ($1, $2, $3, $4, $5, true)
       ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description,
         is_gxp_critical = EXCLUDED.is_gxp_critical, is_active = true`,
      [d.code, module, rest.join("."), d.description, Boolean(d.gxpCritical)]
    );
  }
  await tx.query("UPDATE core.permission SET is_active = false WHERE NOT (code = ANY($1::text[]))", [defs.map((d) => d.code)]);
}

export interface AuthzActor extends Actor {
  /** ABT Portal administrator (settings.view): only `bootstrapAdmin` permissions follow from it. */
  isPortalAdmin?: boolean;
  /**
   * Root administrator: ABT Portal account with role "admin". Holds every grantable factory permission in
   * every department and grants roles to others. Separation of duties on a record (approver ≠ performer)
   * and e-signatures still apply to it.
   */
  isRootAdmin?: boolean;
  /** Scheduled jobs and automatic effects; holds exactly the `systemOnly` permissions. */
  isSystem?: boolean;
}

/** Actor of jobs and automatic transitions. User id 0 never belongs to a person. */
export const SYSTEM_ACTOR: AuthzActor = { userId: 0, name: "Hệ thống", isSystem: true };

/**
 * True when the user holds the permission through an active role (own or delegated to them), whose
 * scope is the whole company or `orgUnitId` / one of its parent units.
 */
export async function hasFactoryPermission(tx: Tx, actor: AuthzActor, permission: string, orgUnitId?: string | null): Promise<boolean> {
  const def = registry.get(permission);
  if (!def) throw new Error(`Quyền chưa được khai báo: ${permission}`);
  if (def.systemOnly || actor.isSystem) return Boolean(def.systemOnly && actor.isSystem);
  if (actor.isRootAdmin) return true;
  if (def.bootstrapAdmin && actor.isPortalAdmin) return true;
  const res = await tx.query(
    `WITH RECURSIVE ancestors AS (
       SELECT id, parent_id FROM core.org_unit WHERE id = $3::uuid
       UNION ALL
       SELECT o.id, o.parent_id FROM core.org_unit o JOIN ancestors a ON o.id = a.parent_id
     ),
     grants AS (
       SELECT ur.role_id, ur.scope_org_unit_id FROM core.user_role ur
        WHERE ur.user_id = $1 AND ur.revoked_at IS NULL
          AND ur.valid_from <= now() AND (ur.valid_to IS NULL OR ur.valid_to > now())
       UNION ALL
       SELECT ur.role_id, ur.scope_org_unit_id FROM core.delegation d
         JOIN core.user_role ur ON ur.user_id = d.from_user_id AND ur.role_id = d.role_id AND ur.revoked_at IS NULL
        WHERE d.to_user_id = $1 AND d.revoked_at IS NULL AND d.valid_from <= now() AND d.valid_to > now()
     )
     SELECT 1 FROM grants g
       JOIN core.role r ON r.id = g.role_id AND r.status = 'ACTIVE'
       JOIN core.role_permission rp ON rp.role_id = g.role_id AND rp.permission_code = $2
       JOIN core.user_profile up ON up.user_id = $1 AND up.status = 'ACTIVE'
      WHERE g.scope_org_unit_id IS NULL OR g.scope_org_unit_id IN (SELECT id FROM ancestors)
      LIMIT 1`,
    [actor.userId, permission, orgUnitId ?? null]
  );
  return (res.rowCount ?? 0) > 0;
}

export async function authorize(tx: Tx, actor: AuthzActor, permission: string, orgUnitId?: string | null): Promise<void> {
  if (!(await hasFactoryPermission(tx, actor, permission, orgUnitId))) {
    throw forbidden(`Bạn chưa có quyền "${registry.get(permission)?.description ?? permission}". Liên hệ trưởng phòng hoặc quản trị viên để được cấp.`);
  }
}

/**
 * Settings shared by one department type (e.g. the Oligo catalogue, reagent rules, SOPs) have no org unit:
 * the permission granted in any scope is enough.
 */
export async function authorizeAnywhere(tx: Tx, actor: AuthzActor, permission: string): Promise<void> {
  const def = registry.get(permission);
  if (!def) throw new Error(`Quyền chưa được khai báo: ${permission}`);
  if (await hasFactoryPermission(tx, actor, permission)) return;
  const units = (await tx.query("SELECT DISTINCT scope_org_unit_id AS id FROM core.user_role WHERE user_id = $1 AND revoked_at IS NULL AND scope_org_unit_id IS NOT NULL", [actor.userId])).rows;
  for (const u of units) if (await hasFactoryPermission(tx, actor, permission, u.id)) return;
  const delegated = (
    await tx.query(
      `SELECT DISTINCT ur.scope_org_unit_id AS id FROM core.delegation d JOIN core.user_role ur ON ur.user_id = d.from_user_id AND ur.role_id = d.role_id
        WHERE d.to_user_id = $1 AND d.revoked_at IS NULL AND ur.scope_org_unit_id IS NOT NULL`,
      [actor.userId]
    )
  ).rows;
  for (const u of delegated) if (await hasFactoryPermission(tx, actor, permission, u.id)) return;
  throw forbidden(`Bạn chưa có quyền "${def.description}". Liên hệ trưởng phòng hoặc quản trị viên để được cấp.`);
}

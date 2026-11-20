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
 * scope is the whole company or `orgUnitId` / one of its parent units, and it is not excluded for
 * that specific user (`core.user_permission_exclusion`).
 */
export const QA_CROSS_DEPT_PERMS = new Set([
  "master.data.view",
  "inv.stock.view",
  "inv.lot.sample",
  "inv.lot.release",
  "inv.lot.hold",
  "inv.lot.reject",
  "kit.view",
  "kit.bom.approve",
  "kit.ebr.check",
  "kit.order.release",
  "kit.quality.manage",
  "oligo.view",
  "device.view",
  "device.eco.approve",
  "device.unit.release",
  "device.qa.release",
  "rd.view",
  "rd.gate.review",
]);

export const WH_CROSS_DEPT_PERMS = new Set([
  "master.data.view",
  "master.item.manage",
  "master.partner.manage",
  "master.warehouse.manage",
  "purchase.po.view",
  "purchase.po.manage",
  "purchase.pr.view",
  "purchase.receipt.post",
  "inv.stock.view",
  "inv.document.create",
  "inv.document.post",
  "inv.document.reverse",
  "inv.reservation.manage",
  "inv.lot.sample",
  "inv.lot.release",
  "inv.lot.hold",
  "inv.lot.reject",
  "intake.order.view",
  "intake.shipment.post",
]);

export function isQaCrossDeptPermission(permission: string): boolean {
  return permission.startsWith("qms.") || QA_CROSS_DEPT_PERMS.has(permission);
}

export function isWhCrossDeptPermission(permission: string): boolean {
  return permission.startsWith("inv.") || permission.startsWith("master.") || WH_CROSS_DEPT_PERMS.has(permission);
}

/**
 * Phòng IT (Khối Kinh doanh) is separate from Khối Kỹ thuật. Its software projects / releases live in the shared
 * project tables, so the code asks for `rd.*` permissions; on a record owned by P-IT (or a unit under it) that
 * check is answered with the `it.*` permission below instead. An `rd.*` permission without an IT counterpart
 * (ideas, samples, ELN, accepting a transfer…) is never granted on a P-IT record. So R&D / KTCN roles never open
 * an IT record, and IT roles (which hold only `it.*`) never open an R&D / KTCN one.
 */
export const IT_PERMISSION_FOR: Readonly<Record<string, string>> = {
  "rd.view": "it.view",
  "rd.project.manage": "it.project.manage",
  "rd.project.edit": "it.project.edit",
  "rd.project.delete": "it.project.delete",
  "rd.gate.review": "it.gate.review",
  "rd.transfer.manage": "it.transfer.manage",
  "rd.software.release": "it.software.release",
};

// The org tree rarely changes and the answer is asked for every row of the project lists: cache it briefly.
const IT_UNIT_TTL_MS = 60_000;
const itUnitCache = new Map<string, { value: boolean; at: number }>();

/** True when the org unit is Phòng IT (module IT) or sits under it. Cached for a minute per unit. */
export async function isItOrgUnit(tx: Tx, orgUnitId: string): Promise<boolean> {
  const hit = itUnitCache.get(orgUnitId);
  if (hit && Date.now() - hit.at < IT_UNIT_TTL_MS) return hit.value;
  const value = await isItOrgUnitUncached(tx, orgUnitId);
  if (itUnitCache.size > 2000) itUnitCache.clear();
  itUnitCache.set(orgUnitId, { value, at: Date.now() });
  return value;
}

/**
 * Answers one permission per org unit for a whole list (rows share a few owner units): avoids one permission
 * query per row. Use inside a single request only.
 */
export function permissionPerUnit(tx: Tx, actor: AuthzActor, permission: string): (orgUnitId: string | null | undefined) => Promise<boolean> {
  const seen = new Map<string, Promise<boolean>>();
  return (orgUnitId) => {
    const key = orgUnitId ?? "";
    let p = seen.get(key);
    if (!p) {
      p = hasFactoryPermission(tx, actor, permission, orgUnitId ?? null);
      seen.set(key, p);
    }
    return p;
  };
}

async function isItOrgUnitUncached(tx: Tx, orgUnitId: string): Promise<boolean> {
  const res = await tx.query(
    `WITH RECURSIVE ancestors AS (
       SELECT id, parent_id, module_key FROM core.org_unit WHERE id = $1::uuid
       UNION ALL
       SELECT o.id, o.parent_id, o.module_key FROM core.org_unit o JOIN ancestors a ON o.id = a.parent_id
     )
     SELECT 1 FROM ancestors WHERE module_key = 'IT' LIMIT 1`,
    [orgUnitId]
  );
  return (res.rowCount ?? 0) > 0;
}

export async function hasFactoryPermission(tx: Tx, actor: AuthzActor, permission: string, orgUnitId?: string | null): Promise<boolean> {
  const def = registry.get(permission);
  if (!def) throw new Error(`Quyền chưa được khai báo: ${permission}`);
  if (def.systemOnly || actor.isSystem) return Boolean(def.systemOnly && actor.isSystem);
  if (actor.isRootAdmin) return true;
  if (orgUnitId && permission.startsWith("rd.") && (await isItOrgUnit(tx, orgUnitId))) {
    const itPermission = IT_PERMISSION_FOR[permission];
    return itPermission ? hasFactoryPermission(tx, actor, itPermission, orgUnitId) : false;
  }
  if (def.bootstrapAdmin && actor.isPortalAdmin) {
    const excl = await tx.query(
      "SELECT 1 FROM core.user_permission_exclusion WHERE user_id = $1 AND permission_code = $2 LIMIT 1",
      [actor.userId, permission]
    );
    return (excl.rowCount ?? 0) === 0;
  }
  const isQaCrossDept = isQaCrossDeptPermission(permission);
  const isWhCrossDept = isWhCrossDeptPermission(permission);
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
       LEFT JOIN core.org_unit g_ou ON g_ou.id = g.scope_org_unit_id
      WHERE (
        g.scope_org_unit_id IS NULL
        OR g.scope_org_unit_id IN (SELECT id FROM ancestors)
        OR ($4::boolean AND (g_ou.module_key = 'QA' OR r.code IN ('QA_HEAD', 'QA_STAFF')))
        OR ($5::boolean AND (g_ou.module_key IN ('WH', 'PURCHASE') OR r.code IN ('WH_HEAD', 'WH_STAFF')))
      )
        AND NOT EXISTS (
          SELECT 1 FROM core.user_permission_exclusion upe
           WHERE upe.user_id = $1 AND upe.permission_code = $2
        )
      LIMIT 1`,
    [actor.userId, permission, orgUnitId ?? null, isQaCrossDept, isWhCrossDept]
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
  if (await holdsAnywhere(tx, actor, permission)) return;
  throw forbidden(`Bạn chưa có quyền "${def.description}". Liên hệ trưởng phòng hoặc quản trị viên để được cấp.`);
}

/**
 * Like `authorizeAnywhere`, for the shared project screens that both Khối Kỹ thuật (`rd.*`) and Phòng IT (`it.*`)
 * open: passes when the user holds any of the permissions somewhere. The caller must still filter each record by its
 * owner unit (`hasFactoryPermission(…, "rd.view", owner)`), which keeps IT and R&D / KTCN records apart.
 */
export async function authorizeAnywhereOneOf(tx: Tx, actor: AuthzActor, permissions: string[]): Promise<void> {
  for (const p of permissions) {
    if (!registry.get(p)) throw new Error(`Quyền chưa được khai báo: ${p}`);
    if (await holdsAnywhere(tx, actor, p)) return;
  }
  throw forbidden(`Bạn chưa có quyền "${registry.get(permissions[0])?.description ?? permissions[0]}". Liên hệ trưởng phòng hoặc quản trị viên để được cấp.`);
}

async function holdsAnywhere(tx: Tx, actor: AuthzActor, permission: string): Promise<boolean> {
  if (await hasFactoryPermission(tx, actor, permission)) return true;
  const units = (await tx.query("SELECT DISTINCT scope_org_unit_id AS id FROM core.user_role WHERE user_id = $1 AND revoked_at IS NULL AND scope_org_unit_id IS NOT NULL", [actor.userId])).rows;
  const delegated = (
    await tx.query(
      `SELECT DISTINCT ur.scope_org_unit_id AS id FROM core.delegation d JOIN core.user_role ur ON ur.user_id = d.from_user_id AND ur.role_id = d.role_id
        WHERE d.to_user_id = $1 AND d.revoked_at IS NULL AND ur.scope_org_unit_id IS NOT NULL`,
      [actor.userId]
    )
  ).rows;
  for (const u of [...units, ...delegated]) {
    // An IT-scoped role answers rd.* through it.* (see IT_PERMISSION_FOR): it must not count as holding the
    // R&D permission "somewhere", or an IT user would pass every R&D screen guarded by authorizeAnywhere.
    if (permission.startsWith("rd.") && (await isItOrgUnit(tx, u.id))) continue;
    if (await hasFactoryPermission(tx, actor, permission, u.id)) return true;
  }
  return false;
}

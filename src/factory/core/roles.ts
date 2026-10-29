import { z } from "zod";
import type { Tx } from "./db";
import { diffChanges, writeAudit } from "./audit";
import { authorize, getPermission, hasFactoryPermission, type AuthzActor } from "./authz";
import { conflict, forbidden, invalid, notFound } from "./errors";
import { parseInput } from "./records";
import { setPin } from "./signature";

/** ABT Portal accounts, reached through the portal bridge (the factory never reads portal tables itself). */
export interface DirectoryUser {
  id: number;
  username: string;
  full_name: string;
  department: string | null;
  is_active: boolean;
  /** ABT Portal role; "admin" = root administrator of the factory. */
  role?: string;
}
export interface UserDirectory {
  search(q: string, limit: number): Promise<DirectoryUser[]>;
  get(id: number): Promise<DirectoryUser | null>;
}

const roleCode = z
  .string()
  .trim()
  .min(2, "tối thiểu 2 ký tự")
  .max(40)
  .regex(/^[A-Za-z0-9_]+$/, "chỉ gồm chữ không dấu, số, gạch dưới")
  .transform((s) => s.toUpperCase());
const permissionList = z.array(z.string()).max(300).transform((a) => [...new Set(a)].sort());

const createRoleSchema = z.object({
  code: roleCode,
  name: z.string().trim().min(1, "bắt buộc").max(150),
  description: z.string().trim().max(1000).optional().nullable(),
  permissions: permissionList,
});
const updateRoleSchema = z.object({
  version: z.number().int().min(0),
  name: z.string().trim().min(1).max(150).optional(),
  description: z.string().trim().max(1000).optional().nullable(),
  permissions: permissionList.optional(),
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
  reason: z.string().trim().min(3, "nhập lý do thay đổi quyền (tối thiểu 3 ký tự)").max(500),
});
const grantSchema = z.object({
  user_id: z.number().int().positive(),
  role_id: z.string().uuid(),
  scope_org_unit_id: z.string().uuid().optional().nullable(),
  valid_to: z.string().datetime({ offset: true }).optional().nullable(),
  reason: z.string().trim().max(500).optional().nullable(),
});
const delegationSchema = z.object({
  from_user_id: z.number().int().positive(),
  to_user_id: z.number().int().positive(),
  role_id: z.string().uuid(),
  valid_from: z.string().datetime({ offset: true }),
  valid_to: z.string().datetime({ offset: true }),
  reason: z.string().trim().min(3, "nhập lý do ủy quyền").max(500),
});

/** Grantable permissions: system-only ones never appear in a role. */
function assertGrantable(codes: string[]): void {
  for (const c of codes) {
    const def = getPermission(c);
    if (!def) throw invalid(`Quyền "${c}" không tồn tại.`);
    if (def.systemOnly) throw invalid(`Quyền "${def.description}" chỉ dành cho hệ thống, không gán vào vai trò.`);
  }
}

export async function listPermissionCatalogue(tx: Tx) {
  const rows = (await tx.query("SELECT code, module, action, description, is_gxp_critical FROM core.permission WHERE is_active ORDER BY module, code")).rows;
  return rows.filter((r) => !getPermission(r.code)?.systemOnly);
}

export async function listRoles(tx: Tx, actor: AuthzActor) {
  await authorize(tx, actor, "core.role.manage");
  return (
    await tx.query(
      `SELECT r.id, r.code, r.name, r.description, r.status, r.version,
              coalesce(array_agg(rp.permission_code ORDER BY rp.permission_code) FILTER (WHERE rp.permission_code IS NOT NULL), '{}') AS permissions,
              (SELECT count(*)::int FROM core.user_role ur WHERE ur.role_id = r.id AND ur.revoked_at IS NULL) AS holders
         FROM core.role r LEFT JOIN core.role_permission rp ON rp.role_id = r.id
        GROUP BY r.id ORDER BY r.status, r.code`
    )
  ).rows;
}

async function setRolePermissions(tx: Tx, roleId: string, codes: string[]): Promise<void> {
  await tx.query("DELETE FROM core.role_permission WHERE role_id = $1", [roleId]);
  if (codes.length) {
    await tx.query("INSERT INTO core.role_permission (role_id, permission_code) SELECT $1, unnest($2::text[])", [roleId, codes]);
  }
}

export async function createRole(tx: Tx, actor: AuthzActor, input: unknown) {
  await authorize(tx, actor, "core.role.manage");
  const data = parseInput(createRoleSchema, input);
  assertGrantable(data.permissions);
  if ((await tx.query("SELECT 1 FROM core.role WHERE code = $1", [data.code])).rowCount) throw conflict(`Vai trò ${data.code} đã tồn tại.`, "DUPLICATE_CODE");
  const role = (
    await tx.query("INSERT INTO core.role (code, name, description, created_by) VALUES ($1, $2, $3, $4) RETURNING *", [
      data.code,
      data.name,
      data.description ?? null,
      actor.userId,
    ])
  ).rows[0];
  await setRolePermissions(tx, role.id, data.permissions);
  await writeAudit(tx, actor, {
    entityType: "role",
    entityId: role.id,
    action: "create",
    changes: { code: [null, data.code], name: [null, data.name], permissions: [null, data.permissions] },
  });
  return role;
}

/** Edits a role; permission changes apply at once to every holder and are audited with old → new lists and a reason. */
export async function updateRole(tx: Tx, actor: AuthzActor, roleId: string, input: unknown) {
  await authorize(tx, actor, "core.role.manage");
  const data = parseInput(updateRoleSchema, input);
  const current = (await tx.query("SELECT * FROM core.role WHERE id = $1 FOR UPDATE", [roleId])).rows[0];
  if (!current) throw notFound("vai trò");
  if (current.version !== data.version) throw conflict("Vai trò vừa được người khác sửa. Tải lại rồi thực hiện lại.", "STALE_VERSION");
  const oldPerms: string[] = (await tx.query("SELECT permission_code FROM core.role_permission WHERE role_id = $1 ORDER BY 1", [roleId])).rows.map((r) => r.permission_code);
  const next = { name: data.name ?? current.name, description: data.description === undefined ? current.description : data.description, status: data.status ?? current.status };
  const changes = diffChanges(current, next, ["name", "description", "status"]);
  if (data.permissions) {
    assertGrantable(data.permissions);
    if (JSON.stringify(oldPerms) !== JSON.stringify(data.permissions)) {
      changes.permissions = [oldPerms, data.permissions];
      await setRolePermissions(tx, roleId, data.permissions);
    }
  }
  if (!Object.keys(changes).length) return current;
  const updated = (
    await tx.query("UPDATE core.role SET name = $2, description = $3, status = $4, version = version + 1 WHERE id = $1 RETURNING *", [
      roleId,
      next.name,
      next.description,
      next.status,
    ])
  ).rows[0];
  await writeAudit(tx, actor, { entityType: "role", entityId: roleId, action: "update", changes, reason: data.reason });
  return updated;
}

async function ensureProfile(tx: Tx, directory: UserDirectory, userId: number): Promise<DirectoryUser> {
  const user = await directory.get(userId);
  if (!user) throw notFound("tài khoản ABT Portal");
  if (!user.is_active) throw invalid(`Tài khoản ${user.username} đang bị khóa trên ABT Portal.`);
  await tx.query(
    `INSERT INTO core.user_profile (user_id, display_name) VALUES ($1, $2)
     ON CONFLICT (user_id) DO UPDATE SET display_name = EXCLUDED.display_name`,
    [userId, user.full_name || user.username]
  );
  return user;
}

export async function grantRole(tx: Tx, actor: AuthzActor, directory: UserDirectory, input: unknown) {
  await authorize(tx, actor, "core.role.manage");
  const data = parseInput(grantSchema, input);
  if (data.user_id === actor.userId) throw forbidden("Không tự cấp vai trò cho chính mình. Nhờ một quản trị viên khác thực hiện.");
  const user = await ensureProfile(tx, directory, data.user_id);
  const role = (await tx.query("SELECT code, status FROM core.role WHERE id = $1", [data.role_id])).rows[0];
  if (!role || role.status !== "ACTIVE") throw invalid("Vai trò không tồn tại hoặc đã ngừng sử dụng.");
  if (data.scope_org_unit_id && !(await tx.query("SELECT 1 FROM core.org_unit WHERE id = $1", [data.scope_org_unit_id])).rowCount) {
    throw invalid("Phạm vi phòng ban không tồn tại.");
  }
  const existing = await tx.query(
    "SELECT 1 FROM core.user_role WHERE user_id = $1 AND role_id = $2 AND scope_org_unit_id IS NOT DISTINCT FROM $3 AND revoked_at IS NULL",
    [data.user_id, data.role_id, data.scope_org_unit_id ?? null]
  );
  if (existing.rowCount) throw conflict(`${user.full_name} đã có vai trò ${role.code} với phạm vi này.`, "ALREADY_GRANTED");
  const row = (
    await tx.query(
      "INSERT INTO core.user_role (user_id, role_id, scope_org_unit_id, valid_to, granted_by) VALUES ($1, $2, $3, $4, $5) RETURNING *",
      [data.user_id, data.role_id, data.scope_org_unit_id ?? null, data.valid_to ?? null, actor.userId]
    )
  ).rows[0];
  await writeAudit(tx, actor, {
    entityType: "user_role",
    entityId: row.id,
    action: "grant",
    changes: { user: [null, `${user.username} (${data.user_id})`], role: [null, role.code], scope: [null, data.scope_org_unit_id ?? "toàn công ty"] },
    reason: data.reason ?? null,
  });
  return row;
}

export async function revokeRole(tx: Tx, actor: AuthzActor, userRoleId: string, reason: unknown) {
  await authorize(tx, actor, "core.role.manage");
  const why = parseInput(z.string().trim().min(3, "nhập lý do thu hồi"), reason);
  const res = await tx.query(
    "UPDATE core.user_role SET revoked_at = now(), revoked_by = $2, revoke_reason = $3 WHERE id = $1 AND revoked_at IS NULL RETURNING user_id, role_id",
    [userRoleId, actor.userId, why]
  );
  if (!res.rowCount) throw notFound("vai trò đang hiệu lực");
  await writeAudit(tx, actor, { entityType: "user_role", entityId: userRoleId, action: "revoke", changes: { revoked: [false, true] }, reason: why });
}

/** Users with their factory profile and active grants. Directory search first, so people without a factory profile yet are listed too. */
export async function listUsersWithGrants(tx: Tx, actor: AuthzActor, directory: UserDirectory, q: string) {
  await authorize(tx, actor, "core.role.manage");
  const users = await directory.search(q.trim().slice(0, 60), 100);
  const ids = users.map((u) => u.id);
  const profiles = (await tx.query("SELECT user_id, org_unit_id, (pin_hash IS NOT NULL) AS has_pin FROM core.user_profile WHERE user_id = ANY($1::int[])", [ids])).rows;
  const grants = (
    await tx.query(
      `SELECT ur.id, ur.user_id, ur.role_id, r.code AS role_code, r.name AS role_name, ur.scope_org_unit_id, o.name AS scope_name, ur.valid_to
         FROM core.user_role ur JOIN core.role r ON r.id = ur.role_id LEFT JOIN core.org_unit o ON o.id = ur.scope_org_unit_id
        WHERE ur.user_id = ANY($1::int[]) AND ur.revoked_at IS NULL ORDER BY r.code`,
      [ids]
    )
  ).rows;
  return users.map((u) => ({
    ...u,
    org_unit_id: profiles.find((p) => p.user_id === u.id)?.org_unit_id ?? null,
    has_pin: Boolean(profiles.find((p) => p.user_id === u.id)?.has_pin),
    grants: grants.filter((g) => g.user_id === u.id),
  }));
}

export async function setUserOrgUnit(tx: Tx, actor: AuthzActor, directory: UserDirectory, userId: number, orgUnitId: string | null) {
  await authorize(tx, actor, "core.role.manage");
  await ensureProfile(tx, directory, userId);
  const before = (await tx.query("SELECT org_unit_id FROM core.user_profile WHERE user_id = $1 FOR UPDATE", [userId])).rows[0];
  await tx.query("UPDATE core.user_profile SET org_unit_id = $2, version = version + 1, updated_at = now() WHERE user_id = $1", [userId, orgUnitId]);
  await writeAudit(tx, actor, { entityType: "user_profile", entityId: String(userId), action: "set_org_unit", changes: { org_unit_id: [before.org_unit_id, orgUnitId] } });
}

/**
 * Temporary delegation of a role the delegator holds (leave, business trip). A role manager can set it
 * up for anyone; a user can delegate their own role. The delegate never receives more than the delegator has.
 */
export async function createDelegation(tx: Tx, actor: AuthzActor, directory: UserDirectory, input: unknown) {
  const data = parseInput(delegationSchema, input);
  if (data.from_user_id !== actor.userId) await authorize(tx, actor, "core.role.manage");
  if (data.from_user_id === data.to_user_id) throw invalid("Không ủy quyền cho chính mình.");
  if (new Date(data.valid_to) <= new Date(data.valid_from)) throw invalid("Ngày kết thúc phải sau ngày bắt đầu.");
  if (new Date(data.valid_to).getTime() - new Date(data.valid_from).getTime() > 90 * 86_400_000) throw invalid("Ủy quyền tối đa 90 ngày.");
  const held = await tx.query("SELECT 1 FROM core.user_role WHERE user_id = $1 AND role_id = $2 AND revoked_at IS NULL", [data.from_user_id, data.role_id]);
  if (!held.rowCount) throw invalid("Người ủy quyền không giữ vai trò này.");
  await ensureProfile(tx, directory, data.to_user_id);
  const row = (
    await tx.query(
      "INSERT INTO core.delegation (from_user_id, to_user_id, role_id, valid_from, valid_to, reason, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *",
      [data.from_user_id, data.to_user_id, data.role_id, data.valid_from, data.valid_to, data.reason, actor.userId]
    )
  ).rows[0];
  await writeAudit(tx, actor, {
    entityType: "delegation",
    entityId: row.id,
    action: "create",
    changes: { from: [null, data.from_user_id], to: [null, data.to_user_id], role_id: [null, data.role_id], period: [null, `${data.valid_from} → ${data.valid_to}`] },
    reason: data.reason,
  });
  return row;
}

export async function revokeDelegation(tx: Tx, actor: AuthzActor, id: string) {
  const d = (await tx.query("SELECT from_user_id FROM core.delegation WHERE id = $1 AND revoked_at IS NULL FOR UPDATE", [id])).rows[0];
  if (!d) throw notFound("ủy quyền đang hiệu lực");
  if (d.from_user_id !== actor.userId) await authorize(tx, actor, "core.role.manage");
  await tx.query("UPDATE core.delegation SET revoked_at = now() WHERE id = $1", [id]);
  await writeAudit(tx, actor, { entityType: "delegation", entityId: id, action: "revoke", changes: { revoked: [false, true] } });
}

export async function listDelegations(tx: Tx, actor: AuthzActor) {
  return (
    await tx.query(
      `SELECT d.*, r.code AS role_code, r.name AS role_name, f.display_name AS from_name, t.display_name AS to_name
         FROM core.delegation d JOIN core.role r ON r.id = d.role_id
         JOIN core.user_profile f ON f.user_id = d.from_user_id JOIN core.user_profile t ON t.user_id = d.to_user_id
        WHERE d.revoked_at IS NULL AND d.valid_to > now() AND ($1 OR d.from_user_id = $2 OR d.to_user_id = $2)
        ORDER BY d.valid_from`,
      [await hasFactoryPermission(tx, actor, "core.role.manage"), actor.userId]
    )
  ).rows;
}

export const setPinSchema = z.object({ password: z.string().min(1, "nhập mật khẩu đăng nhập"), pin: z.string() });

/**
 * Sets or changes one's own signature PIN. The caller re-authenticates the user with the ABT Portal
 * password BEFORE the business transaction (see authenticateSigner), so failed attempts are counted.
 */
export async function setOwnPin(tx: Tx, actor: AuthzActor, pin: string) {
  await setPin(tx, actor.userId, pin);
  await writeAudit(tx, actor, { entityType: "user_profile", entityId: String(actor.userId), action: "set_pin" });
}

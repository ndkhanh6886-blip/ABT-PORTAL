import type { Tx } from "./db";

export interface NoticeInput {
  type: string;
  title: string;
  body?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  /** Deep link opened from the notice, e.g. /?tab=factory-warehouse&lot=<id> */
  link?: string | null;
  /** Dedupe key (e.g. outbox event id): the same event never notifies a user twice. */
  sourceKey?: string | null;
}

/** A matrix recipient group: holders of `permission` in the department `orgUnitCode` (any department when null). */
export interface NoticeGroup {
  permission: string;
  orgUnitCode?: string | null;
}

/** What the portal "Ma trận thông báo" says about a notice type: switched off, or extra recipient groups / people. */
export interface NoticeRule {
  enabled: boolean;
  /** Holders of these permissions in any department. */
  permissions: string[];
  /** Department groups (Phòng QA/QC, Phòng SX Kit…): holders of the permission inside that department only. */
  groups?: NoticeGroup[];
  userIds: number[];
  excludedUserIds?: number[];
}
export interface NoticePolicy {
  ruleFor(type: string): Promise<NoticeRule | null>;
}
let policy: NoticePolicy | null = null;
export function setNoticePolicy(p: NoticePolicy | null): void {
  policy = p;
}

/** Users holding `permission` through an active non-admin departmental role in any department. */
export async function usersWithPermissionAnywhere(tx: Tx, permission: string): Promise<number[]> {
  const res = await tx.query(
    `SELECT DISTINCT ur.user_id FROM core.user_role ur
       JOIN core.role r ON r.id = ur.role_id AND r.status = 'ACTIVE'
       JOIN core.role_permission rp ON rp.role_id = ur.role_id AND rp.permission_code = $1
       JOIN core.user_profile up ON up.user_id = ur.user_id AND up.status = 'ACTIVE'
      WHERE ur.revoked_at IS NULL AND ur.valid_from <= now() AND (ur.valid_to IS NULL OR ur.valid_to > now())
        AND (r.code <> 'admin' OR $1 LIKE '%.approve_bod')`,
    [permission]
  );
  return res.rows.map((r) => r.user_id);
}

/**
 * Users holding `permission` through an active non-admin role scoped inside the department `orgUnitCode`
 * (the department itself or one of its teams) or company-wide. Unknown department: holders anywhere.
 */
export async function usersWithPermissionInDept(tx: Tx, permission: string, orgUnitCode: string): Promise<number[]> {
  const dept = (await tx.query("SELECT id FROM core.org_unit WHERE code = $1 LIMIT 1", [orgUnitCode])).rows[0];
  if (!dept) return usersWithPermissionAnywhere(tx, permission);
  const res = await tx.query(
    `WITH RECURSIVE subtree AS (
       SELECT id FROM core.org_unit WHERE id = $2::uuid
       UNION ALL SELECT o.id FROM core.org_unit o JOIN subtree s ON o.parent_id = s.id
     ), ancestors AS (
       SELECT id, parent_id FROM core.org_unit WHERE id = $2::uuid
       UNION ALL SELECT o.id, o.parent_id FROM core.org_unit o JOIN ancestors a ON o.id = a.parent_id
     )
     SELECT DISTINCT ur.user_id FROM core.user_role ur
       JOIN core.role r ON r.id = ur.role_id AND r.status = 'ACTIVE'
       JOIN core.role_permission rp ON rp.role_id = ur.role_id AND rp.permission_code = $1
       JOIN core.user_profile up ON up.user_id = ur.user_id AND up.status = 'ACTIVE'
      WHERE ur.revoked_at IS NULL AND ur.valid_from <= now() AND (ur.valid_to IS NULL OR ur.valid_to > now())
        AND (r.code <> 'admin' OR $1 LIKE '%.approve_bod')
        AND (ur.scope_org_unit_id IS NULL
             OR ur.scope_org_unit_id IN (SELECT id FROM subtree)
             OR ur.scope_org_unit_id IN (SELECT id FROM ancestors))`,
    [permission, dept.id]
  );
  return res.rows.map((r) => r.user_id);
}

export async function notifyUsers(tx: Tx, userIds: number[], n: NoticeInput): Promise<number> {
  // the matrix never blocks the work itself: an unreadable policy falls back to the built-in recipients
  const rule = policy ? await policy.ruleFor(n.type).catch(() => null) : null;
  if (rule && !rule.enabled) return 0;
  const extra = rule
    ? [
        ...rule.userIds,
        ...(await Promise.all(rule.permissions.map((p) => usersWithPermissionAnywhere(tx, p)))).flat(),
        ...(
          await Promise.all(
            (rule.groups ?? []).map((g) =>
              g.orgUnitCode ? usersWithPermissionInDept(tx, g.permission, g.orgUnitCode) : usersWithPermissionAnywhere(tx, g.permission)
            )
          )
        ).flat(),
      ]
    : [];
  const excluded = new Set<number>(rule?.excludedUserIds ?? []);
  const ids = [...new Set([...userIds, ...extra].filter((id) => id > 0 && !excluded.has(id)))];
  if (!ids.length) return 0;
  const res = await tx.query(
    `INSERT INTO core.notification (user_id, type, title, body, entity_type, entity_id, link, source_key)
     SELECT unnest($1::int[]), $2, $3, $4, $5, $6, $7, $8
     ON CONFLICT (user_id, source_key) WHERE source_key IS NOT NULL DO NOTHING`,
    [ids, n.type, n.title, n.body ?? null, n.entityType ?? null, n.entityId ?? null, n.link ?? null, n.sourceKey ?? null]
  );
  return res.rowCount ?? 0;
}

/** Users who hold `permission` for `orgUnitId` (or company-wide) through an active non-admin departmental role. */
export async function usersWithPermission(tx: Tx, permission: string, orgUnitId: string | null): Promise<number[]> {
  const res = await tx.query(
    `WITH RECURSIVE ancestors AS (
       SELECT id, parent_id FROM core.org_unit WHERE id = $2::uuid
       UNION ALL SELECT o.id, o.parent_id FROM core.org_unit o JOIN ancestors a ON o.id = a.parent_id
     )
     SELECT DISTINCT ur.user_id FROM core.user_role ur
       JOIN core.role r ON r.id = ur.role_id AND r.status = 'ACTIVE'
       JOIN core.role_permission rp ON rp.role_id = ur.role_id AND rp.permission_code = $1
       JOIN core.user_profile up ON up.user_id = ur.user_id AND up.status = 'ACTIVE'
      WHERE ur.revoked_at IS NULL AND ur.valid_from <= now() AND (ur.valid_to IS NULL OR ur.valid_to > now())
        AND (r.code <> 'admin' OR $1 LIKE '%.approve_bod')
        AND (ur.scope_org_unit_id IS NULL OR ur.scope_org_unit_id IN (SELECT id FROM ancestors))`,
    [permission, orgUnitId]
  );
  return res.rows.map((r) => r.user_id);
}

export async function listNotifications(tx: Tx, userId: number, opts: { unreadOnly?: boolean; limit?: number } = {}) {
  const res = await tx.query(
    `SELECT n.*
       FROM core.notification n
       LEFT JOIN core.user_profile up ON up.user_id = n.user_id
       LEFT JOIN core.org_unit ou ON ou.id = up.org_unit_id
      WHERE n.user_id = $1
        ${opts.unreadOnly ? "AND n.read_at IS NULL" : ""}
        AND NOT (
          ou.code IS NOT NULL
          AND (
            (n.type LIKE 'KIT_%' AND ou.code NOT IN ('P-KIT', 'P-QA', 'P-KHO'))
            OR (n.type LIKE 'OLIGO_%' AND ou.code NOT IN ('P-OLIGO', 'P-QA', 'P-KHO'))
            OR (n.type LIKE 'SYNTHESIS_%' AND ou.code NOT IN ('P-OLIGO', 'P-QA', 'P-KHO'))
            OR (n.type LIKE 'DEVICE_%' AND ou.code NOT IN ('P-DEVICE', 'P-QA', 'P-KHO'))
          )
        )
      ORDER BY n.created_at DESC LIMIT $2`,
    [userId, Math.min(opts.limit ?? 50, 200)]
  );
  return res.rows;
}

export async function markRead(tx: Tx, userId: number, ids: string[]): Promise<void> {
  await tx.query("UPDATE core.notification SET read_at = now() WHERE user_id = $1 AND id = ANY($2::uuid[]) AND read_at IS NULL", [userId, ids]);
}

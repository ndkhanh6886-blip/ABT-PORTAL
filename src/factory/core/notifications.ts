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

/** What the portal "Ma trận thông báo" says about a notice type: switched off, or extra recipient groups / people. */
export interface NoticeRule {
  enabled: boolean;
  permissions: string[];
  userIds: number[];
}
export interface NoticePolicy {
  ruleFor(type: string): Promise<NoticeRule | null>;
}
let policy: NoticePolicy | null = null;
export function setNoticePolicy(p: NoticePolicy | null): void {
  policy = p;
}

/** Users holding `permission` through an active role in any department. */
export async function usersWithPermissionAnywhere(tx: Tx, permission: string): Promise<number[]> {
  const res = await tx.query(
    `SELECT DISTINCT ur.user_id FROM core.user_role ur
       JOIN core.role r ON r.id = ur.role_id AND r.status = 'ACTIVE'
       JOIN core.role_permission rp ON rp.role_id = ur.role_id AND rp.permission_code = $1
       JOIN core.user_profile up ON up.user_id = ur.user_id AND up.status = 'ACTIVE'
      WHERE ur.revoked_at IS NULL AND ur.valid_from <= now() AND (ur.valid_to IS NULL OR ur.valid_to > now())`,
    [permission]
  );
  return res.rows.map((r) => r.user_id);
}

export async function notifyUsers(tx: Tx, userIds: number[], n: NoticeInput): Promise<number> {
  // the matrix never blocks the work itself: an unreadable policy falls back to the built-in recipients
  const rule = policy ? await policy.ruleFor(n.type).catch(() => null) : null;
  if (rule && !rule.enabled) return 0;
  const extra = rule ? [...rule.userIds, ...(await Promise.all(rule.permissions.map((p) => usersWithPermissionAnywhere(tx, p)))).flat()] : [];
  const ids = [...new Set([...userIds, ...extra].filter((id) => id > 0))];
  if (!ids.length) return 0;
  const res = await tx.query(
    `INSERT INTO core.notification (user_id, type, title, body, entity_type, entity_id, link, source_key)
     SELECT unnest($1::int[]), $2, $3, $4, $5, $6, $7, $8
     ON CONFLICT (user_id, source_key) WHERE source_key IS NOT NULL DO NOTHING`,
    [ids, n.type, n.title, n.body ?? null, n.entityType ?? null, n.entityId ?? null, n.link ?? null, n.sourceKey ?? null]
  );
  return res.rowCount ?? 0;
}

/** Users who hold `permission` for `orgUnitId` (or company-wide) through an active role. */
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
        AND (ur.scope_org_unit_id IS NULL OR ur.scope_org_unit_id IN (SELECT id FROM ancestors))`,
    [permission, orgUnitId]
  );
  return res.rows.map((r) => r.user_id);
}

export async function listNotifications(tx: Tx, userId: number, opts: { unreadOnly?: boolean; limit?: number } = {}) {
  const res = await tx.query(
    `SELECT * FROM core.notification WHERE user_id = $1 ${opts.unreadOnly ? "AND read_at IS NULL" : ""}
      ORDER BY created_at DESC LIMIT $2`,
    [userId, Math.min(opts.limit ?? 50, 200)]
  );
  return res.rows;
}

export async function markRead(tx: Tx, userId: number, ids: string[]): Promise<void> {
  await tx.query("UPDATE core.notification SET read_at = now() WHERE user_id = $1 AND id = ANY($2::uuid[]) AND read_at IS NULL", [userId, ids]);
}

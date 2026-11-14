import { query } from "@/backend/db/db";
import { verifyPassword } from "@/backend/services/passwords";
import { canonicalDepartment } from "@/backend/services/permissions";
import type { PasswordVerifier } from "./core/signature";
import type { UserDirectory } from "./core/roles";
import { setHrPersonnelProvider } from "./core/hrDirectory";
import { setKdGateway } from "./intake/gateway";
import { applyFactoryEvent } from "@/backend/services/factoryBridge";
import { setNoticePolicy } from "./core/notifications";
import { factoryNoticeKey, TECHNICAL_MATRIX_ROLES } from "./noticeMatrix";

/**
 * The only place the factory reads ABT Portal accounts (shared login, Q3). Kept behind small
 * interfaces so the factory services never query `abt_portal` themselves and tests can fake them.
 */
export const portalDirectory: UserDirectory = {
  async search(q, limit) {
    const res = await query(
      `SELECT id, username, full_name, department, is_active, role FROM users
        WHERE role <> 'customer' AND ($1 = '' OR username ILIKE '%' || $1 || '%' OR full_name ILIKE '%' || $1 || '%' OR department ILIKE '%' || $1 || '%')
        ORDER BY is_active DESC, full_name LIMIT $2`,
      [q, limit]
    );
    return res.rows.map((r: any) => ({ id: Number(r.id), username: r.username, full_name: r.full_name, department: r.department, is_active: r.is_active !== false, role: r.role }));
  },
  async get(id) {
    const r = (await query("SELECT id, username, full_name, department, is_active FROM users WHERE id = $1 AND role <> 'customer'", [id])).rows[0];
    return r ? { id: Number(r.id), username: r.username, full_name: r.full_name, department: r.department, is_active: r.is_active !== false } : null;
  },
};

export const verifyPortalPassword: PasswordVerifier = async (userId, password) => {
  const r = (await query("SELECT password_hash, is_active FROM users WHERE id = $1", [userId])).rows[0];
  return Boolean(r && r.is_active !== false && verifyPassword(password, r.password_hash));
};

setHrPersonnelProvider(async () => {
  const res = await query(
    `SELECT p.employee_code, p.full_name, p.department, p.position, p.email, u.id AS user_id
       FROM personnel p
       LEFT JOIN users u ON LOWER(u.username) = LOWER(p.employee_code)
                         OR LOWER(u.username) = LOWER(REPLACE(REPLACE(p.employee_code, 'NV-ABT-', 'ABT'), 'NV-VIA-', 'VIA'))
      WHERE p.employee_code IS NOT NULL AND p.employee_code <> ''
        AND (p.status IS NULL OR p.status <> 'INACTIVE')
      ORDER BY p.employee_code ASC`
  );
  return res.rows.map((r: any) => ({
    user_id: r.user_id != null ? Number(r.user_id) : null,
    employee_code: String(r.employee_code || "").trim(),
    full_name: String(r.full_name || "").trim(),
    department: String(r.department || "").trim(),
    canonical_dept: canonicalDepartment(r.department) ?? null,
    position: String(r.position || "").trim(),
    email: String(r.email || "").trim().toLowerCase(),
  }));
});

// Factory → Kinh doanh events are applied by the Kinh doanh bridge (its own transaction and inbox).
setKdGateway({ deliver: (event) => applyFactoryEvent(event) });

// Factory notices follow the portal "Ma trận thông báo" (Khối Kỹ thuật events): read at most every 30 s.
let matrixCache: { at: number; data: Record<string, any> } | null = null;
setNoticePolicy({
  async ruleFor(type) {
    if (!matrixCache || Date.now() - matrixCache.at > 30_000) {
      const data = (await query("SELECT data FROM app_storage WHERE key = 'system_notification_matrix'")).rows[0]?.data;
      matrixCache = { at: Date.now(), data: data && typeof data === "object" ? data : {} };
    }
    const ev = matrixCache.data[factoryNoticeKey(type)];
    if (!ev) return null;
    const roles: string[] = Array.isArray(ev.targetRoles) ? ev.targetRoles : [];
    const names: string[] = Array.isArray(ev.targetEmployeeNames) ? ev.targetEmployeeNames : [];
    const userIds = roles.includes("admin") || names.length
      ? (
          await query(
            "SELECT id FROM users WHERE is_active IS NOT FALSE AND role <> 'customer' AND (($1 AND role = 'admin') OR full_name = ANY($2::text[]))",
            [roles.includes("admin"), names]
          )
        ).rows.map((r: any) => Number(r.id))
      : [];
    return {
      enabled: ev.enabled !== false,
      permissions: TECHNICAL_MATRIX_ROLES.filter((r) => roles.includes(r.code)).map((r) => r.permission),
      userIds,
    };
  },
});

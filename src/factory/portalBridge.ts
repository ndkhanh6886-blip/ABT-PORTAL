import { query } from "@/backend/db/db";
import { verifyPassword } from "@/backend/services/passwords";
import type { PasswordVerifier } from "./core/signature";
import type { UserDirectory } from "./core/roles";

/**
 * The only place the factory reads ABT Portal accounts (shared login, Q3). Kept behind small
 * interfaces so the factory services never query `abt_portal` themselves and tests can fake them.
 */
export const portalDirectory: UserDirectory = {
  async search(q, limit) {
    const res = await query(
      `SELECT id, username, full_name, department, is_active FROM users
        WHERE role <> 'customer' AND ($1 = '' OR username ILIKE '%' || $1 || '%' OR full_name ILIKE '%' || $1 || '%' OR department ILIKE '%' || $1 || '%')
        ORDER BY is_active DESC, full_name LIMIT $2`,
      [q, limit]
    );
    return res.rows.map((r: any) => ({ id: Number(r.id), username: r.username, full_name: r.full_name, department: r.department, is_active: r.is_active !== false }));
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

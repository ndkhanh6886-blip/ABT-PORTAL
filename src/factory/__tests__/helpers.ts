import { loadEnv } from "../../../scripts/lib/loadEnv";

loadEnv();
process.env.FACTORY_PGDATABASE = "abt_factory_test";

import { getFactoryPool, withTransaction, type Tx } from "../core/db";
import type { AuthzActor } from "../core/authz";
import "./fixtures/permissions";

let nextUserId = 900_000 + Math.floor(Math.random() * 50_000);

/** Creates a factory user profile with a fresh id (ids never clash between tests). */
export async function createUser(name = "Người dùng thử", pin?: string): Promise<AuthzActor> {
  const userId = nextUserId++;
  await getFactoryPool().query("INSERT INTO core.user_profile (user_id, display_name) VALUES ($1, $2)", [userId, name]);
  if (pin) {
    const { setPin } = await import("../core/signature");
    await withTransaction((tx) => setPin(tx, userId, pin));
  }
  return { userId, name };
}

export async function createOrgUnit(code: string, parentId: string | null = null): Promise<string> {
  const res = await getFactoryPool().query(
    "INSERT INTO core.org_unit (code, name, unit_type, parent_id) VALUES ($1, $1, $2, $3) RETURNING id",
    [`${code}-${Math.random().toString(36).slice(2, 8)}`, parentId ? "TEAM" : "DEPARTMENT", parentId]
  );
  return res.rows[0].id;
}

/** Creates a role holding `permissions` and grants it to the user, optionally scoped to an org unit. */
export async function grant(user: AuthzActor, permissions: string[], scopeOrgUnitId: string | null = null): Promise<void> {
  await withTransaction(async (tx: Tx) => {
    const role = await tx.query("INSERT INTO core.role (code, name) VALUES ($1, $1) RETURNING id", [
      `R_${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
    ]);
    for (const p of permissions) {
      await tx.query("INSERT INTO core.role_permission (role_id, permission_code) VALUES ($1, $2)", [role.rows[0].id, p]);
    }
    await tx.query("INSERT INTO core.user_role (user_id, role_id, scope_org_unit_id) VALUES ($1, $2, $3)", [
      user.userId,
      role.rows[0].id,
      scopeOrgUnitId,
    ]);
  });
}

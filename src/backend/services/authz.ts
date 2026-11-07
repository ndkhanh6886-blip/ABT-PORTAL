import { NextResponse } from "next/server";
import { query, setAuditActorContext } from "@/backend/db/db";
import { getSessionFromRequest, SessionUser } from "@/backend/services/session";
import { hasPermission } from "@/backend/services/permissions";

export type AuthorizedUser = SessionUser & { permissions: Record<string, boolean> };

/**
 * Loads the signed-in user with fresh role/permissions from the database. Returns null when not
 * signed in, deactivated, the session was revoked (session_version changed after a password change /
 * reset / lock) or the password must be changed first.
 */
export async function getAuthorizedUser(req: Request, opts: { allowPasswordChangePending?: boolean } = {}): Promise<AuthorizedUser | null> {
  const session = await getSessionFromRequest(req);
  if (!session || session.role === "customer") return null;
  if (session.mcp && !opts.allowPasswordChangePending) return null;
  try {
    const res = await query(
      "SELECT id, username, full_name, role, department, is_active, permissions, COALESCE(session_version, 0) AS session_version FROM users WHERE id = $1",
      [session.id || 0]
    );
    const row = res.rows[0];
    if (!row || row.is_active === false) return null;
    if (Number(row.session_version) !== Number(session.sv || 0)) return null;
    let perms = row.permissions;
    if (typeof perms === "string") {
      try { perms = JSON.parse(perms); } catch { perms = {}; }
    }
    const mergedPerms: Record<string, boolean> = perms && typeof perms === "object" ? { ...perms } : {};

    // Đồng bộ hợp nhất quyền từ các bản ghi tài khoản cùng nhân sự (VD: NV-TBR-016 / NV-TBRs-006 / NV-ABT-001 vs TBR016 hoặc trùng Họ tên)
    if (row.full_name || row.username) {
      const aliasRes = await query(
        `SELECT permissions FROM users
         WHERE id != $1
           AND permissions IS NOT NULL
           AND (
             ($2 <> '' AND LOWER(TRIM(full_name)) = LOWER(TRIM($2)))
             OR ($3 <> '' AND (
               LOWER(username) = LOWER(REGEXP_REPLACE($3, '^NV-(TBRS|TBR|VIA|ABT)-?', '\\1', 'i'))
               OR LOWER(username) = LOWER(REGEXP_REPLACE($3, '^(TBRS|TBR|VIA|ABT)-?([0-9]+)$', 'NV-\\1-\\2', 'i'))
             ))
           )`,
        [row.id, String(row.full_name || ""), String(row.username || "")]
      ).catch(() => ({ rows: [] as any[] }));
      for (const aRow of aliasRes.rows) {
        let aPerms = aRow.permissions;
        if (typeof aPerms === "string") {
          try { aPerms = JSON.parse(aPerms); } catch { aPerms = {}; }
        }
        if (aPerms && typeof aPerms === "object") {
          for (const [k, v] of Object.entries(aPerms)) {
            if (v === true) mergedPerms[k] = true;
          }
        }
      }
    }

    return {
      ...session,
      id: row.id,
      username: row.username,
      full_name: row.full_name || session.full_name,
      role: row.role || "",
      department: row.department || "",
      permissions: mergedPerms,
    };
  } catch {
    return null;
  }
}

/** Request-scoped actor for the audit log (see logAudit in db.ts). Call right after authorising a request. */
export function setAuditActor(user: { username: string; full_name?: string } | null) {
  if (user) setAuditActorContext({ username: user.username, fullName: user.full_name || user.username });
}

export function unauthorizedResponse() {
  return NextResponse.json({ error: "Phiên đăng nhập không hợp lệ hoặc đã hết hạn. Vui lòng đăng nhập lại.", unauthorized: true }, { status: 401 });
}

export function forbiddenResponse(message = "Bạn không có quyền thực hiện thao tác này.") {
  return NextResponse.json({ error: message }, { status: 403 });
}

export function isAdminUser(user: AuthorizedUser | null): boolean {
  return Boolean(user && hasPermission(user, "settings.view"));
}

/**
 * Kế toán (or an administrator): may record / void customer and supplier payments, unblock credit,
 * change payment / invoice status. Decided by the role set by an administrator, never by the free-text
 * department name ("kế toán" in a department label used to be enough).
 */
export function isAccountantUser(user: AuthorizedUser | null): boolean {
  if (!user) return false;
  if (isAdminUser(user)) return true;
  const role = String(user.role || "").toLowerCase();
  return role.includes("accountant") || role.includes("kế toán");
}

/**
 * Returns `{ user }` when the request is signed in and holds `permissionKey`, otherwise `{ response }` (401/403).
 * Usage: `const auth = await requirePermission(req, "settings.view"); if ("response" in auth) return auth.response;`
 */
export async function requirePermission(req: Request, permissionKey: string): Promise<{ user: AuthorizedUser } | { response: NextResponse }> {
  const user = await getAuthorizedUser(req);
  if (!user) return { response: unauthorizedResponse() };
  if (!hasPermission(user, permissionKey)) return { response: forbiddenResponse() };
  return { user };
}

export async function requireUser(req: Request): Promise<{ user: AuthorizedUser } | { response: NextResponse }> {
  const user = await getAuthorizedUser(req);
  if (!user) return { response: unauthorizedResponse() };
  return { user };
}

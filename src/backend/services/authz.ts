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

    // Hợp nhất quyền từ tài khoản cùng MÃ NHÂN VIÊN (VD: NV-TBR-016 <-> TBR016) do Quản trị viên tạo.
    // Không còn so theo Họ tên: hai người trùng tên (hoặc ai đổi được họ tên thành tên Giám đốc) từng được
    // cộng toàn bộ quyền của người kia.
    if (row.username) {
      const aliasRes = await query(
        `SELECT permissions FROM users
         WHERE id != $1
           AND permissions IS NOT NULL
           AND COALESCE(is_active, true) = true
           AND $2 <> ''
           AND (
             LOWER(username) = LOWER(REGEXP_REPLACE($2, '^NV-(TBRS|TBR|VIA|ABT)-?', '\\1', 'i'))
             OR LOWER(username) = LOWER(REGEXP_REPLACE($2, '^(TBRS|TBR|VIA|ABT)-?([0-9]+)$', 'NV-\\1-\\2', 'i'))
           )`,
        [row.id, String(row.username || "")]
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
 * change payment / invoice status. Decided by role, permission, or the department assigned to the account
 * by an administrator (users.department — not editable by the user).
 */
export function isAccountantUser(user: AuthorizedUser | null): boolean {
  if (!user) return false;
  if (isAdminUser(user)) return true;
  const role = String(user.role || "").toLowerCase();
  const dept = String(user.department || "").toLowerCase();
  if (role.includes("accountant") || role.includes("kế toán") || dept.includes("kế toán") || dept.includes("account") || dept.includes("tài chính")) {
    return true;
  }
  return hasPermission(user, "sales.approve_orders");
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

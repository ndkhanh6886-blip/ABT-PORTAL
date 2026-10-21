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
    return {
      ...session,
      id: row.id,
      username: row.username,
      full_name: row.full_name || session.full_name,
      role: row.role || "",
      department: row.department || "",
      permissions: perms && typeof perms === "object" ? perms : {},
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

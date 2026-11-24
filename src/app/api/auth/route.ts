import { NextRequest, NextResponse } from "next/server";
import { apiErrorResponse } from "@/backend/services/apiErrors";
import { query, logAudit } from "@/backend/db/db";
import { hashPassword, verifyPassword, needsRehash } from "@/backend/services/passwords";
import { createSessionToken, getSessionFromRequest, SESSION_COOKIE, sessionCookieOptions } from "@/backend/services/session";
import { getAuthorizedUser, isAdminUser, unauthorizedResponse, forbiddenResponse, setAuditActor } from "@/backend/services/authz";
import { clientIp, hitRateLimit, isRateLimited, isSharedIp } from "@/backend/services/rateLimit";
import { describeUserAgent } from "@/backend/services/userAgent";

const USER_LOOKUP_WHERE = `
  LOWER(username) = LOWER($1)
  OR LOWER(COALESCE(login_name, '')) = LOWER($1)
  OR LOWER(username) = LOWER(REPLACE(REPLACE($1, 'NV-ABT-', 'ABT'), 'NV-VIA-', 'VIA'))
  OR LOWER(username) = LOWER(REPLACE(REPLACE($1, 'NV-ABT', 'ABT'), 'NV-VIA', 'VIA'))
  OR LOWER(email) = LOWER($1)
  OR LOWER(full_name) = LOWER($1)`;

// Exact username/email matches first so a shared full name can never shadow another account
const USER_LOOKUP_ORDER = `ORDER BY (LOWER(username) = LOWER($1)) DESC, (LOWER(COALESCE(login_name, '')) = LOWER($1)) DESC, (LOWER(email) = LOWER($1)) DESC, id ASC`;

/** Initial / well-known passwords: accepted once, then the user must choose a new one. */
const DEFAULT_PASSWORDS = new Set(["123456", "password123", "12345678", "admin", "admin123", "123456789"]);
const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;
const IP_FAILURE_LIMIT = 30; // failed logins per IP and window
const IP_WINDOW_MS = 15 * 60 * 1000;

function parsePermissions(perms: any) {
  if (typeof perms === "string") {
    try { return JSON.parse(perms); } catch { return {}; }
  }
  return perms && typeof perms === "object" ? perms : {};
}

function weakPasswordReason(pw: string, username: string): string | null {
  if (pw.length < 8) return "Mật khẩu mới phải có tối thiểu 8 ký tự";
  if (DEFAULT_PASSWORDS.has(pw) || /^(\d)\1+$/.test(pw) || /^(0123456789|123456789|12345678)$/.test(pw)) return "Mật khẩu mới quá dễ đoán, vui lòng chọn mật khẩu khác";
  if (username && pw.toLowerCase().includes(username.toLowerCase())) return "Mật khẩu mới không được chứa tên đăng nhập";
  return null;
}

async function issueSession(req: NextRequest, user: any, response: NextResponse) {
  const token = await createSessionToken({
    id: user.id,
    username: user.username,
    role: user.role,
    department: user.department,
    full_name: user.full_name,
    sv: Number(user.session_version) || 0,
    mcp: Boolean(user.must_change_password),
  });
  response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(req));
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const action = searchParams.get("action");
    const me = await getAuthorizedUser(req, { allowPasswordChangePending: true });
    setAuditActor(me);
    if (!me) return unauthorizedResponse();

    const fetchUser = async (where: string, params: any[]) => {
      const res = await query(
        `SELECT id, username, full_name, role, department, email, avatar, is_active, permissions,
                COALESCE(must_change_password, false) AS must_change_password,
                COALESCE(session_version, 0) AS session_version
           FROM users WHERE ${where} LIMIT 1`,
        params
      );
      return res.rows[0] ? { ...res.rows[0], permissions: parsePermissions(res.rows[0].permissions) } : null;
    };

    // Current session (used by the client to validate a restored login):
    // Tự động làm mới thời hạn phiên (sliding session 7 ngày) mỗi khi người dùng mở ứng dụng
    if (action === "session" || !searchParams.get("username")) {
      const user = await fetchUser("id = $1", [me.id]);
      if (!user || user.is_active === false) return unauthorizedResponse();
      const sessionVersion = user.session_version;
      delete user.session_version;
      user.permissions = { ...(user.permissions || {}), ...(me.permissions || {}) };
      const response = NextResponse.json({ user });
      await issueSession(req, { ...user, session_version: sessionVersion }, response);
      return response;
    }

    // Looking up another account is reserved to administrators
    if (me.mcp) return forbiddenResponse("Bạn cần đổi mật khẩu mặc định trước.");
    const username = String(searchParams.get("username") || "").trim();
    const isSelf = [me.username.toLowerCase(), String(me.full_name || "").toLowerCase()].includes(username.toLowerCase());
    if (!isSelf && !isAdminUser(me)) return forbiddenResponse();
    const user = isSelf ? await fetchUser("id = $1", [me.id]) : await fetchUser(`(${USER_LOOKUP_WHERE}) ${USER_LOOKUP_ORDER}`, [username]);
    if (!user) return NextResponse.json({ error: "Người dùng không tồn tại" }, { status: 404 });
    delete user.session_version;
    return NextResponse.json({ user });
  } catch (error: any) {
    return apiErrorResponse(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { action, username, password, currentPassword, newPassword, status } = body || {};
    const ip = clientIp(req);
    // Thiết bị / trình duyệt của lần đăng nhập, đổi mật khẩu: phân biệt các máy, phát hiện công cụ tự động trong nhật ký
    const userAgent = req.headers.get("user-agent") || "";
    const device = describeUserAgent(userAgent);
    // IP dùng chung (loopback sau tunnel / không rõ): không khóa theo IP, chỉ khóa theo tài khoản
    const ipKey = isSharedIp(ip) ? `login-fail:shared:${String(username || "").toLowerCase()}:${ip}` : `login-fail:${ip}`;

    // Heartbeat / presence: only for the signed-in user, never for an arbitrary account named in the body
    if (action === "heartbeat" || action === "presence") {
      const me = await getAuthorizedUser(req, { allowPasswordChangePending: true });
      if (!me || me.role === "customer") return NextResponse.json({ success: false }, { status: 401 });
      const timeExpr = status === "offline" ? "NOW() - INTERVAL '1 hour'" : "NOW()";
      await query(`UPDATE users SET last_seen_at = ${timeExpr} WHERE id = $1`, [me.id]).catch(() => {});
      const response = NextResponse.json({
        success: true,
        timestamp: new Date().toISOString(),
        role: me.role,
        department: me.department,
        permissions: me.permissions || {}
      });
      if (status !== "offline") {
        await issueSession(
          req,
          {
            id: me.id,
            username: me.username,
            role: me.role,
            department: me.department,
            full_name: me.full_name,
            session_version: me.sv,
            must_change_password: me.mcp,
          },
          response
        );
      }
      return response;
    }

    if (action === "logout") {
      const res = NextResponse.json({ success: true });
      res.cookies.set(SESSION_COOKIE, "", { ...sessionCookieOptions(req), maxAge: 0 });
      return res;
    }

    if (isRateLimited(ipKey, IP_FAILURE_LIMIT)) {
      return NextResponse.json({ error: "Quá nhiều lần đăng nhập sai từ thiết bị này. Vui lòng thử lại sau ít phút." }, { status: 429 });
    }

    if (action === "change_password") {
      // Only the signed-in user changes their own password. Changing it with "username + current password"
      // without a session let anyone who knew an employee code and the initial password take the account over.
      const me = await getAuthorizedUser(req, { allowPasswordChangePending: true });
      setAuditActor(me);
      if (!me) return unauthorizedResponse();
      if (!currentPassword || !newPassword) {
        return NextResponse.json({ error: "Vui lòng nhập đầy đủ mật khẩu hiện tại và mật khẩu mới" }, { status: 400 });
      }
      const res = await query(
        "SELECT id, username, password_hash, full_name, role, department, locked_until, COALESCE(session_version, 0) AS session_version FROM users WHERE id = $1",
        [me.id]
      );
      const user = res.rows[0];
      if (!user) {
        hitRateLimit(ipKey, IP_FAILURE_LIMIT, IP_WINDOW_MS);
        return NextResponse.json({ error: "Tài khoản hoặc mật khẩu hiện tại không đúng" }, { status: 400 });
      }
      if (user.locked_until && new Date(user.locked_until) > new Date()) {
        return NextResponse.json({ error: "Tài khoản đang tạm khóa do nhập sai nhiều lần. Vui lòng thử lại sau." }, { status: 429 });
      }
      if (!verifyPassword(String(currentPassword), user.password_hash) && !verifyPassword(String(currentPassword).trim(), user.password_hash)) {
        hitRateLimit(ipKey, IP_FAILURE_LIMIT, IP_WINDOW_MS);
        await query(
          `UPDATE users SET failed_login_count = failed_login_count + 1,
                  locked_until = CASE WHEN failed_login_count + 1 >= $2 THEN NOW() + ($3 || ' minutes')::interval ELSE locked_until END
            WHERE id = $1`,
          [user.id, MAX_FAILED_LOGINS, String(LOCK_MINUTES)]
        );
        return NextResponse.json({ error: "Tài khoản hoặc mật khẩu hiện tại không đúng" }, { status: 400 });
      }
      const weak = weakPasswordReason(String(newPassword), user.username);
      if (weak) return NextResponse.json({ error: weak }, { status: 400 });
      if (String(newPassword) === String(currentPassword)) {
        return NextResponse.json({ error: "Mật khẩu mới phải khác mật khẩu hiện tại" }, { status: 400 });
      }
      const newHash = hashPassword(String(newPassword));
      // New password + revoke every other session of this account
      const upd = await query(
        `UPDATE users SET password_hash = $1, must_change_password = false, failed_login_count = 0, locked_until = NULL,
                session_version = COALESCE(session_version, 0) + 1
          WHERE id = $2 RETURNING id, username, full_name, role, department, session_version, must_change_password`,
        [newHash, user.id]
      );
      // Đồng bộ mật khẩu mới sang các bản ghi tài khoản alias cùng mã nhân viên / họ tên (VD: NV-TBR-016 <-> TBR016)
      await query(
        `UPDATE users
            SET password_hash = $1,
                must_change_password = false,
                failed_login_count = 0,
                locked_until = NULL
          WHERE id != $2
            AND (
              ($3 <> '' AND (
                LOWER(username) = LOWER(REGEXP_REPLACE($3, '^NV-(TBRS|TBR|VIA|ABT)-?', '\\1', 'i'))
                OR LOWER(username) = LOWER(REGEXP_REPLACE($3, '^(TBRS|TBR|VIA|ABT)-?([0-9]+)$', 'NV-\\1-\\2', 'i'))
              ))
              OR ($4 <> '' AND LOWER(TRIM(full_name)) = LOWER(TRIM($4)))
            )`,
        [newHash, user.id, String(user.username || ""), String(user.full_name || "")]
      ).catch(() => {});
      await logAudit("CHANGE_PASSWORD", "AUTH", `Người dùng ${user.full_name} (${user.username}) đã đổi mật khẩu thành công (IP ${ip} · ${device})`, user.username, user.full_name, ip, userAgent);
      const response = NextResponse.json({ success: true, message: "Đổi mật khẩu thành công" });
      await issueSession(req, upd.rows[0], response);
      return response;
    }

    // Đăng nhập chuẩn
    if (!username || !password) {
      return NextResponse.json({ error: "Vui lòng nhập tên đăng nhập và mật khẩu" }, { status: 400 });
    }

    const loginName = String(username).trim();
    const rawPass = String(password);
    const trimmedPass = rawPass.trim();
    const res = await query(
      `SELECT id, username, password_hash, full_name, role, department, email, avatar, is_active, permissions,
              locked_until, COALESCE(must_change_password, false) AS must_change_password, COALESCE(session_version, 0) AS session_version
       FROM users WHERE ${USER_LOOKUP_WHERE} ${USER_LOOKUP_ORDER} LIMIT 10`,
      [loginName]
    );

    const candidates: any[] = res.rows || [];
    // Kiểm tra mật khẩu trên tất cả bản ghi khớp (tránh trường hợp có 2 dòng NV-TBR-016 và TBR016 mà LIMIT 1 lấy nhầm dòng chưa đổi mật khẩu)
    let matchedPass = rawPass;
    let user = candidates.find((c) => {
      if (verifyPassword(rawPass, c.password_hash)) {
        matchedPass = rawPass;
        return true;
      }
      if (trimmedPass !== rawPass && verifyPassword(trimmedPass, c.password_hash)) {
        matchedPass = trimmedPass;
        return true;
      }
      return false;
    });
    const primaryCandidate = user || candidates[0];

    if (primaryCandidate?.locked_until && new Date(primaryCandidate.locked_until) > new Date()) {
      const mins = Math.max(1, Math.ceil((new Date(primaryCandidate.locked_until).getTime() - Date.now()) / 60000));
      return NextResponse.json({ error: `Tài khoản tạm khóa do nhập sai mật khẩu ${MAX_FAILED_LOGINS} lần. Vui lòng thử lại sau ${mins} phút hoặc liên hệ Quản trị viên.` }, { status: 429 });
    }

    if (!user) {
      hitRateLimit(ipKey, IP_FAILURE_LIMIT, IP_WINDOW_MS);
      if (primaryCandidate) {
        const upd = await query(
          `UPDATE users SET failed_login_count = failed_login_count + 1,
                  locked_until = CASE WHEN failed_login_count + 1 >= $2 THEN NOW() + ($3 || ' minutes')::interval ELSE locked_until END
            WHERE id = $1 RETURNING failed_login_count`,
          [primaryCandidate.id, MAX_FAILED_LOGINS, String(LOCK_MINUTES)]
        );
        if (Number(upd.rows[0]?.failed_login_count) >= MAX_FAILED_LOGINS) {
          await query("UPDATE users SET failed_login_count = 0 WHERE id = $1", [primaryCandidate.id]);
          await logAudit("ACCOUNT_LOCKED", "AUTH", `Tạm khóa ${LOCK_MINUTES} phút tài khoản ${primaryCandidate.username} sau ${MAX_FAILED_LOGINS} lần sai mật khẩu (IP ${ip})`, primaryCandidate.username, primaryCandidate.full_name);
        }
      }
      await logAudit("LOGIN_FAILED", "AUTH", `Đăng nhập thất bại cho tài khoản ${loginName} (IP ${ip} · ${device})`, loginName, "Chưa xác thực", ip, userAgent);
      return NextResponse.json({ error: "Tài khoản hoặc mật khẩu không chính xác" }, { status: 401 });
    }

    if (user.is_active === false) {
      return NextResponse.json(
        { error: "Tài khoản của bạn đã bị tạm khóa. Vui lòng liên hệ Quản trị viên hệ thống." },
        { status: 403 }
      );
    }

    // Mật khẩu mặc định / dễ đoán: được vào một lần để đổi mật khẩu, mọi API khác bị chặn cho tới khi đổi
    const mustChange = Boolean(user.must_change_password) || DEFAULT_PASSWORDS.has(matchedPass);
    const syncedHash = needsRehash(user.password_hash) ? hashPassword(matchedPass) : user.password_hash;
    await query(
      `UPDATE users SET last_seen_at = NOW(), failed_login_count = 0, locked_until = NULL, must_change_password = $2
         ${needsRehash(user.password_hash) ? ", password_hash = $3" : ""}
        WHERE id = $1`,
      needsRehash(user.password_hash) ? [user.id, mustChange, syncedHash] : [user.id, mustChange]
    );
    // Nếu có các bản ghi tài khoản trùng của cùng nhân sự (VD: NV-TBR-016 và TBR016), tự động đồng bộ mật khẩu đúng sang các bản ghi đó
    if (candidates.length > 1) {
      const otherIds = candidates.filter((c) => c.id !== user.id).map((c) => c.id);
      if (otherIds.length > 0) {
        await query(
          `UPDATE users SET password_hash = $1, must_change_password = $2, failed_login_count = 0, locked_until = NULL WHERE id = ANY($3::int[])`,
          [syncedHash, mustChange, otherIds]
        ).catch(() => {});
      }
    }

    delete user.password_hash;
    delete user.locked_until;
    user.permissions = parsePermissions(user.permissions);
    user.last_seen_at = new Date().toISOString();
    user.must_change_password = mustChange;
    await logAudit("LOGIN", "AUTH", `Người dùng ${user.full_name} (${user.username}) đăng nhập hệ thống thành công (IP ${ip} · ${device})`, user.username, user.full_name, ip, userAgent);

    const sessionVersion = user.session_version;
    delete user.session_version;
    const response = NextResponse.json({ success: true, user, must_change_password: mustChange });
    await issueSession(req, { ...user, session_version: sessionVersion }, response);
    return response;
  } catch (error: any) {
    return apiErrorResponse(error);
  }
}

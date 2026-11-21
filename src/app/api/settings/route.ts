import { NextRequest, NextResponse } from "next/server";
import { apiErrorResponse } from "@/backend/services/apiErrors";
import { query, logAudit, ensurePersonnelTable, withTransaction } from "@/backend/db/db";
import { syncPersonnelToZaloBindings } from "@/backend/db/zaloDb";
import { hashPassword, verifyPassword, generateTemporaryPassword } from "@/backend/services/passwords";
import { getAuthorizedUser, isAdminUser, unauthorizedResponse, forbiddenResponse, setAuditActor } from "@/backend/services/authz";
import { canonicalDepartment, inferSystemRoleFromPosition } from "@/backend/services/permissions";
import { setImportedLoginName } from "@/backend/services/accountImport";
import { employeeCodeVariants, normalizePersonText, personNameKey } from "@/backend/services/utils";
import { ensureFactoryRolesAndSyncAllUsers, syncSinglePortalUserToFactory } from "@/factory/orgSync";
import { invalidateHrPersonnelCache } from "@/factory/core/hrDirectory";
import { getFactoryPool } from "@/factory/core/db";

// Mật khẩu khởi tạo cho tài khoản mới (được băm scrypt khi lưu; người dùng nên đổi ngay sau lần đăng nhập đầu)
/** Tài khoản vừa tạo kèm mật khẩu tạm (chỉ trả về một lần cho Quản trị viên để giao cho nhân viên). */
type InitialCredential = { username: string; full_name: string; password: string };

/**
 * Mỗi tài khoản mới nhận mật khẩu tạm ngẫu nhiên riêng và phải đổi ở lần đăng nhập đầu.
 * (Trước đây mọi tài khoản dùng chung "123456": ai biết mã nhân viên cũng đăng nhập / chiếm được tài khoản.)
 */
async function assignTemporaryPassword(username: string, fullName: string): Promise<InitialCredential> {
  const password = generateTemporaryPassword();
  await query("UPDATE users SET password_hash = $1, must_change_password = true WHERE username = $2", [hashPassword(password), username]);
  return { username, full_name: fullName, password };
}

/** Hash of a random secret nobody knows: placeholder until assignTemporaryPassword runs. */
function unusablePasswordHash(): string {
  return hashPassword(generateTemporaryPassword(32));
}

/** Checks whether two department labels belong to the same canonical department (fallback: normalized text). */
function isSameDepartment(a?: string | null, b?: string | null): boolean {
  const ca = canonicalDepartment(a);
  const cb = canonicalDepartment(b);
  if (ca && cb) return ca === cb;
  const na = normalizePersonText(a).toLowerCase();
  const nb = normalizePersonText(b).toLowerCase();
  return Boolean(na && nb && na === nb);
}

/** Chuẩn hóa ngày tháng năm sinh về định dạng YYYY-MM-DD (hỗ trợ YYYY-MM-DD, DD/MM/YYYY, DD-MM-YYYY và số serial ngày Excel). */
function parsePersonnelBirthDate(raw: any): string | null {
  if (raw === null || raw === undefined || raw === "") return null;
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    return raw.toISOString().slice(0, 10);
  }
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 1000 && raw < 80000) {
    // Excel serial date (days since 1899-12-30)
    const utcMs = Math.round((raw - 25569) * 86400 * 1000);
    const d = new Date(utcMs);
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  const s = String(raw).trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) {
    const yyyy = Number(m[1]);
    const mm = Number(m[2]);
    const dd = Number(m[3]);
    if (yyyy >= 1930 && yyyy <= 2100 && mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
      return `${String(yyyy).padStart(4, "0")}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
    }
  }
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (m) {
    const dd = Number(m[1]);
    const mm = Number(m[2]);
    const yyyy = Number(m[3]);
    if (yyyy >= 1930 && yyyy <= 2100 && mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
      return `${String(yyyy).padStart(4, "0")}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
    }
  }
  if (/^\d{4,5}$/.test(s)) {
    const serial = Number(s);
    if (serial > 1000 && serial < 80000) {
      const utcMs = Math.round((serial - 25569) * 86400 * 1000);
      const d = new Date(utcMs);
      if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    }
  }
  return null;
}

function formatDateOnly(val: any): string | null {
  if (!val) return null;
  if (typeof val === "string") {
    const m = val.match(/^(\d{4}-\d{2}-\d{2})/);
    if (m) return m[1];
  }
  if (val instanceof Date && !Number.isNaN(val.getTime())) {
    const yyyy = val.getFullYear();
    const mm = String(val.getMonth() + 1).padStart(2, "0");
    const dd = String(val.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }
  return parsePersonnelBirthDate(val);
}

/** Removes deleted employee/account references across Zalo bindings, org assignments, permission backups, and Factory RBAC. */
async function cleanupDeletedStaffArtifacts(opts: {
  personnelIds?: number[];
  userIds?: number[];
  codes?: string[];
  names?: string[];
}): Promise<void> {
  const pIds = (opts.personnelIds ?? []).map(Number).filter((n) => Number.isFinite(n) && n > 0);
  const uIds = (opts.userIds ?? []).map(Number).filter((n) => Number.isFinite(n) && n > 0 && n !== 1);
  const codeSet = new Set<string>();
  for (const c of opts.codes ?? []) {
    for (const v of employeeCodeVariants(c)) codeSet.add(v);
  }
  const nameKeySet = new Set<string>(
    (opts.names ?? []).map((n) => personNameKey(n)).filter(Boolean)
  );
  const pIdStrSet = new Set<string>(pIds.map(String));

  if (pIds.length > 0) {
    await query("DELETE FROM zalo_user_bindings WHERE personnel_id = ANY($1::int[])", [pIds]).catch(() => {});
  }
  if (codeSet.size > 0) {
    await query("DELETE FROM zalo_user_bindings WHERE LOWER(employee_id) = ANY($1::text[])", [Array.from(codeSet)]).catch(() => {});
    const permKeys = Array.from(codeSet)
      .map((c) => `user_permissions_${c.replace(/[^a-z0-9]/g, "")}`)
      .filter((k) => k.length > "user_permissions_".length);
    if (permKeys.length > 0) {
      await query("DELETE FROM app_storage WHERE key = ANY($1::text[])", [permKeys]).catch(() => {});
    }
  }
  if (nameKeySet.size > 0) {
    const zbRows = (await query("SELECT id, display_name FROM zalo_user_bindings").catch(() => ({ rows: [] as any[] }))).rows;
    const matchZbIds = zbRows.filter((r) => nameKeySet.has(personNameKey(r.display_name))).map((r) => Number(r.id));
    if (matchZbIds.length > 0) {
      await query("DELETE FROM zalo_user_bindings WHERE id = ANY($1::int[])", [matchZbIds]).catch(() => {});
    }
  }

  // Strip removed employee codes / names / IDs from org_position_assignments
  try {
    const assignRow = (await query("SELECT data FROM app_storage WHERE key = 'org_position_assignments' LIMIT 1")).rows[0];
    if (assignRow?.data && typeof assignRow.data === "object") {
      let changed = false;
      const next: Record<string, Record<string, string[]>> = {};
      for (const [deptKey, posMap] of Object.entries(assignRow.data as Record<string, any>)) {
        if (!posMap || typeof posMap !== "object") continue;
        const nextPosMap: Record<string, string[]> = {};
        for (const [posTitle, holders] of Object.entries(posMap)) {
          if (!Array.isArray(holders)) continue;
          const filtered = holders.filter((h) => {
            const raw = String(h || "").trim();
            const low = raw.toLowerCase();
            const remove =
              pIdStrSet.has(raw) ||
              codeSet.has(low) ||
              nameKeySet.has(personNameKey(raw));
            if (remove) changed = true;
            return !remove;
          });
          nextPosMap[posTitle] = filtered;
        }
        next[deptKey] = nextPosMap;
      }
      if (changed) {
        await query(
          "UPDATE app_storage SET data = $1::jsonb, version = COALESCE(version, 1) + 1, updated_at = NOW() WHERE key = 'org_position_assignments'",
          [JSON.stringify(next)]
        );
      }
    }
  } catch {}

  if (uIds.length > 0) {
    try {
      const fPool = getFactoryPool();
      await fPool.query("DELETE FROM core.user_role WHERE user_id = ANY($1::int[])", [uIds]);
      await fPool.query("DELETE FROM core.user_profile WHERE user_id = ANY($1::int[])", [uIds]);
    } catch {}
  }

  invalidateHrPersonnelCache();
}

/** Mã nhân viên tự sinh không trùng (thay cho Date.now() dễ trùng và ghi đè hồ sơ của người khác). */
async function nextEmployeeCode(): Promise<string> {
  const res = await query(
    `SELECT COALESCE(MAX(CAST(SUBSTRING(employee_code FROM 'NV-ABT-([0-9]+)$') AS INTEGER)), 0) AS max_seq
       FROM personnel WHERE employee_code ~ '^NV-ABT-[0-9]+$'`
  );
  let seq = Number(res.rows[0]?.max_seq || 0) + 1;
  for (;;) {
    const code = `NV-ABT-${String(seq).padStart(3, "0")}`;
    const exists = await query(
      "SELECT 1 FROM personnel WHERE employee_code = $1 UNION ALL SELECT 1 FROM users WHERE LOWER(username) = LOWER($1) LIMIT 1",
      [code]
    );
    if (exists.rows.length === 0) return code;
    seq++;
  }
}

/**
 * Personnel → users. An existing account keeps its role (set from the import's "Vai trò hệ thống" column or by
 * an administrator; re-guessing it from the department here overwrote both). A new account gets the role
 * inferred from its department and position (`inferSystemRoleFromPosition`, the same rule as the import).
 */
async function syncPersonnelToUsers(): Promise<InitialCredential[]> {
  const res = await query(`
    INSERT INTO users (username, password_hash, full_name, role, department, email, is_active, must_change_password)
    SELECT
      p.employee_code AS username,
      $1 AS password_hash,
      p.full_name,
      'staff' AS role,
      p.department,
      p.email,
      CASE WHEN p.status = 'INACTIVE' THEN false ELSE true END AS is_active,
      true AS must_change_password
    FROM personnel p
    WHERE p.employee_code IS NOT NULL
      AND p.employee_code != ''
      AND p.employee_code != 'admin'
    ON CONFLICT (username) DO UPDATE SET
      full_name = EXCLUDED.full_name,
      department = EXCLUDED.department,
      email = COALESCE(EXCLUDED.email, users.email)
    RETURNING username, full_name, department, (xmax = 0) AS inserted;
  `, [unusablePasswordHash()]);
  const created: InitialCredential[] = [];
  for (const r of res.rows) {
    if (!r.inserted) continue;
    const position = (await query("SELECT position FROM personnel WHERE employee_code = $1", [r.username])).rows[0]?.position ?? "";
    await query("UPDATE users SET role = $2 WHERE username = $1", [r.username, inferSystemRoleFromPosition(r.department, position)]);
    const sibling = await query(
      `SELECT password_hash, COALESCE(must_change_password, false) AS must_change_password
         FROM users
        WHERE username != $1
          AND password_hash IS NOT NULL AND password_hash <> ''
          AND (
            LOWER(username) = LOWER(REGEXP_REPLACE($1, '^NV-(TBRS|TBR|VIA|ABT)-?', '\\1', 'i'))
            OR LOWER(username) = LOWER(REGEXP_REPLACE($1, '^(TBRS|TBR|VIA|ABT)-?([0-9]+)$', 'NV-\\1-\\2', 'i'))
            OR ($2 <> '' AND LOWER(TRIM(full_name)) = LOWER(TRIM($2)))
          )
        ORDER BY id ASC LIMIT 1`,
      [r.username, String(r.full_name || "")]
    ).catch(() => ({ rows: [] as any[] }));
    if (sibling.rows[0]?.password_hash) {
      await query(
        "UPDATE users SET password_hash = $1, must_change_password = $2 WHERE username = $3",
        [sibling.rows[0].password_hash, Boolean(sibling.rows[0].must_change_password), r.username]
      );
    } else {
      created.push(await assignTemporaryPassword(r.username, r.full_name));
    }
  }
  await ensureFactoryRolesAndSyncAllUsers().catch((e) => console.warn("Factory sync warning:", e?.message));
  return created;
}

const AUDIT_PAGE_SIZE = 100;

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const action = searchParams.get("action") || "overview";
    const me = await getAuthorizedUser(req);
    setAuditActor(me);
    if (!me) return unauthorizedResponse();
    const isAdmin = isAdminUser(me);

    if (action === "overview") {
      await ensurePersonnelTable();
      await ensureFactoryRolesAndSyncAllUsers().catch((e) => console.warn("Factory org sync warning:", e?.message));

      let personnelRows: any[] = [];
      let usersRows: any[] = [];
      let logsRows: any[] = [];
      let logsTotal = 0;

      try {
        await query("ALTER TABLE personnel ADD COLUMN IF NOT EXISTS date_of_birth DATE").catch(() => {});
        const pRes = await query("SELECT * FROM personnel ORDER BY id ASC");
        personnelRows = (pRes.rows || []).map((p: any) => ({
          ...p,
          date_of_birth: formatDateOnly(p.date_of_birth),
        }));
      } catch (e: any) {
        console.error("Failed to query personnel:", e.message);
      }

      try {
        const uRes = await query("SELECT id, username, full_name, role, department, email, avatar, is_active, created_at, permissions FROM users ORDER BY id ASC");
        usersRows = uRes.rows;
      } catch (e: any) {
        console.warn("Failed to query users full fields, using fallback:", e.message);
        try {
          const uFallback = await query("SELECT id, username, full_name, role, department, email, is_active, permissions FROM users ORDER BY id ASC");
          usersRows = uFallback.rows;
        } catch (e2: any) {
          console.error("Failed to query users fallback:", e2.message);
        }
      }

      // Gắn thông tin Đơn vị Nhà máy & Vai trò Nhà máy (Khối Kỹ thuật) vào danh sách tài khoản
      try {
        const fPool = getFactoryPool();
        const fProfiles = (
          await fPool.query(
            `SELECT up.user_id, up.org_unit_id, o.code AS org_code, o.name AS org_name, (up.pin_hash IS NOT NULL) AS has_pin
               FROM core.user_profile up
               LEFT JOIN core.org_unit o ON o.id = up.org_unit_id`
          )
        ).rows;
        const fGrants = (
          await fPool.query(
            `SELECT ur.user_id, r.code AS role_code, r.name AS role_name
               FROM core.user_role ur
               JOIN core.role r ON r.id = ur.role_id
              WHERE ur.revoked_at IS NULL`
          )
        ).rows;
        const profMap = new Map(fProfiles.map((p: any) => [Number(p.user_id), p]));
        usersRows = (usersRows || []).map((u: any) => {
          const fp = profMap.get(Number(u.id));
          const roles = fGrants.filter((g: any) => Number(g.user_id) === Number(u.id)).map((g: any) => g.role_code);
          return {
            ...u,
            factory_org_code: fp?.org_code || null,
            factory_org_name: fp?.org_name || null,
            has_factory_pin: Boolean(fp?.has_pin),
            factory_roles: roles,
          };
        });
      } catch (e: any) {
        // Bỏ qua nếu schema nhà máy chưa khởi tạo
      }

      // Chuẩn hóa permissions luôn là object an toàn
      usersRows = (usersRows || []).map(u => {
        let perms = u.permissions;
        if (typeof perms === "string") {
          try { perms = JSON.parse(perms); } catch (e) { perms = {}; }
        }
        return { ...u, permissions: perms && typeof perms === "object" ? perms : {} };
      });

      // Tài khoản không còn được tạo ngầm khi mở màn hình (mật khẩu tạm phải được trả cho Quản trị viên):
      // dùng nút "Đồng bộ tài khoản từ nhân sự" (sync_users_from_personnel).

      try {
        // Nhật ký hệ thống chỉ trả về cho quản trị viên
        if (isAdmin) {
          const [lRes, cRes] = await Promise.all([
            query("SELECT * FROM audit_logs ORDER BY created_at DESC, id DESC LIMIT $1", [AUDIT_PAGE_SIZE]),
            query("SELECT COUNT(*)::int AS total FROM audit_logs"),
          ]);
          logsRows = lRes.rows;
          logsTotal = Number(cRes.rows[0]?.total || 0);
        }
      } catch (e: any) {
        console.error("Failed to query audit_logs:", e.message);
      }

      // Người không phải quản trị viên chỉ nhận danh bạ công việc (tên, mã, phòng ban, chức vụ, SĐT / email công việc
      // dùng trên báo giá): không trả phân quyền chi tiết và thông tin tài khoản của mọi người
      if (!isAdmin) {
        personnelRows = personnelRows.map((p: any) => ({
          id: p.id, employee_code: p.employee_code, full_name: p.full_name,
          department: p.department, position: p.position, email: p.email, phone: p.phone,
          date_of_birth: p.date_of_birth, status: p.status,
        }));
        usersRows = usersRows.map((u: any) => ({
          id: u.id, username: u.username, full_name: u.full_name, role: u.role,
          department: u.department, avatar: u.avatar, is_active: u.is_active,
        }));
      }

      return NextResponse.json({
        personnel: personnelRows,
        users: usersRows,
        logs: logsRows,
        logs_total: logsTotal,
      });
    }

    // Nhật ký hệ thống theo trang (Tải thêm): chỉ quản trị viên
    if (action === "audit_logs") {
      if (!isAdmin) return forbiddenResponse("Chỉ Quản trị viên mới được xem nhật ký hệ thống.");
      const offset = Math.max(0, Math.floor(Number(searchParams.get("offset")) || 0));
      const limit = Math.min(500, Math.max(1, Math.floor(Number(searchParams.get("limit")) || AUDIT_PAGE_SIZE)));
      const [lRes, cRes] = await Promise.all([
        query("SELECT * FROM audit_logs ORDER BY created_at DESC, id DESC LIMIT $1 OFFSET $2", [limit, offset]),
        query("SELECT COUNT(*)::int AS total FROM audit_logs"),
      ]);
      return NextResponse.json({ logs: lRes.rows, total: Number(cRes.rows[0]?.total || 0) });
    }

    return NextResponse.json({ error: "Hành động không hợp lệ" }, { status: 400 });
  } catch (error: any) {
    return apiErrorResponse(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const body = await req.json();
    const action = searchParams.get("action") || body?.action;

    // Mọi thao tác ghi trong Cấu hình (nhân sự, tài khoản, phân quyền, reset) chỉ dành cho quản trị viên
    const me = await getAuthorizedUser(req);
    setAuditActor(me);
    if (!me) return unauthorizedResponse();
    if (!isAdminUser(me)) return forbiddenResponse("Chỉ Quản trị viên / Ban Giám Đốc mới được thay đổi cấu hình nhân sự và tài khoản.");

    if (action === "personnel") {
      await query("ALTER TABLE personnel ADD COLUMN IF NOT EXISTS date_of_birth DATE").catch(() => {});
      const { id, employee_code, full_name, department, position, email, phone, date_of_birth, status } = body;
      const cleanEmail = normalizePersonText(email).toLowerCase();
      const cleanName = normalizePersonText(full_name);
      const cleanDept = normalizePersonText(department);
      const cleanPos = normalizePersonText(position);
      const cleanPhone = normalizePersonText(phone);
      const cleanDob = parsePersonnelBirthDate(date_of_birth);
      const requestedCode = normalizePersonText(employee_code);
      const role = inferSystemRoleFromPosition(cleanDept, cleanPos);

      if (!cleanName) {
        return NextResponse.json({ error: "Vui lòng nhập họ và tên nhân sự." }, { status: 400 });
      }

      if (id) {
        await query(
          `UPDATE personnel SET full_name=$1, department=$2, position=$3, email=$4, phone=$5, status=$6, date_of_birth=$7 WHERE id=$8`,
          [cleanName, cleanDept, cleanPos, cleanEmail, cleanPhone, status || "ACTIVE", cleanDob, id]
        );
        // Automatically sync to users table (chat account)
        const variants = employeeCodeVariants(requestedCode);
        if (variants.length > 0) {
          await query(
            `UPDATE users SET 
               full_name = $1, 
               department = $2, 
               email = $3,
               role = CASE WHEN role = 'admin' THEN 'admin' ELSE $4 END,
               is_active = $5
             WHERE LOWER(username) = ANY($6::text[])`,
            [cleanName, cleanDept, cleanEmail, role, (status !== "INACTIVE"), variants]
          );
        }
        await syncSinglePortalUserToFactory({ username: requestedCode, department: cleanDept, position: cleanPos, role }).catch(() => {});
        invalidateHrPersonnelCache();
        await logAudit("UPDATE", "PERSONNEL", `Cập nhật nhân sự & tài khoản chat ${cleanName} (${requestedCode})`);
      } else {
        if (requestedCode) {
          const dup = await query("SELECT full_name FROM personnel WHERE LOWER(employee_code) = LOWER($1)", [requestedCode]);
          if (dup.rows.length > 0) {
            return NextResponse.json({ error: `Mã nhân viên ${requestedCode} đã thuộc về "${dup.rows[0].full_name}". Vui lòng dùng mã khác hoặc sửa hồ sơ hiện có.` }, { status: 409 });
          }
        }
        const existingAll = (await query("SELECT id, employee_code, full_name, department FROM personnel")).rows;
        const nameKey = personNameKey(cleanName);
        const dupPerson = existingAll.find(
          (p) => personNameKey(p.full_name) === nameKey && isSameDepartment(p.department, cleanDept)
        );
        if (dupPerson) {
          return NextResponse.json(
            {
              error: `Nhân sự "${cleanName}" đã tồn tại trong phòng ${dupPerson.department} (Mã NV: ${dupPerson.employee_code}). Vui lòng chỉnh sửa hồ sơ hiện có thay vì tạo trùng.`,
            },
            { status: 409 }
          );
        }
        const code = requestedCode || await nextEmployeeCode();
        await query(
          `INSERT INTO personnel (employee_code, full_name, department, position, email, phone, date_of_birth, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [code, cleanName, cleanDept, cleanPos, cleanEmail, cleanPhone, cleanDob, status || "ACTIVE"]
        );
        // Tạo tài khoản đăng nhập tương ứng; không ghi đè tài khoản đã tồn tại
        const ins = await query(
          `INSERT INTO users (username, password_hash, full_name, role, department, email, is_active, must_change_password)
           VALUES ($1, $2, $3, $4, $5, $6, true, true)
           ON CONFLICT (username) DO NOTHING
           RETURNING username`,
          [code, unusablePasswordHash(), cleanName, role, cleanDept, cleanEmail]
        );
        const credential = ins.rows.length > 0 ? await assignTemporaryPassword(code, cleanName) : null;
        await syncSinglePortalUserToFactory({ username: code, department: cleanDept, position: cleanPos, role }).catch(() => {});
        invalidateHrPersonnelCache();
        await logAudit("CREATE", "PERSONNEL", `Thêm mới nhân sự & tài khoản chat ${cleanName} (${code})`);
        return NextResponse.json({ success: true, initial_credentials: credential ? [credential] : [] });
      }
      return NextResponse.json({ success: true });
    }

    if (action === "reset_personnel_and_users") {
      // Thao tác xóa toàn bộ: bắt buộc nhập lại mật khẩu của chính quản trị viên đang đăng nhập
      const pwRow = (await query("SELECT password_hash FROM users WHERE id = $1", [me.id])).rows[0];
      if (!pwRow || !verifyPassword(String(body.confirm_password || ""), pwRow.password_hash)) {
        return forbiddenResponse("Mật khẩu xác nhận không đúng. Dữ liệu chưa bị xóa.");
      }
      // Một giao dịch: lỗi giữa chừng thì không có gì bị xóa (trước đây có thể dừng ở trạng thái xóa dở)
      await withTransaction(async (c) => {
        await c.query("DELETE FROM personnel");
        await c.query("DELETE FROM users WHERE username != 'admin'");
        await c.query("DELETE FROM zalo_user_bindings WHERE employee_id != 'admin'");
        await c.query("DELETE FROM app_storage WHERE key IN ('sales_personnel_custom', 'sales_personnel_contacts')");
        await c.query(`
          INSERT INTO users (username, password_hash, full_name, role, department, email, is_active)
          VALUES ('admin', $1, 'Quản Trị Viên Hệ Thống', 'admin', 'Ban Giám Đốc', 'admin@abtvn.com', true)
          ON CONFLICT (username) DO UPDATE SET
            full_name = 'Quản Trị Viên Hệ Thống',
            role = 'admin',
            is_active = true
        `, [unusablePasswordHash()]); // tài khoản admin đã có giữ nguyên mật khẩu (ON CONFLICT không đổi mật khẩu)
      });
      await ensureFactoryRolesAndSyncAllUsers().catch((e) => console.warn("Factory sync on reset warning:", e?.message));
      invalidateHrPersonnelCache();
      await logAudit("RESET", "SETTINGS", "Quản trị viên đã thực hiện Reset toàn bộ danh bạ nhân sự, tài khoản và danh mục Zalo");
      return NextResponse.json({ success: true, message: "Đã làm sạch toàn bộ dữ liệu Nhân sự, Tài khoản và Danh mục Zalo." });
    }

    if (action === "sync_users_from_personnel") {
      const created = await syncPersonnelToUsers();
      await logAudit("SYNC", "SETTINGS", `Quản trị viên đã đồng bộ tài khoản đăng nhập từ nhân sự (${created.length} tài khoản mới)`);
      return NextResponse.json({
        success: true,
        initial_credentials: created,
        message: created.length > 0
          ? `Đã tạo ${created.length} tài khoản mới với mật khẩu tạm (phải đổi ở lần đăng nhập đầu).`
          : "Đã đồng bộ tài khoản đăng nhập, không có tài khoản mới."
      });
    }

    if (action === "import_personnel_excel") {
      const { rows } = body;
      if (!Array.isArray(rows) || rows.length === 0) {
        return NextResponse.json({ error: "Không có dữ liệu hợp lệ để nạp" }, { status: 400 });
      }

      await ensurePersonnelTable();
      let count = 0;
      const created: InitialCredential[] = [];
      const importWarnings: string[] = [];
      // Mã dự phòng cho dòng thiếu mã: duy nhất trong lô (Date.now() trùng nhau giữa các dòng cùng mili-giây)
      const importBatchStamp = Date.now().toString(36).toUpperCase();
      let importAutoSeq = 0;
      const existingPersonnelRows = (
        await query("SELECT id, employee_code, full_name, department, email FROM personnel ORDER BY id ASC")
      ).rows;
      for (const r of rows) {
        const getVal = (candidates: string[]): string => {
          for (const c of candidates) {
            if (r[c] !== undefined && r[c] !== null && String(r[c]).trim() !== "") {
              return normalizePersonText(String(r[c]));
            }
          }
          const rowKeys = Object.keys(r);
          for (const cand of candidates) {
            const cleanCand = cand.toLowerCase().replace(/[\s\(\)\*\_]/g, "");
            for (const rk of rowKeys) {
              const cleanRk = rk.toLowerCase().replace(/[\s\(\)\*\_]/g, "");
              if (cleanRk === cleanCand && r[rk] !== undefined && r[rk] !== null && String(r[rk]).trim() !== "") {
                return normalizePersonText(String(r[rk]));
              }
            }
          }
          return "";
        };

        const rawEmpCode = getVal(["Mã nhân viên (*)", "Mã nhân viên", "employee_code", "MaNV", "Mã NV", "Mã"]);
        const fullName = getVal(["Họ và tên (*)", "Họ và tên", "full_name", "name", "Họ tên"]) || "Nhân viên ABT";
        const email = getVal(["Email (*)", "Email", "email"]).toLowerCase();
        const phone = getVal(["Số điện thoại", "phone", "SĐT", "Điện thoại"]);
        const dept = getVal(["Phòng ban (*)", "Phòng ban", "department"]) || "Kinh Doanh";
        const position = getVal(["Chức vụ / Vị trí (*)", "Chức vụ / Vị trí", "Chức vụ", "Vị trí", "position"]) || "Chuyên viên";
        const nameKey = personNameKey(fullName);
        const matchedExisting =
          !rawEmpCode && nameKey
            ? existingPersonnelRows.find(
                (p) =>
                  personNameKey(p.full_name) === nameKey &&
                  (isSameDepartment(p.department, dept) || (email && String(p.email || "").trim().toLowerCase() === email))
              ) || existingPersonnelRows.find((p) => personNameKey(p.full_name) === nameKey)
            : undefined;
        const empCode = rawEmpCode || matchedExisting?.employee_code || `NV-ABT-${importBatchStamp}-${++importAutoSeq}`;
        const rawRole = getVal(["Vai trò hệ thống (*)", "Vai trò hệ thống", "Vai Trò Hệ Thống", "Vai trò", "role", "Role"]);
        const rawDob = getVal([
          "Ngày sinh (DD/MM/YYYY)",
          "Ngày sinh",
          "Ngày tháng năm sinh",
          "date_of_birth",
          "DOB",
          "Ngaysinh",
        ]);
        const cleanDob = parsePersonnelBirthDate(rawDob);
        const statusRaw = (getVal(["Trạng thái", "status"]) || "ACTIVE").toUpperCase();
        const status = statusRaw.includes("NGHỈ") || statusRaw.includes("INACTIVE") ? "INACTIVE" : "ACTIVE";
        const resolvedRole = inferSystemRoleFromPosition(dept, position, rawRole);
        // Mật khẩu khởi tạo / tên đăng nhập ghi trong file (nếu có); mật khẩu luôn phải đổi ở lần đăng nhập đầu
        const providedPassword = getVal(["Mật khẩu khởi tạo", "Mật khẩu", "password"]);
        const providedLoginName = getVal(["Tên đăng nhập (*)", "Tên đăng nhập", "username", "TenDangNhap"]);

        // 1. Upsert into personnel (Single Source of Truth)
        const pUpsert = await query(
          `INSERT INTO personnel (employee_code, full_name, department, position, email, phone, date_of_birth, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (employee_code) DO UPDATE 
           SET full_name = EXCLUDED.full_name,
               department = EXCLUDED.department,
               position = EXCLUDED.position,
               email = EXCLUDED.email,
               phone = EXCLUDED.phone,
               date_of_birth = COALESCE(EXCLUDED.date_of_birth, personnel.date_of_birth),
               status = EXCLUDED.status
           RETURNING id, employee_code, full_name, department, email`,
          [empCode, fullName, dept, position, email, phone, cleanDob, status]
        );
        if (pUpsert.rows[0] && !existingPersonnelRows.some((p) => p.employee_code === empCode)) {
          existingPersonnelRows.push(pUpsert.rows[0]);
        }

        // Tài khoản đã có chỉ nhận mật khẩu trong file khi người dùng chưa từng đổi mật khẩu
        const userRes = await query(
          `INSERT INTO users (username, password_hash, full_name, role, department, email, is_active, must_change_password)
           VALUES ($1, $2, $3, $4, $5, $6, $7, true)
           ON CONFLICT (username) DO UPDATE
           SET password_hash = CASE WHEN $8::boolean AND COALESCE(users.must_change_password, false) THEN EXCLUDED.password_hash ELSE users.password_hash END,
               full_name = EXCLUDED.full_name,
               department = EXCLUDED.department,
               role = CASE WHEN users.role = 'admin' AND $4 != 'admin' THEN 'admin' ELSE EXCLUDED.role END,
               email = COALESCE(NULLIF(EXCLUDED.email, ''), users.email),
               is_active = EXCLUDED.is_active
           RETURNING (xmax = 0) AS inserted`,
          [empCode, providedPassword ? hashPassword(providedPassword) : unusablePasswordHash(), fullName, resolvedRole, dept, email, status === "ACTIVE", providedPassword !== ""]
        );
        if (userRes.rows[0]?.inserted && !providedPassword) created.push(await assignTemporaryPassword(empCode, fullName));
        const loginWarning = await setImportedLoginName(empCode, providedLoginName);
        if (loginWarning) importWarnings.push(loginWarning);

        count++;
      }

      // 2. Automatically sync to users table from personnel
      created.push(...(await syncPersonnelToUsers()));

      // 3. Automatically sync to Zalo bindings from personnel
      await syncPersonnelToZaloBindings();
      invalidateHrPersonnelCache();

      await logAudit("IMPORT_EXCEL", "PERSONNEL", `Nạp thành công ${count} hồ sơ nhân sự, tự động đồng bộ tài khoản người dùng và Zalo`);

      return NextResponse.json({
        success: true,
        count,
        initial_credentials: created,
        warnings: importWarnings,
        message: `${importWarnings.length ? `Lưu ý:\n${importWarnings.join("\n")}\n\n` : ""}Đã nạp thành công ${count} nhân sự${created.length ? `, tạo ${created.length} tài khoản mới với mật khẩu tạm (phải đổi ở lần đăng nhập đầu)` : ""} và liên kết Zalo.`
      });
    }

    if (action === "delete_personnel") {
      const { id, full_name, employee_code } = body;
      const numId = id != null && !isNaN(Number(id)) ? Number(id) : null;
      const targetRow = numId
        ? (await query("SELECT id, employee_code, full_name FROM personnel WHERE id = $1", [numId])).rows[0]
        : null;
      const targetName = normalizePersonText(targetRow?.full_name || full_name);
      const targetCode = normalizePersonText(targetRow?.employee_code || employee_code);
      const targetNameKey = personNameKey(targetName);
      const codeSet = new Set<string>(employeeCodeVariants(targetCode));

      const allPersonnel = (await query("SELECT id, employee_code, full_name FROM personnel")).rows;
      const matchedPersonnel = allPersonnel.filter((p) => {
        if (numId !== null && Number(p.id) === numId) return true;
        const pk = normalizePersonText(p.employee_code).toLowerCase();
        if (pk && codeSet.has(pk)) return true;
        if (targetNameKey && targetNameKey !== "admin" && personNameKey(p.full_name) === targetNameKey) return true;
        return false;
      });
      for (const mp of matchedPersonnel) {
        for (const v of employeeCodeVariants(mp.employee_code)) codeSet.add(v);
      }

      const deletedPersonnelIds = matchedPersonnel.map((p) => Number(p.id)).filter((n) => Number.isFinite(n));
      if (deletedPersonnelIds.length > 0) {
        await query("DELETE FROM personnel WHERE id = ANY($1::int[])", [deletedPersonnelIds]);
      } else if (numId !== null) {
        await query("DELETE FROM personnel WHERE id = $1", [numId]);
      }

      const allUsers = (
        await query("SELECT id, username, login_name, full_name, role FROM users WHERE id <> 1 AND LOWER(username) <> 'admin'")
      ).rows;
      const matchedUserIds = allUsers
        .filter((u) => {
          if (Number(u.id) === Number(me.id) || String(u.role || "").toLowerCase() === "admin") return false;
          const uk = normalizePersonText(u.username).toLowerCase();
          const lk = normalizePersonText(u.login_name).toLowerCase();
          if (uk && codeSet.has(uk)) return true;
          if (lk && codeSet.has(lk)) return true;
          if (targetNameKey && targetNameKey !== "admin" && personNameKey(u.full_name) === targetNameKey) return true;
          return false;
        })
        .map((u) => Number(u.id));

      if (matchedUserIds.length > 0) {
        await query("DELETE FROM users WHERE id = ANY($1::int[])", [matchedUserIds]);
      }

      await cleanupDeletedStaffArtifacts({
        personnelIds: deletedPersonnelIds.length > 0 ? deletedPersonnelIds : numId ? [numId] : [],
        userIds: matchedUserIds,
        codes: Array.from(codeSet),
        names: [targetName, ...matchedPersonnel.map((p) => p.full_name)].filter(Boolean),
      });

      await logAudit("DELETE", "PERSONNEL", `Xóa hồ sơ nhân sự, tài khoản & liên kết Zalo ${targetName || id} (${targetCode || ""})`);
      return NextResponse.json({ success: true, deleted_personnel: deletedPersonnelIds.length, deleted_users: matchedUserIds.length });
    }

    if (action === "user") {
      const { id, password, is_active } = body;
      const username = normalizePersonText(body.username);
      const full_name = normalizePersonText(body.full_name);
      const role = normalizePersonText(body.role);
      const department = normalizePersonText(body.department);
      const email = normalizePersonText(body.email).toLowerCase();
      if (id) {
        if (password) {
          const newHash = hashPassword(String(password));
          await query(
            `UPDATE users SET full_name=$1, role=$2, department=$3, email=$4, is_active=$5, password_hash=$6,
                must_change_password = true, failed_login_count = 0, locked_until = NULL,
                session_version = COALESCE(session_version, 0) + 1 WHERE id=$7`,
            [full_name, role, department, email, is_active !== false, newHash, id]
          );
          if (username || full_name) {
            await query(
              `UPDATE users SET password_hash=$1, must_change_password = true, failed_login_count = 0, locked_until = NULL,
                      session_version = COALESCE(session_version, 0) + 1
                WHERE id != $2
                  AND (
                    ($3 <> '' AND (
                      LOWER(username) = LOWER(REGEXP_REPLACE($3, '^NV-(TBRS|TBR|VIA|ABT)-?', '\\1', 'i'))
                      OR LOWER(username) = LOWER(REGEXP_REPLACE($3, '^(TBRS|TBR|VIA|ABT)-?([0-9]+)$', 'NV-\\1-\\2', 'i'))
                    ))
                    OR ($4 <> '' AND LOWER(TRIM(full_name)) = LOWER(TRIM($4)))
                  )`,
              [newHash, id, String(username || ""), String(full_name || "")]
            ).catch(() => {});
          }
        } else {
          await query(
            `UPDATE users SET full_name=$1, role=$2, department=$3, email=$4, is_active=$5,
                session_version = CASE WHEN is_active AND NOT $5 THEN COALESCE(session_version, 0) + 1 ELSE session_version END WHERE id=$6`,
            [full_name, role, department, email, is_active !== false, id]
          );
        }
        // Đồng bộ email sang hồ sơ nhân sự theo mã nhân viên (không theo họ tên để tránh ghi nhầm người trùng tên)
        if (email && username) {
          const variants = employeeCodeVariants(username);
          await query(
            `UPDATE personnel SET email = $1 WHERE LOWER(employee_code) = ANY($2::text[])`,
            [email, variants]
          );
        }
        await syncSinglePortalUserToFactory({ userId: Number(id), username, department, role }).catch(() => {});
        await logAudit("UPDATE", "USER", `Cập nhật tài khoản ${username || id}`);
      } else {
        // Mật khẩu Quản trị viên nhập hoặc mật khẩu tạm ngẫu nhiên; luôn phải đổi ở lần đăng nhập đầu
        const initialPassword = password ? String(password) : generateTemporaryPassword();
        await query(
          `INSERT INTO users (username, password_hash, full_name, role, department, email, is_active, must_change_password)
           VALUES ($1, $2, $3, $4, $5, $6, $7, true)`,
          [username, hashPassword(initialPassword), full_name, role, department, email, is_active !== false]
        );
        await syncSinglePortalUserToFactory({ username, department, role }).catch(() => {});
        await logAudit("CREATE", "USER", `Tạo tài khoản mới ${username}`);
        return NextResponse.json({
          success: true,
          initial_credentials: password ? [] : [{ username, full_name, password: initialPassword }]
        });
      }
      return NextResponse.json({ success: true });
    }

    if (action === "toggle_user_status") {
      const { id, is_active, username } = body;
      // Khóa tài khoản thu hồi ngay mọi phiên đăng nhập đang mở
      await query(`UPDATE users SET is_active=$1, session_version = CASE WHEN $1 THEN session_version ELSE COALESCE(session_version, 0) + 1 END WHERE id=$2`, [Boolean(is_active), id]);
      await logAudit("STATUS_CHANGE", "USER", `${is_active ? "Mở khóa" : "Tạm khóa"} tài khoản ${username || id}`);
      return NextResponse.json({ success: true });
    }

    if (action === "reset_password") {
      const { id, password, username } = body;
      if (!password || String(password).length < 6) {
        return NextResponse.json({ error: "Mật khẩu mới phải có tối thiểu 6 ký tự" }, { status: 400 });
      }
      const newHash = hashPassword(String(password));
      // Mật khẩu do quản trị viên đặt là tạm thời: người dùng phải đổi ở lần đăng nhập kế tiếp; các phiên cũ bị thu hồi
      const upd = await query(
        `UPDATE users SET password_hash=$1, must_change_password = true, failed_login_count = 0, locked_until = NULL,
                session_version = COALESCE(session_version, 0) + 1 WHERE id=$2 RETURNING username, full_name`,
        [newHash, id]
      );
      const targetUsername = String(username || upd.rows[0]?.username || "").trim();
      const targetFullName = String(upd.rows[0]?.full_name || "").trim();
      if (targetUsername || targetFullName) {
        await query(
          `UPDATE users SET password_hash=$1, must_change_password = true, failed_login_count = 0, locked_until = NULL,
                  session_version = COALESCE(session_version, 0) + 1
            WHERE id != $2
              AND (
                ($3 <> '' AND (
                  LOWER(username) = LOWER($3)
                  OR LOWER(username) = LOWER(REGEXP_REPLACE($3, '^NV-(TBRS|TBR|VIA|ABT)-?', '\\1', 'i'))
                  OR LOWER(username) = LOWER(REGEXP_REPLACE($3, '^(TBRS|TBR|VIA|ABT)-?([0-9]+)$', 'NV-\\1-\\2', 'i'))
                ))
                OR ($4 <> '' AND LOWER(TRIM(full_name)) = LOWER(TRIM($4)))
              )`,
          [newHash, id, targetUsername, targetFullName]
        ).catch(() => {});
      }
      await logAudit("RESET_PASSWORD", "USER", `Đổi mật khẩu tài khoản ${username || id}`);
      return NextResponse.json({ success: true });
    }

    if (action === "delete_user") {
      const { id, username, also_delete_personnel } = body;
      const numId = Number(id);
      const targetUser = (await query("SELECT id, username, login_name, full_name, role FROM users WHERE id = $1", [numId])).rows[0];
      if (numId === 1 || numId === Number(me.id) || String(targetUser?.username || username || "").toLowerCase() === "admin") {
        return NextResponse.json({ error: "Không thể xóa tài khoản Quản trị viên tối cao (Super Admin)" }, { status: 400 });
      }
      const targetName = normalizePersonText(targetUser?.full_name || "");
      const targetNameKey = personNameKey(targetName);
      const codeSet = new Set<string>([
        ...employeeCodeVariants(targetUser?.username || username),
        ...employeeCodeVariants(targetUser?.login_name),
      ]);

      const allUsers = (
        await query("SELECT id, username, login_name, full_name, role FROM users WHERE id <> 1 AND LOWER(username) <> 'admin'")
      ).rows;
      const delUserIds = allUsers
        .filter((u) => {
          if (Number(u.id) === Number(me.id) || String(u.role || "").toLowerCase() === "admin") return false;
          if (Number(u.id) === numId) return true;
          const uk = normalizePersonText(u.username).toLowerCase();
          if (uk && codeSet.has(uk)) return true;
          if (also_delete_personnel && targetNameKey && targetNameKey !== "admin" && personNameKey(u.full_name) === targetNameKey) return true;
          return false;
        })
        .map((u) => Number(u.id));

      if (delUserIds.length > 0) {
        await query("DELETE FROM users WHERE id = ANY($1::int[])", [delUserIds]);
      } else if (Number.isFinite(numId)) {
        await query("DELETE FROM users WHERE id = $1", [numId]);
      }

      let deletedPersonnelIds: number[] = [];
      let deletedNames: string[] = targetName ? [targetName] : [];
      if (also_delete_personnel) {
        const allPersonnel = (await query("SELECT id, employee_code, full_name FROM personnel")).rows;
        const matchedPersonnel = allPersonnel.filter((p) => {
          const pk = normalizePersonText(p.employee_code).toLowerCase();
          if (pk && codeSet.has(pk)) return true;
          if (targetNameKey && targetNameKey !== "admin" && personNameKey(p.full_name) === targetNameKey) return true;
          return false;
        });
        for (const mp of matchedPersonnel) {
          for (const v of employeeCodeVariants(mp.employee_code)) codeSet.add(v);
        }
        deletedPersonnelIds = matchedPersonnel.map((p) => Number(p.id)).filter((n) => Number.isFinite(n));
        if (deletedPersonnelIds.length > 0) {
          await query("DELETE FROM personnel WHERE id = ANY($1::int[])", [deletedPersonnelIds]);
        }
        deletedNames = [...deletedNames, ...matchedPersonnel.map((p) => p.full_name)].filter(Boolean);
      }

      await cleanupDeletedStaffArtifacts({
        personnelIds: deletedPersonnelIds,
        userIds: delUserIds.length > 0 ? delUserIds : [numId],
        codes: Array.from(codeSet),
        names: deletedNames,
      });

      await logAudit("DELETE", "USER", `Xóa tài khoản ${targetUser?.username || username || id}`);
      if (also_delete_personnel) {
        await logAudit("DELETE", "PERSONNEL", `Xóa hồ sơ nhân sự, tài khoản & liên kết Zalo ${targetName || username || id} (${targetUser?.username || ""})`);
      }
      return NextResponse.json({ success: true });
    }

    if (action === "update_permissions") {
      const { id, permissions, username, full_name } = body;
      const cleanUsername = String(username || "").trim();
      const cleanFullName = String(full_name || "").trim();
      const numId = (id && !isNaN(Number(id))) ? Number(id) : null;
      const cleanPerms = JSON.stringify(permissions || {});

      // Cập nhật đa tầng an toàn: theo ID số, Username chính thức, các định dạng mã nhân viên (NV-ABT / NV-VIA / VIA) VÀ Họ tên trùng khớp
      const updateRes = await query(
        `UPDATE users 
         SET permissions = $1::jsonb 
         WHERE ($2::int IS NOT NULL AND id = $2::int)
            OR ($3 <> '' AND (
                 LOWER(username) = LOWER($3)
              OR LOWER(username) = LOWER(REPLACE(REPLACE($3, 'NV-ABT-', 'ABT'), 'NV-VIA-', 'VIA'))
              OR LOWER(username) = LOWER(REPLACE(REPLACE($3, 'NV-ABT', 'ABT'), 'NV-VIA', 'VIA'))
              OR LOWER(username) = LOWER(REGEXP_REPLACE($3, '^(ABT|TBR|VIA)-?([0-9]+)$', 'NV-\\1-\\2', 'i'))
            ))
            OR ($4 <> '' AND LOWER(TRIM(full_name)) = LOWER(TRIM($4)))`,
        [cleanPerms, numId, cleanUsername, cleanFullName]
      );

      // Lưu trữ dự phòng trong app_storage để bảo vệ vĩnh viễn phân quyền
      if (cleanUsername) {
        const storageKey = `user_permissions_${cleanUsername.toLowerCase().replace(/[^a-z0-9]/g, "")}`;
        await query(
          `INSERT INTO app_storage (key, data, version, updated_at)
           VALUES ($1, $2::jsonb, 1, NOW())
           ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, version = COALESCE(app_storage.version, 1) + 1, updated_at = NOW()`,
          [storageKey, cleanPerms]
        ).catch(() => {});
      }

      await logAudit("UPDATE_PERMISSIONS", "SETTINGS", `Cập nhật phân quyền chi tiết cho tài khoản ${cleanUsername || id} (${updateRes.rowCount} bản ghi)`);
      return NextResponse.json({ success: true, permissions, affectedRows: updateRes.rowCount });
    }

    return NextResponse.json({ error: "Hành động POST không hợp lệ" }, { status: 400 });
  } catch (error: any) {
    return apiErrorResponse(error);
  }
}



import { NextRequest, NextResponse } from "next/server";
import { query, logAudit, ensurePersonnelTable, withTransaction } from "@/backend/db/db";
import { syncPersonnelToZaloBindings } from "@/backend/db/zaloDb";
import { hashPassword, verifyPassword, generateTemporaryPassword } from "@/backend/services/passwords";
import { getAuthorizedUser, isAdminUser, unauthorizedResponse, forbiddenResponse, setAuditActor } from "@/backend/services/authz";
import { inferSystemRoleFromPosition } from "@/backend/services/permissions";
import { setImportedLoginName } from "@/backend/services/accountImport";
import { ensureFactoryRolesAndSyncAllUsers, syncSinglePortalUserToFactory } from "@/factory/orgSync";
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

async function syncPersonnelToUsers(): Promise<InitialCredential[]> {
  const res = await query(`
    INSERT INTO users (username, password_hash, full_name, role, department, email, is_active, must_change_password)
    SELECT 
      p.employee_code AS username,
      $1 AS password_hash,
      p.full_name,
      CASE 
        WHEN p.department = 'Ban Giám Đốc' THEN 'admin'
        WHEN p.department = 'Kế Toán' OR LOWER(p.department) LIKE '%kế toán%' THEN 
          CASE WHEN LOWER(p.position) LIKE '%trưởng%' OR LOWER(p.position) LIKE '%chief%' THEN 'accountant_head' ELSE 'accountant' END
        WHEN p.department = 'Kho Vận' OR LOWER(p.department) LIKE '%kho%' THEN 
          CASE WHEN LOWER(p.position) LIKE '%trưởng%' OR LOWER(p.position) LIKE '%phụ trách%' OR LOWER(p.position) LIKE '%manager%' THEN 'warehouse_lead' ELSE 'warehouse' END
        WHEN p.department = 'Pháp Chế' OR LOWER(p.department) LIKE '%pháp chế%' THEN 
          CASE WHEN LOWER(p.position) LIKE '%trưởng%' OR LOWER(p.position) LIKE '%head%' THEN 'legal_head' ELSE 'legal' END
        WHEN p.department = 'Mua Hàng & Cung Ứng' OR LOWER(p.department) LIKE '%cung ứng%' OR LOWER(p.department) LIKE '%mua hàng%' THEN 
          CASE WHEN LOWER(p.position) LIKE '%trưởng%' OR LOWER(p.position) LIKE '%lead%' OR LOWER(p.position) LIKE '%head%' THEN 'procurement_lead' ELSE 'procurement_specialist' END
        WHEN p.department = 'Quản Lý Chất Lượng' OR p.department = 'QA/QC' OR p.department = 'QA / QC' OR LOWER(p.department) LIKE '%chất lượng%' THEN 
          CASE WHEN LOWER(p.position) LIKE '%trưởng%' OR LOWER(p.position) LIKE '%lead%' OR LOWER(p.position) LIKE '%manager%' THEN 'qa_qc_lead' ELSE 'qa_qc' END
        WHEN LOWER(p.department) LIKE '%r&d%' OR LOWER(p.department) LIKE '%nghiên cứu%' THEN
          CASE WHEN LOWER(p.position) LIKE '%trưởng%' OR LOWER(p.position) LIKE '%head%' OR LOWER(p.position) LIKE '%lead%' THEN 'rd_head' ELSE 'rd_staff' END
        WHEN LOWER(p.department) LIKE '%sản xuất kit%' OR LOWER(p.department) LIKE '%sx kit%' THEN
          CASE WHEN LOWER(p.position) LIKE '%trưởng%' OR LOWER(p.position) LIKE '%quản đốc%' OR LOWER(p.position) LIKE '%head%' THEN 'kit_head' ELSE 'kit_staff' END
        WHEN LOWER(p.department) LIKE '%oligo%' THEN
          CASE WHEN LOWER(p.position) LIKE '%trưởng%' OR LOWER(p.position) LIKE '%head%' OR LOWER(p.position) LIKE '%lead%' THEN 'oligo_head' ELSE 'oligo_staff' END
        WHEN LOWER(p.department) LIKE '%thiết bị%' THEN
          CASE WHEN LOWER(p.position) LIKE '%trưởng%' OR LOWER(p.position) LIKE '%head%' OR LOWER(p.position) LIKE '%lead%' THEN 'device_head' ELSE 'device_staff' END
        WHEN p.department LIKE '%Ứng Dụng%' OR p.department LIKE '%Application%' OR p.department LIKE '%Kỹ Thuật%' THEN 
          CASE WHEN LOWER(p.position) LIKE '%trưởng%' OR LOWER(p.position) LIKE '%head%' THEN 'app_head' ELSE 'app_rep' END
        WHEN p.department = 'Kinh Doanh' OR p.department = 'Marketing' THEN 
          CASE WHEN LOWER(p.position) LIKE '%trưởng%' OR LOWER(p.position) LIKE '%phó%' OR LOWER(p.position) LIKE '%giám đốc%' THEN 'sales_head' ELSE 'sales_rep' END
        ELSE 'sales_rep'
      END AS role,
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
      role = CASE WHEN users.role = 'admin' THEN 'admin' ELSE EXCLUDED.role END,
      email = COALESCE(EXCLUDED.email, users.email)
    RETURNING username, full_name, (xmax = 0) AS inserted;
  `, [unusablePasswordHash()]);
  const created: InitialCredential[] = [];
  for (const r of res.rows) {
    if (r.inserted) created.push(await assignTemporaryPassword(r.username, r.full_name));
  }
  await ensureFactoryRolesAndSyncAllUsers().catch((e) => console.warn("Factory sync warning:", e?.message));
  return created;
}

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

      try {
        const pRes = await query("SELECT * FROM personnel ORDER BY id ASC");
        personnelRows = pRes.rows;
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
        const lRes = isAdmin ? await query("SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 100") : { rows: [] as any[] };
        logsRows = lRes.rows;
      } catch (e: any) {
        console.error("Failed to query audit_logs:", e.message);
      }

      // Người không phải quản trị viên chỉ nhận danh bạ công việc (tên, mã, phòng ban, chức vụ, SĐT / email công việc
      // dùng trên báo giá): không trả phân quyền chi tiết và thông tin tài khoản của mọi người
      if (!isAdmin) {
        personnelRows = personnelRows.map((p: any) => ({
          id: p.id, employee_code: p.employee_code, full_name: p.full_name,
          department: p.department, position: p.position, email: p.email, phone: p.phone, status: p.status,
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
      });
    }

    return NextResponse.json({ error: "Hành động không hợp lệ" }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
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
      const { id, employee_code, full_name, department, position, email, phone, status } = body;
      const cleanEmail = email ? String(email).trim().toLowerCase() : "";
      const cleanName = full_name ? String(full_name).trim() : "";
      const role = inferSystemRoleFromPosition(department, position);

      if (id) {
        await query(
          `UPDATE personnel SET full_name=$1, department=$2, position=$3, email=$4, phone=$5, status=$6 WHERE id=$7`,
          [cleanName, department, position, cleanEmail, phone, status || "ACTIVE", id]
        );
        // Automatically sync to users table (chat account)
        await query(
          `UPDATE users SET 
             full_name = $1, 
             department = $2, 
             email = $3,
             role = CASE WHEN role = 'admin' THEN 'admin' ELSE $4 END,
             is_active = $5
           WHERE $6 <> '' AND (username = $6
              OR username = REPLACE(REPLACE($6, 'NV-ABT-', 'ABT'), 'NV-VIA-', 'VIA'))`,
          [cleanName, department, cleanEmail, role, (status !== "INACTIVE"), employee_code || ""]
        );
        await syncSinglePortalUserToFactory({ username: employee_code || "", department, position, role }).catch(() => {});
        await logAudit("UPDATE", "PERSONNEL", `Cập nhật nhân sự & tài khoản chat ${cleanName} (${employee_code})`);
      } else {
        const requestedCode = String(employee_code || "").trim();
        if (requestedCode) {
          const dup = await query("SELECT full_name FROM personnel WHERE employee_code = $1", [requestedCode]);
          if (dup.rows.length > 0) {
            return NextResponse.json({ error: `Mã nhân viên ${requestedCode} đã thuộc về "${dup.rows[0].full_name}". Vui lòng dùng mã khác hoặc sửa hồ sơ hiện có.` }, { status: 409 });
          }
        }
        const code = requestedCode || await nextEmployeeCode();
        await query(
          `INSERT INTO personnel (employee_code, full_name, department, position, email, phone, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [code, cleanName, department, position, cleanEmail, phone, status || "ACTIVE"]
        );
        // Tạo tài khoản đăng nhập tương ứng; không ghi đè tài khoản đã tồn tại
        const ins = await query(
          `INSERT INTO users (username, password_hash, full_name, role, department, email, is_active, must_change_password)
           VALUES ($1, $2, $3, $4, $5, $6, true, true)
           ON CONFLICT (username) DO NOTHING
           RETURNING username`,
          [code, unusablePasswordHash(), cleanName, role, department, cleanEmail]
        );
        const credential = ins.rows.length > 0 ? await assignTemporaryPassword(code, cleanName) : null;
        await syncSinglePortalUserToFactory({ username: code, department, position, role }).catch(() => {});
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
      for (const r of rows) {
        const getVal = (candidates: string[]): string => {
          for (const c of candidates) {
            if (r[c] !== undefined && r[c] !== null && String(r[c]).trim() !== "") {
              return String(r[c]).trim();
            }
          }
          const rowKeys = Object.keys(r);
          for (const cand of candidates) {
            const cleanCand = cand.toLowerCase().replace(/[\s\(\)\*\_]/g, "");
            for (const rk of rowKeys) {
              const cleanRk = rk.toLowerCase().replace(/[\s\(\)\*\_]/g, "");
              if (cleanRk === cleanCand && r[rk] !== undefined && r[rk] !== null && String(r[rk]).trim() !== "") {
                return String(r[rk]).trim();
              }
            }
          }
          return "";
        };

        const empCode = getVal(["Mã nhân viên (*)", "Mã nhân viên", "employee_code", "MaNV", "Mã NV", "Mã"]) || `NV-ABT-${importBatchStamp}-${++importAutoSeq}`;
        const fullName = getVal(["Họ và tên (*)", "Họ và tên", "full_name", "name", "Họ tên"]) || "Nhân viên ABT";
        const email = getVal(["Email (*)", "Email", "email"]) || "";
        const phone = getVal(["Số điện thoại", "phone", "SĐT", "Điện thoại"]);
        const dept = getVal(["Phòng ban (*)", "Phòng ban", "department"]) || "Kinh Doanh";
        const position = getVal(["Chức vụ / Vị trí (*)", "Chức vụ / Vị trí", "Chức vụ", "Vị trí", "position"]) || "Chuyên viên";
        const rawRole = getVal(["Vai trò hệ thống (*)", "Vai trò hệ thống", "Vai Trò Hệ Thống", "Vai trò", "role", "Role"]);
        const statusRaw = (getVal(["Trạng thái", "status"]) || "ACTIVE").toUpperCase();
        const status = statusRaw.includes("NGHỈ") || statusRaw.includes("INACTIVE") ? "INACTIVE" : "ACTIVE";
        const resolvedRole = inferSystemRoleFromPosition(dept, position, rawRole);
        // Mật khẩu khởi tạo / tên đăng nhập ghi trong file (nếu có); mật khẩu luôn phải đổi ở lần đăng nhập đầu
        const providedPassword = getVal(["Mật khẩu khởi tạo", "Mật khẩu", "password"]);
        const providedLoginName = getVal(["Tên đăng nhập (*)", "Tên đăng nhập", "username", "TenDangNhap"]);

        // 1. Upsert into personnel (Single Source of Truth)
        await query(
          `INSERT INTO personnel (employee_code, full_name, department, position, email, phone, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (employee_code) DO UPDATE 
           SET full_name = EXCLUDED.full_name,
               department = EXCLUDED.department,
               position = EXCLUDED.position,
               email = EXCLUDED.email,
               phone = EXCLUDED.phone,
               status = EXCLUDED.status`,
          [empCode, fullName, dept, position, email, phone, status]
        );

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
      await query(`DELETE FROM personnel WHERE id=$1`, [id]);
      if (employee_code && employee_code !== "admin") {
        await query(`
          DELETE FROM users 
          WHERE username = $1 
             OR username = REPLACE(REPLACE($1, 'NV-ABT-', 'ABT'), 'NV-VIA-', 'VIA')
             OR username = REPLACE(REPLACE($1, 'ABT', 'NV-ABT-'), 'VIA', 'NV-VIA-')
        `, [employee_code]);
        await query(`
          DELETE FROM zalo_user_bindings 
          WHERE employee_id = $1 
             OR employee_id = REPLACE(REPLACE($1, 'NV-ABT-', 'ABT'), 'NV-VIA-', 'VIA')
             OR employee_id = REPLACE(REPLACE($1, 'ABT', 'NV-ABT-'), 'VIA', 'NV-VIA-')
        `, [employee_code]).catch(() => {});
      }
      await logAudit("DELETE", "PERSONNEL", `Xóa hồ sơ nhân sự, tài khoản & liên kết Zalo ${full_name || id} (${employee_code || ""})`);
      return NextResponse.json({ success: true });
    }

    if (action === "user") {
      const { id, username, password, full_name, role, department, email, is_active } = body;
      if (id) {
        if (password) {
          await query(
            `UPDATE users SET full_name=$1, role=$2, department=$3, email=$4, is_active=$5, password_hash=$6,
                must_change_password = true, session_version = COALESCE(session_version, 0) + 1 WHERE id=$7`,
            [full_name, role, department, email, is_active !== false, hashPassword(String(password)), id]
          );
        } else {
          await query(
            `UPDATE users SET full_name=$1, role=$2, department=$3, email=$4, is_active=$5,
                session_version = CASE WHEN is_active AND NOT $5 THEN COALESCE(session_version, 0) + 1 ELSE session_version END WHERE id=$6`,
            [full_name, role, department, email, is_active !== false, id]
          );
        }
        // Đồng bộ email sang hồ sơ nhân sự theo mã nhân viên (không theo họ tên để tránh ghi nhầm người trùng tên)
        if (email && username) {
          const cleanEmail = String(email).trim().toLowerCase();
          await query(
            `UPDATE personnel SET email = $1
             WHERE employee_code = REPLACE(REPLACE($2, 'ABT', 'NV-ABT-'), 'VIA', 'NV-VIA-')
                OR employee_code = $2`,
            [cleanEmail, username]
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
      // Mật khẩu do quản trị viên đặt là tạm thời: người dùng phải đổi ở lần đăng nhập kế tiếp; các phiên cũ bị thu hồi
      await query(
        `UPDATE users SET password_hash=$1, must_change_password = true, failed_login_count = 0, locked_until = NULL,
                session_version = COALESCE(session_version, 0) + 1 WHERE id=$2`,
        [hashPassword(String(password)), id]
      );
      await logAudit("RESET_PASSWORD", "USER", `Đổi mật khẩu tài khoản ${username || id}`);
      return NextResponse.json({ success: true });
    }

    if (action === "delete_user") {
      const { id, username } = body;
      if (Number(id) === 1 || Number(id) === Number(me.id)) {
        return NextResponse.json({ error: "Không thể xóa tài khoản Quản trị viên tối cao (Super Admin)" }, { status: 400 });
      }
      await query(`DELETE FROM users WHERE id=$1`, [id]);
      await logAudit("DELETE", "USER", `Xóa tài khoản ${username || id}`);
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
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}



import { NextRequest, NextResponse } from "next/server";
import { query, logAudit, ensurePersonnelTable } from "@/backend/db/db";
import { syncPersonnelToZaloBindings } from "@/backend/db/zaloDb";
import { hashPassword } from "@/backend/services/passwords";
import { getAuthorizedUser, isAdminUser, unauthorizedResponse, forbiddenResponse, setAuditActor } from "@/backend/services/authz";
import { inferSystemRoleFromPosition } from "@/backend/services/permissions";

// Mật khẩu khởi tạo cho tài khoản mới (được băm scrypt khi lưu; người dùng nên đổi ngay sau lần đăng nhập đầu)
const DEFAULT_INITIAL_PASSWORD = "123456";

/** Mã nhân viên tự sinh không trùng (thay cho Date.now() dễ trùng và ghi đè hồ sơ của người khác). */
async function nextEmployeeCode(): Promise<string> {
  const res = await query(
    `SELECT COALESCE(MAX(CAST(SUBSTRING(employee_code FROM 'NV-TBRs?-([0-9]+)$') AS INTEGER)), 0) AS max_seq
       FROM personnel WHERE employee_code ~ '^NV-TBRs?-[0-9]+$'`
  );
  let seq = Number(res.rows[0]?.max_seq || 0) + 1;
  for (;;) {
    const code = `NV-TBRs-${String(seq).padStart(3, "0")}`;
    const exists = await query(
      "SELECT 1 FROM personnel WHERE employee_code = $1 UNION ALL SELECT 1 FROM users WHERE LOWER(username) = LOWER($1) LIMIT 1",
      [code]
    );
    if (exists.rows.length === 0) return code;
    seq++;
  }
}

async function syncPersonnelToUsers() {
  await query(`
    INSERT INTO users (username, password_hash, full_name, role, department, email, is_active)
    SELECT 
      p.employee_code AS username,
      $1 AS password_hash,
      p.full_name,
      CASE 
        WHEN p.department = 'Ban Giám Đốc' OR LOWER(p.position) LIKE '%giám đốc%' THEN 'admin'
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
        WHEN p.department LIKE '%Ứng Dụng%' OR p.department LIKE '%Application%' OR p.department LIKE '%Kỹ Thuật%' THEN 
          CASE WHEN LOWER(p.position) LIKE '%trưởng%' OR LOWER(p.position) LIKE '%head%' THEN 'app_head' ELSE 'app_rep' END
        WHEN p.department = 'Kinh Doanh' OR p.department = 'Marketing' THEN 
          CASE WHEN LOWER(p.position) LIKE '%trưởng%' OR LOWER(p.position) LIKE '%phó%' OR LOWER(p.position) LIKE '%giám đốc%' THEN 'sales_head' ELSE 'sales_rep' END
        ELSE 'sales_rep'
      END AS role,
      p.department,
      p.email,
      CASE WHEN p.status = 'INACTIVE' THEN false ELSE true END AS is_active
    FROM personnel p
    WHERE p.employee_code IS NOT NULL 
      AND p.employee_code != '' 
      AND p.employee_code != 'admin'
    ON CONFLICT (username) DO UPDATE SET
      full_name = EXCLUDED.full_name,
      department = EXCLUDED.department,
      role = CASE WHEN users.role = 'admin' THEN 'admin' ELSE EXCLUDED.role END,
      email = COALESCE(EXCLUDED.email, users.email);
  `, [hashPassword(DEFAULT_INITIAL_PASSWORD)]);
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

      // Chuẩn hóa permissions luôn là object an toàn
      usersRows = (usersRows || []).map(u => {
        let perms = u.permissions;
        if (typeof perms === "string") {
          try { perms = JSON.parse(perms); } catch (e) { perms = {}; }
        }
        return { ...u, permissions: perms && typeof perms === "object" ? perms : {} };
      });

      // If personnel exists but users table is empty or only has admin, automatically sync accounts
      if (isAdmin && personnelRows.length > 0 && usersRows.length <= 1) {
        try {
          await syncPersonnelToUsers();
          const uResRefreshed = await query("SELECT id, username, full_name, role, department, email, avatar, is_active, created_at, permissions FROM users ORDER BY id ASC");
          usersRows = uResRefreshed.rows;
        } catch (syncErr: any) {
          console.warn("Auto-sync users from personnel error:", syncErr?.message);
        }
      }

      try {
        // Nhật ký hệ thống chỉ trả về cho quản trị viên
        const lRes = isAdmin ? await query("SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 100") : { rows: [] as any[] };
        logsRows = lRes.rows;
      } catch (e: any) {
        console.error("Failed to query audit_logs:", e.message);
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
              OR username = REPLACE(REPLACE($6, 'NV-TBR-', 'TBR'), 'NV-VIA-', 'VIA'))`,
          [cleanName, department, cleanEmail, role, (status !== "INACTIVE"), employee_code || ""]
        );
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
        await query(
          `INSERT INTO users (username, password_hash, full_name, role, department, email, is_active)
           VALUES ($1, $2, $3, $4, $5, $6, true)
           ON CONFLICT (username) DO NOTHING`,
          [code, hashPassword(DEFAULT_INITIAL_PASSWORD), cleanName, role, department, cleanEmail]
        );
        await logAudit("CREATE", "PERSONNEL", `Thêm mới nhân sự & tài khoản chat ${cleanName} (${code})`);
      }
      return NextResponse.json({ success: true });
    }

    if (action === "reset_personnel_and_users") {
      await query("DELETE FROM personnel");
      await query("DELETE FROM users WHERE username != 'admin'");
      await query("DELETE FROM zalo_user_bindings WHERE employee_id != 'admin'");
      await query(`
        INSERT INTO users (username, password_hash, full_name, role, department, email, is_active)
        VALUES ('admin', $1, 'Quản Trị Viên Hệ Thống', 'admin', 'Ban Giám Đốc', 'admin@tbrscientific.com', true)
        ON CONFLICT (username) DO UPDATE SET
          full_name = 'Quản Trị Viên Hệ Thống',
          role = 'admin',
          is_active = true
      `, [hashPassword(DEFAULT_INITIAL_PASSWORD)]);
      await query(`
        INSERT INTO app_storage (key, data, updated_at) 
        VALUES ('personnel_reset_done_v1', '{"reset": true}'::jsonb, NOW())
        ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()
      `).catch(() => {});
      await logAudit("RESET", "SETTINGS", "Quản trị viên đã thực hiện Reset toàn bộ danh bạ nhân sự, tài khoản và danh mục Zalo");
      return NextResponse.json({ success: true, message: "Đã làm sạch toàn bộ dữ liệu Nhân sự, Tài khoản và Danh mục Zalo." });
    }

    if (action === "sync_users_from_personnel") {
      await syncPersonnelToUsers();
      await logAudit("SYNC", "SETTINGS", "Quản trị viên đã đồng bộ và khởi tạo tài khoản đăng nhập cho toàn bộ nhân sự");
      return NextResponse.json({ success: true, message: "Đã tự động khởi tạo và đồng bộ tài khoản đăng nhập cho tất cả cán bộ nhân sự!" });
    }

    if (action === "import_personnel_excel") {
      const { rows } = body;
      if (!Array.isArray(rows) || rows.length === 0) {
        return NextResponse.json({ error: "Không có dữ liệu hợp lệ để nạp" }, { status: 400 });
      }

      await ensurePersonnelTable();
      let count = 0;
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

        const empCode = getVal(["Mã nhân viên (*)", "Mã nhân viên", "employee_code", "MaNV", "Mã NV", "Mã"]) || `NV-TBRs-${importBatchStamp}-${++importAutoSeq}`;
        const fullName = getVal(["Họ và tên (*)", "Họ và tên", "full_name", "name", "Họ tên"]) || "Nhân viên TBRs";
        const email = getVal(["Email (*)", "Email", "email"]) || "";
        const phone = getVal(["Số điện thoại", "phone", "SĐT", "Điện thoại"]);
        const dept = getVal(["Phòng ban (*)", "Phòng ban", "department"]) || "Kinh Doanh";
        const position = getVal(["Chức vụ / Vị trí (*)", "Chức vụ / Vị trí", "Chức vụ", "Vị trí", "position"]) || "Chuyên viên";
        const rawRole = getVal(["Vai trò hệ thống (*)", "Vai trò hệ thống", "Vai Trò Hệ Thống", "Vai trò", "role", "Role"]);
        const statusRaw = (getVal(["Trạng thái", "status"]) || "ACTIVE").toUpperCase();
        const status = statusRaw.includes("NGHỈ") || statusRaw.includes("INACTIVE") ? "INACTIVE" : "ACTIVE";
        const resolvedRole = inferSystemRoleFromPosition(dept, position, rawRole);

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

        await query(
          `INSERT INTO users (username, password_hash, full_name, role, department, email, is_active)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (username) DO UPDATE
           SET full_name = EXCLUDED.full_name,
               department = EXCLUDED.department,
               role = CASE WHEN users.role = 'admin' AND $4 != 'admin' THEN 'admin' ELSE EXCLUDED.role END,
               email = COALESCE(NULLIF(EXCLUDED.email, ''), users.email),
               is_active = EXCLUDED.is_active`,
          [empCode, hashPassword(DEFAULT_INITIAL_PASSWORD), fullName, resolvedRole, dept, email, status === "ACTIVE"]
        );

        count++;
      }

      // 2. Automatically sync to users table from personnel
      await syncPersonnelToUsers();

      // 3. Automatically sync to Zalo bindings from personnel
      await syncPersonnelToZaloBindings();

      await logAudit("IMPORT_EXCEL", "PERSONNEL", `Nạp thành công ${count} hồ sơ nhân sự, tự động đồng bộ tài khoản người dùng và Zalo`);

      return NextResponse.json({
        success: true,
        count,
        message: `Đã nạp thành công ${count} nhân sự và tự động kích hoạt tài khoản đăng nhập + liên kết Zalo!`
      });
    }

    if (action === "delete_personnel") {
      const { id, full_name, employee_code } = body;
      await query(`DELETE FROM personnel WHERE id=$1`, [id]);
      if (employee_code && employee_code !== "admin") {
        await query(`
          DELETE FROM users 
          WHERE username = $1 
             OR username = REPLACE(REPLACE($1, 'NV-TBR-', 'TBR'), 'NV-VIA-', 'VIA')
             OR username = REPLACE(REPLACE($1, 'TBR', 'NV-TBR-'), 'VIA', 'NV-VIA-')
        `, [employee_code]);
        await query(`
          DELETE FROM zalo_user_bindings 
          WHERE employee_id = $1 
             OR employee_id = REPLACE(REPLACE($1, 'NV-TBR-', 'TBR'), 'NV-VIA-', 'VIA')
             OR employee_id = REPLACE(REPLACE($1, 'TBR', 'NV-TBR-'), 'VIA', 'NV-VIA-')
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
             WHERE employee_code = REPLACE(REPLACE($2, 'TBR', 'NV-TBR-'), 'VIA', 'NV-VIA-')
                OR employee_code = $2`,
            [cleanEmail, username]
          );
        }
        await logAudit("UPDATE", "USER", `Cập nhật tài khoản ${username || id}`);
      } else {
        await query(
          `INSERT INTO users (username, password_hash, full_name, role, department, email, is_active)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [username, hashPassword(String(password || DEFAULT_INITIAL_PASSWORD)), full_name, role, department, email, is_active !== false]
        );
        await logAudit("CREATE", "USER", `Tạo tài khoản mới ${username}`);
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
      const { id, permissions, username } = body;
      const cleanUsername = String(username || "").trim();
      const numId = (id && !isNaN(Number(id))) ? Number(id) : null;
      const cleanPerms = JSON.stringify(permissions || {});

      // Cập nhật đa tầng an toàn: theo ID số, Username chính thức, hoặc các định dạng mã nhân viên (NV-TBR / TBRs / NV-VIA / VIA)
      const updateRes = await query(
        `UPDATE users 
         SET permissions = $1::jsonb 
         WHERE CASE WHEN $2::int IS NOT NULL THEN id = $2::int
                    ELSE (LOWER(username) = LOWER($3) AND $3 <> '') END`,
        [cleanPerms, numId, cleanUsername]
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



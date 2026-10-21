import { query } from "./db";

let zaloDbInitialized = false;
let zaloDbInitPromise: Promise<{ success: boolean; error?: string }> | null = null;

/**
 * Initializes the database tables for the ZALO Integration Gateway
 */
export async function initZaloDatabase(force = false): Promise<{ success: boolean; error?: string }> {
  if (zaloDbInitialized && !force) {
    return { success: true };
  }
  if (zaloDbInitPromise && !force) {
    return zaloDbInitPromise;
  }

  zaloDbInitPromise = (async () => {
  try {
    // 1. Configuration Table (App ID, Secret Key, OA ID, Director Threshold)
    await query(`
      CREATE TABLE IF NOT EXISTS zalo_config (
        id SERIAL PRIMARY KEY,
        oa_id VARCHAR(100) DEFAULT '398247192834719',
        oa_name VARCHAR(150) DEFAULT 'Công ty TNHH Khoa học TBR (Zalo OA Doanh Nghiệp)',
        app_id VARCHAR(100) DEFAULT '482910481920481',
        secret_key VARCHAR(150) DEFAULT 'tbr_zalo_sec_89f0293a4bc',
        access_token TEXT DEFAULT 'zalo_access_token_demo_valid',
        refresh_token TEXT DEFAULT 'zalo_refresh_token_demo_valid',
        webhook_verify_token VARCHAR(100) DEFAULT 'tbr_webhook_token_2026',
        director_discount_threshold NUMERIC(5,2) DEFAULT 10.00,
        director_phone VARCHAR(50) DEFAULT '0916033652',
        director_zalo_id VARCHAR(100) DEFAULT '',
        is_active BOOLEAN DEFAULT TRUE,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Ensure at least one config record exists
    const configCheck = await query("SELECT COUNT(*) FROM zalo_config");
    if (parseInt(configCheck.rows[0].count) === 0) {
      await query(`
        INSERT INTO zalo_config (
          oa_id, oa_name, app_id, secret_key, access_token, refresh_token,
          webhook_verify_token, director_discount_threshold, director_phone, director_zalo_id
        ) VALUES (
          '398247192834719',
          'Công ty TNHH Khoa học TBR (Zalo OA Doanh Nghiệp)',
          '482910481920481',
          'tbr_zalo_sec_89f0293a4bc',
          'zalo_access_token_demo_valid',
          'zalo_refresh_token_demo_valid',
          'tbr_webhook_token_2026',
          10.00,
          '0916033652',
          ''
        )
      `);
    }

    // 2. User Bindings Table (Maps Zalo User ID <-> Real Personnel)
    await query(`
      CREATE TABLE IF NOT EXISTS zalo_user_bindings (
        id SERIAL PRIMARY KEY,
        personnel_id INTEGER,
        employee_id VARCHAR(50) UNIQUE,
        display_name VARCHAR(150) NOT NULL,
        phone_number VARCHAR(50),
        zalo_user_id VARCHAR(100),
        department VARCHAR(100),
        position VARCHAR(150),
        user_type VARCHAR(30) NOT NULL DEFAULT 'EMPLOYEE',
        role VARCHAR(50) DEFAULT 'STAFF',
        connection_status VARCHAR(40) DEFAULT 'NO_PHONE',
        is_active BOOLEAN DEFAULT FALSE,
        notes TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Ensure schema migrations if table existed before
    try {
      await query("ALTER TABLE zalo_user_bindings ALTER COLUMN zalo_user_id DROP NOT NULL");
      await query("ALTER TABLE zalo_user_bindings ALTER COLUMN phone_number DROP NOT NULL");
      await query("ALTER TABLE zalo_user_bindings ADD COLUMN IF NOT EXISTS personnel_id INTEGER");
      await query("ALTER TABLE zalo_user_bindings ADD COLUMN IF NOT EXISTS position VARCHAR(150)");
      await query("ALTER TABLE zalo_user_bindings ADD COLUMN IF NOT EXISTS connection_status VARCHAR(40) DEFAULT 'NO_PHONE'");
      await query("ALTER TABLE zalo_user_bindings ADD COLUMN IF NOT EXISTS notes TEXT");
      await query("ALTER TABLE zalo_user_bindings ADD COLUMN IF NOT EXISTS link_code_hash VARCHAR(100)");
      await query("ALTER TABLE zalo_user_bindings ADD COLUMN IF NOT EXISTS link_code_expires TIMESTAMPTZ");
      await query("ALTER TABLE zalo_user_bindings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP");
      // ensure employee_id is unique
      await query("CREATE UNIQUE INDEX IF NOT EXISTS idx_zalo_user_bindings_emp_id ON zalo_user_bindings(employee_id)");
    } catch (e) {
      // Ignore if columns/constraints already exist
    }

    // 3. Message & Webhook Logs Table
    await query(`
      CREATE TABLE IF NOT EXISTS zalo_message_logs (
        id SERIAL PRIMARY KEY,
        zalo_user_id VARCHAR(100),
        sender_name VARCHAR(150),
        direction VARCHAR(15) NOT NULL,
        message_type VARCHAR(30) NOT NULL,
        content TEXT,
        intent_detected VARCHAR(50),
        payload JSONB,
        status VARCHAR(20) DEFAULT 'SUCCESS',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Automatically sync real personnel from personnel table if bindings are empty or have mock data
    await syncPersonnelToZaloBindings();

    zaloDbInitialized = true;
    return { success: true };
  } catch (error: any) {
    console.error("Zalo Database Initialization Error:", error);
    return { success: false, error: error.message };
  } finally {
    zaloDbInitPromise = null;
  }
  })();

  return zaloDbInitPromise;
}

/**
 * Synchronizes the real personnel table with Zalo User Bindings.
 * Cleanses mock entries and reflects real employees from `personnel`.
 */
export async function syncPersonnelToZaloBindings() {
  try {
    // 1. Purge legacy mock data if present
    await query(`
      DELETE FROM zalo_user_bindings 
      WHERE employee_id IN ('QL-01', 'KD-01', 'KD-02', 'APP-01', 'KHO-01')
         OR zalo_user_id IN ('zalo_dir_bld_01', 'zalo_sale_kd01', 'zalo_sale_kd02', 'zalo_app_01', 'zalo_wh_01')
    `);

    // 1b. Clean up duplicate ghost records from personnel table if any exist
    await query(`
      DELETE FROM personnel 
      WHERE (employee_code ~ '^TBR[0-9]+$' OR employee_code ~ '^VIA[0-9]+$')
         OR (position = 'admin' AND employee_code != 'admin')
    `).catch(() => {});

    // 1c. Migrate any phone/zalo_user_id from ghost TBRxxx / VIAxxx to official NV- codes
    await query(`
      UPDATE zalo_user_bindings target
      SET 
        zalo_user_id = COALESCE(target.zalo_user_id, src.zalo_user_id),
        phone_number = COALESCE(target.phone_number, src.phone_number)
      FROM zalo_user_bindings src
      WHERE (src.employee_id = REPLACE(REPLACE(target.employee_id, 'NV-TBR-', 'TBR'), 'NV-VIA-', 'VIA'))
        AND src.employee_id != target.employee_id
    `).catch(() => {});

    // 1d. Delete ghost duplicate records and orphaned records from zalo_user_bindings
    await query(`
      DELETE FROM zalo_user_bindings 
      WHERE employee_id ~ '^TBR[0-9]+$' 
         OR employee_id ~ '^VIA[0-9]+$'
         OR employee_id NOT IN (SELECT employee_code FROM personnel WHERE employee_code IS NOT NULL)
    `).catch(() => {});

    // 2. Fetch all real personnel from personnel table
    const personnelRes = await query("SELECT * FROM personnel ORDER BY id ASC");
    const realPersonnel = personnelRes.rows;

    for (const p of realPersonnel) {
      const empCode = (p.employee_code || "").trim();
      if (!empCode) continue;

      const rawPhone = (p.phone || "").trim();
      const cleanPhone = rawPhone.replace(/[^0-9+]/g, "");

      // Determine User Type & Role
      let userType = "EMPLOYEE";
      let role = "STAFF";

      const dept = (p.department || "").trim();
      const pos = (p.position || "").trim();

      if (dept === "Ban Giám Đốc") {
        userType = "DIRECTOR";
        role = "DIRECTOR";
      } else if (
        pos.toLowerCase().includes("trưởng") ||
        pos.toLowerCase().includes("quản lý") ||
        pos.toLowerCase().includes("giám đốc")
      ) {
        userType = "MANAGER";
        role = "HEAD_OF_DEPT";
      } else if (dept === "Kế Toán") {
        role = "ACCOUNTANT";
      } else if (dept === "Kho Vận" || dept.toLowerCase().includes("kho")) {
        role = "WAREHOUSE";
      } else if (dept === "Pháp Chế") {
        role = "LEGAL";
      } else if (dept.includes("Ứng Dụng") || dept.includes("Kỹ Thuật")) {
        role = "APPLICATION";
      } else if (dept === "Kinh Doanh" || dept === "Marketing") {
        role = "SALES_REP";
      }

      // Check connection status:
      // - NO_PHONE: không có số điện thoại (thông báo không kết nối)
      // - PENDING_ZALO: đã có SĐT nhưng chưa liên kết Zalo ID
      // - CONNECTED: đã có cả SĐT và Zalo ID
      let connStatus = "NO_PHONE";
      let isActive = false;

      if (cleanPhone) {
        connStatus = "PENDING_ZALO";
      }

      // Check if this employee already exists in zalo_user_bindings
      const existingRes = await query(
        "SELECT id, zalo_user_id, phone_number, connection_status FROM zalo_user_bindings WHERE employee_id = $1 OR personnel_id = $2",
        [empCode, p.id]
      );

      if (existingRes.rows.length > 0) {
        const existing = existingRes.rows[0];
        // Preserve already linked zalo_user_id if any!
        const existingZaloId = existing.zalo_user_id;
        const currentPhone = cleanPhone || existing.phone_number;

        let finalStatus = "NO_PHONE";
        if (currentPhone) {
          finalStatus = existingZaloId ? "CONNECTED" : "PENDING_ZALO";
        }

        await query(
          `UPDATE zalo_user_bindings SET
            personnel_id = $1,
            display_name = $2,
            department = $3,
            position = $4,
            user_type = $5,
            role = $6,
            phone_number = $7,
            connection_status = $8,
            is_active = $9,
            updated_at = CURRENT_TIMESTAMP
           WHERE id = $10`,
          [
            p.id,
            p.full_name,
            dept,
            pos,
            userType,
            role,
            currentPhone || null,
            finalStatus,
            finalStatus === "CONNECTED",
            existing.id
          ]
        );
      } else {
        // Insert new employee binding
        await query(
          `INSERT INTO zalo_user_bindings (
            personnel_id, employee_id, display_name, phone_number, zalo_user_id,
            department, position, user_type, role, connection_status, is_active
          ) VALUES ($1, $2, $3, $4, NULL, $5, $6, $7, $8, $9, $10)
          ON CONFLICT (employee_id) DO NOTHING`,
          [
            p.id,
            empCode,
            p.full_name,
            cleanPhone || null,
            dept,
            pos,
            userType,
            role,
            connStatus,
            isActive
          ]
        );
      }
    }

    // Update Director phone in zalo_config to CEO Nguyễn Văn Hưng if not already customized
    await query(`
      UPDATE zalo_config 
      SET director_phone = COALESCE(NULLIF(director_phone, ''), '0916033652'),
          director_zalo_id = COALESCE((SELECT zalo_user_id FROM zalo_user_bindings WHERE employee_id = 'NV-TBR-001' AND zalo_user_id IS NOT NULL), director_zalo_id, '')
      WHERE id = 1
    `);

    return { success: true, count: realPersonnel.length };
  } catch (error: any) {
    console.error("Error syncing personnel to Zalo bindings:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Clears mock simulation data (test chats and test quotations)
 */
export async function clearMockZaloData() {
  try {
    // 1. Clear test chat logs
    await query("TRUNCATE TABLE zalo_message_logs RESTART IDENTITY");

    // 2. Delete test quotations created during testing
    await query("DELETE FROM sales_quotations WHERE quote_code LIKE 'BG-TBR-2609-%'");

    // 3. Re-sync personnel
    await syncPersonnelToZaloBindings();

    return { success: true };
  } catch (error: any) {
    console.error("Error clearing mock Zalo data:", error);
    return { success: false, error: error.message };
  }
}


import { query, ensurePersonnelTable } from "@/backend/db/db";
import { hashPassword, generateTemporaryPassword } from "@/backend/services/passwords";
import { inferSystemRoleFromPosition } from "@/backend/services/permissions";
import { grantablePermissions, syncPermissions } from "./core/authz";
import { getFactoryPool, type Tx } from "./core/db";
import "./modules";

export const FACTORY_MODULE_TO_PORTAL_DEPT: Record<string, string> = {
  RD: "Nghiên Cứu R&D",
  KIT: "Sản Xuất Kit",
  OLIGO: "Tổng Hợp Oligo",
  DEVICE: "Kỹ Thuật – Thiết Bị",
  QA: "QA/QC",
  WH: "Kho Vận",
};

export function inferFactoryModuleFromDept(dept?: string | null, role?: string | null): string | null {
  const d = (dept || "").toLowerCase().trim();
  const r = (role || "").toLowerCase().trim();
  if (d.includes("r&d") || d.includes("nghiên cứu") || r.startsWith("rd_")) return "RD";
  if (d.includes("sản xuất kit") || d.includes("sx kit") || r.startsWith("kit_")) return "KIT";
  if (d.includes("oligo") || r.startsWith("oligo_")) return "OLIGO";
  if (d.includes("thiết bị") || d.includes("ứng dụng") || d.includes("application") || r.startsWith("device_") || r.startsWith("app_")) return "DEVICE";
  if (d.includes("qa") || d.includes("qc") || d.includes("chất lượng") || r.startsWith("qa_qc")) return "QA";
  if (d.includes("kho") || d.includes("warehouse") || d.includes("cung ứng") || d.includes("mua hàng") || r.startsWith("warehouse") || r.startsWith("procurement")) return "WH";
  return null;
}

export function inferFactoryRoleCode(moduleKey: string | null, portalRole?: string | null, position?: string | null): string | null {
  if (!moduleKey) return null;
  const r = (portalRole || "").toLowerCase();
  const p = (position || "").toLowerCase();
  const isHead =
    r.includes("head") ||
    r.includes("lead") ||
    r.includes("admin") ||
    r.includes("director") ||
    p.includes("trưởng") ||
    p.includes("quản đốc") ||
    p.includes("phó phòng") ||
    p.includes("giám đốc");
  return `${moduleKey}_${isHead ? "HEAD" : "STAFF"}`;
}

function buildRolePermissions(allCodes: string[], prefixes: string[], isHead: boolean): string[] {
  const commonPrefixes = ["inv.", "master.", "purchase.", "intake.", "asset.", "prep.", "plan."];
  return allCodes.filter((code) => {
    const inPrimary = prefixes.some((pf) => code.startsWith(pf));
    const inCommon = commonPrefixes.some((pf) => code.startsWith(pf));
    if (!inPrimary && !inCommon) return false;
    if (!isHead && (code.endsWith(".approve") || code.endsWith(".release") || code.endsWith(".close") || code.startsWith("core."))) {
      return false;
    }
    return true;
  });
}

const STANDARD_FACTORY_ROLES: { code: string; name: string; desc: string; prefixes: string[]; isHead: boolean }[] = [
  { code: "RD_HEAD", name: "Trưởng phòng Nghiên cứu R&D", desc: "Toàn quyền quản lý đề tài R&D, DHF, mẫu thử, chuyển giao công nghệ và ký duyệt", prefixes: ["rd.", "qms.", "kit.", "oligo."], isHead: true },
  { code: "RD_STAFF", name: "Chuyên viên Nghiên cứu R&D", desc: "Thực hiện thí nghiệm, ghi nhật ký ELN, pha chế mẫu thử và lập đề nghị lĩnh/mua NVL", prefixes: ["rd."], isHead: false },
  { code: "KIT_HEAD", name: "Trưởng phòng / Quản đốc Sản xuất Kit", desc: "Toàn quyền định mức BOM, phát hành lệnh sản xuất Kit, duyệt hồ sơ lô eBR và xuất thành phẩm", prefixes: ["kit.", "qms."], isHead: true },
  { code: "KIT_STAFF", name: "Kỹ thuật viên Sản xuất Kit", desc: "Thực hiện các công đoạn pha chế, chia chuẩn, lắp ráp Kit và ghi nhận hồ sơ lô eBR", prefixes: ["kit."], isHead: false },
  { code: "OLIGO_HEAD", name: "Trưởng phòng Tổng hợp Oligo", desc: "Toàn quyền nhận đơn Oligo, lập mẻ tổng hợp CPG, duyệt QC OD/HPLC/PAGE và giao hàng", prefixes: ["oligo.", "qms."], isHead: true },
  { code: "OLIGO_STAFF", name: "Kỹ thuật viên Tổng hợp Oligo", desc: "Vận hành máy tổng hợp CPG, cắt khử bảo vệ, tinh sạch HPLC/PAGE và đo OD", prefixes: ["oligo."], isHead: false },
  { code: "DEVICE_HEAD", name: "Trưởng phòng Kỹ thuật – Thiết bị", desc: "Toàn quyền quản lý dòng máy, DMR, phát hành lệnh lắp ráp DHR, FQC và bảo hành RMA", prefixes: ["device.", "qms."], isHead: true },
  { code: "DEVICE_STAFF", name: "Kỹ sư Lắp ráp Thiết bị & FSE", desc: "Thực hiện lắp ráp trạm cơ khí/điện tử/firmware, chạy già hóa Burn-in và xử lý ca bảo hành", prefixes: ["device."], isHead: false },
  { code: "QA_HEAD", name: "Trưởng phòng QA/QC (ISO 13485)", desc: "Toàn quyền thẩm định QC, giải phóng lô, cấp COA, phê duyệt tài liệu SOP và đóng NCR/CAPA", prefixes: ["qms.", "kit.", "oligo.", "device.", "rd."], isHead: true },
  { code: "QA_STAFF", name: "Chuyên viên Kiểm nghiệm QC/QA", desc: "Lấy mẫu kiểm nghiệm IQC/IPQC/OQC, ghi nhận kết quả QC và lập báo cáo sự cố NCR", prefixes: ["qms."], isHead: false },
  { code: "WH_HEAD", name: "Trưởng bộ phận Kho & Cung ứng Nhà máy", desc: "Toàn quyền điều phối kho nhà máy, duyệt cấp phát FEFO, kiểm kê và duyệt PR/PO nội bộ", prefixes: ["inv.", "master.", "purchase.", "intake."], isHead: true },
  { code: "WH_STAFF", name: "Thủ kho / Chuyên viên Cung ứng Nhà máy", desc: "Thực hiện nhập kho, xuất cấp phát NVL theo lô FEFO và lập đơn mua hàng", prefixes: ["inv.", "master.", "purchase.", "intake."], isHead: false },
];

export async function ensureFactoryRolesAndSyncAllUsers(tx?: Tx): Promise<void> {
  const db: { query: (sql: string, params?: any[]) => Promise<{ rows: any[]; rowCount: number | null }> } = tx ?? getFactoryPool();

  await syncPermissions(db as Tx);
  const allGrantable = grantablePermissions();

  // 1. Ensure standard factory roles exist in core.role
  const roleIdByCode: Record<string, string> = {};
  for (const r of STANDARD_FACTORY_ROLES) {
    const perms = buildRolePermissions(allGrantable, r.prefixes, r.isHead);
    const up = await db.query(
      `INSERT INTO core.role (code, name, description, status, created_by)
       VALUES ($1, $2, $3, 'ACTIVE', 1)
       ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, status = 'ACTIVE'
       RETURNING id`,
      [r.code, r.name, r.desc]
    );
    const roleId = up.rows[0].id;
    roleIdByCode[r.code] = roleId;

    const existingPermsCount = Number(
      (await db.query("SELECT count(*)::int AS c FROM core.role_permission WHERE role_id = $1", [roleId])).rows[0]?.c ?? 0
    );
    if (existingPermsCount === 0 && perms.length > 0) {
      await db.query(
        "INSERT INTO core.role_permission (role_id, permission_code) SELECT $1, unnest($2::text[]) ON CONFLICT DO NOTHING",
        [roleId, perms]
      );
    }
  }

  await ensurePersonnelTable();

  // 2. Map core.org_unit by module_key
  const orgUnits = (await db.query("SELECT id, code, module_key, name FROM core.org_unit WHERE status = 'ACTIVE'")).rows;
  const orgIdByModule: Record<string, string> = {};
  for (const o of orgUnits) {
    if (o.module_key) orgIdByModule[o.module_key] = o.id;
  }

  // 3. Sync all portal users -> core.user_profile + core.user_role
  const usersRes = await query(
    `SELECT u.id, u.username, u.full_name, u.department, u.role, u.is_active, p.position
       FROM users u
       LEFT JOIN personnel p ON LOWER(p.employee_code) = LOWER(u.username)
      WHERE u.role <> 'customer'`
  );

  const activeUserIds: number[] = [];
  for (const u of usersRes.rows) {
    const userId = Number(u.id);
    activeUserIds.push(userId);
    const modKey = inferFactoryModuleFromDept(u.department, u.role);
    const targetOrgId = modKey ? orgIdByModule[modKey] ?? null : null;

    await db.query(
      `INSERT INTO core.user_profile (user_id, display_name, org_unit_id, pin_hash, status)
       VALUES ($1, $2, $3, NULL, $4)
       ON CONFLICT (user_id) DO UPDATE SET
         display_name = EXCLUDED.display_name,
         org_unit_id = COALESCE(core.user_profile.org_unit_id, EXCLUDED.org_unit_id),
         status = EXCLUDED.status`,
      [userId, u.full_name || u.username, targetOrgId, u.is_active === false ? "INACTIVE" : "ACTIVE"]
    );

    const fRoleCode = inferFactoryRoleCode(modKey, u.role, u.position);
    const roleId = fRoleCode ? roleIdByCode[fRoleCode] : null;
    if (roleId) {
      const hasGrant = await db.query(
        "SELECT 1 FROM core.user_role WHERE user_id = $1 AND role_id = $2 AND revoked_at IS NULL LIMIT 1",
        [userId, roleId]
      );
      if (!hasGrant.rowCount) {
        await db.query(
          `INSERT INTO core.user_role (user_id, role_id, scope_org_unit_id, granted_by)
           VALUES ($1, $2, $3, 1)`,
          [userId, roleId, targetOrgId]
        );
      }
    }
  }

  // Prune orphan factory profiles & roles for deleted portal users
  if (activeUserIds.length > 0) {
    await db.query("DELETE FROM core.user_role WHERE NOT (user_id = ANY($1::int[]))", [activeUserIds]);
    await db.query("DELETE FROM core.user_profile WHERE NOT (user_id = ANY($1::int[]))", [activeUserIds]);
  }
}

export async function syncSinglePortalUserToFactory(opts: {
  username?: string;
  userId?: number;
  department?: string;
  position?: string;
  role?: string;
}): Promise<void> {
  const pool = getFactoryPool();
  let userRow: any = null;
  if (opts.userId) {
    userRow = (await query("SELECT id, username, full_name, department, role, is_active FROM users WHERE id = $1", [opts.userId])).rows[0];
  } else if (opts.username) {
    userRow = (
      await query(
        `SELECT id, username, full_name, department, role, is_active FROM users
          WHERE LOWER(username) = LOWER($1)
             OR LOWER(username) = LOWER(REPLACE(REPLACE($1, 'NV-ABT-', 'ABT'), 'NV-VIA-', 'VIA'))
          LIMIT 1`,
        [opts.username]
      )
    ).rows[0];
  }
  if (!userRow) return;

  const dept = opts.department ?? userRow.department;
  const role = opts.role ?? userRow.role;
  const modKey = inferFactoryModuleFromDept(dept, role);
  const orgRow = modKey
    ? (await pool.query("SELECT id FROM core.org_unit WHERE module_key = $1 AND status = 'ACTIVE' LIMIT 1", [modKey])).rows[0]
    : null;
  const orgUnitId = orgRow?.id ?? null;

  await pool.query(
    `INSERT INTO core.user_profile (user_id, display_name, org_unit_id, pin_hash, status)
     VALUES ($1, $2, $3, NULL, $4)
     ON CONFLICT (user_id) DO UPDATE SET
       display_name = EXCLUDED.display_name,
       org_unit_id = COALESCE($3, core.user_profile.org_unit_id),
       status = EXCLUDED.status,
       updated_at = now()`,
    [Number(userRow.id), userRow.full_name || userRow.username, orgUnitId, userRow.is_active === false ? "INACTIVE" : "ACTIVE"]
  );

  const fRoleCode = inferFactoryRoleCode(modKey, role, opts.position);
  if (fRoleCode) {
    const roleRow = (await pool.query("SELECT id FROM core.role WHERE code = $1 AND status = 'ACTIVE' LIMIT 1", [fRoleCode])).rows[0];
    if (roleRow) {
      const exists = await pool.query(
        "SELECT 1 FROM core.user_role WHERE user_id = $1 AND role_id = $2 AND revoked_at IS NULL LIMIT 1",
        [Number(userRow.id), roleRow.id]
      );
      if (!exists.rowCount) {
        await pool.query(
          "INSERT INTO core.user_role (user_id, role_id, scope_org_unit_id, granted_by) VALUES ($1, $2, $3, 1)",
          [Number(userRow.id), roleRow.id, orgUnitId]
        );
      }
    }
  }
}

export async function syncFactoryOrgUnitToPortal(tx: Tx, userId: number, orgUnitId: string | null): Promise<void> {
  if (!orgUnitId) return;
  const org = (await tx.query("SELECT code, name, module_key FROM core.org_unit WHERE id = $1", [orgUnitId])).rows[0];
  if (!org) return;
  const portalDept = (org.module_key && FACTORY_MODULE_TO_PORTAL_DEPT[org.module_key]) || org.name;
  const uRes = await query("UPDATE users SET department = $1 WHERE id = $2 RETURNING username", [portalDept, userId]);
  const username = uRes.rows[0]?.username;
  if (username) {
    await query(
      `UPDATE personnel SET department = $1
        WHERE LOWER(employee_code) = LOWER($2)
           OR LOWER(employee_code) = LOWER(REPLACE(REPLACE($2, 'ABT', 'NV-ABT-'), 'VIA', 'NV-VIA-'))`,
      [portalDept, username]
    );
  }
}

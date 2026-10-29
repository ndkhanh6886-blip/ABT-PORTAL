import type { Tx } from "./db";

/**
 * Starting roles (configuration, not demo data). Created only when missing, never modified afterwards:
 * once a role exists, administrators own its permissions in Cấu hình Nhà Máy.
 * Grant them with a department scope to limit them to that department's warehouses.
 */
export const DEFAULT_ROLES: { code: string; name: string; description: string; permissions: string[] }[] = [
  {
    code: "XEM_KHO",
    name: "Xem kho",
    description: "Xem danh mục và tồn kho theo lô.",
    permissions: ["master.data.view", "inv.stock.view"],
  },
  {
    code: "THU_KHO",
    name: "Thủ kho",
    description: "Lập và ghi sổ phiếu kho, giữ chỗ tồn kho.",
    permissions: ["master.data.view", "inv.stock.view", "inv.document.create", "inv.document.post", "inv.reservation.manage"],
  },
  {
    code: "TRUONG_KHO",
    name: "Trưởng kho",
    description: "Thủ kho, cộng đảo phiếu, quản lý danh mục vật tư, kho và vị trí.",
    permissions: [
      "master.data.view",
      "master.item.manage",
      "master.warehouse.manage",
      "inv.stock.view",
      "inv.document.create",
      "inv.document.post",
      "inv.document.reverse",
      "inv.reservation.manage",
    ],
  },
  {
    code: "QC_ANALYST",
    name: "Kiểm nghiệm viên QC",
    description: "Lấy mẫu QC cho lô.",
    permissions: ["master.data.view", "inv.stock.view", "inv.lot.sample"],
  },
  {
    code: "QA_RELEASER",
    name: "QA giải phóng lô",
    description: "Giải phóng, tạm giữ, loại lô (cần chữ ký điện tử).",
    permissions: ["master.data.view", "inv.stock.view", "inv.lot.release", "inv.lot.hold", "inv.lot.reject"],
  },
  {
    code: "MUA_HANG_NVL",
    name: "Cung ứng NVL",
    description: "Quản lý nhà cung cấp và xem danh mục vật tư.",
    permissions: ["master.data.view", "master.partner.manage", "inv.stock.view"],
  },
  {
    code: "QUAN_TRI_NHA_MAY",
    name: "Quản trị nhà máy",
    description: "Cơ cấu tổ chức, vai trò, cấp quyền, mẫu mã số, tham số, xem audit trail.",
    permissions: ["core.org.manage", "core.role.manage", "core.sequence.manage", "core.setting.manage", "core.audit.view"],
  },
];

export async function ensureDefaultRoles(tx: Tx): Promise<string[]> {
  const created: string[] = [];
  for (const r of DEFAULT_ROLES) {
    const ins = await tx.query(
      "INSERT INTO core.role (code, name, description) VALUES ($1, $2, $3) ON CONFLICT (code) DO NOTHING RETURNING id",
      [r.code, r.name, r.description]
    );
    if (!ins.rowCount) continue;
    await tx.query("INSERT INTO core.role_permission (role_id, permission_code) SELECT $1, unnest($2::text[])", [ins.rows[0].id, r.permissions]);
    created.push(r.code);
  }
  return created;
}

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
    description: "Lập và ghi sổ phiếu kho, giữ chỗ tồn kho, nhận hàng mua vào kho.",
    permissions: ["master.data.view", "inv.stock.view", "inv.document.create", "inv.document.post", "inv.reservation.manage", "purchase.receipt.post"],
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
      "purchase.receipt.post",
    ],
  },
  {
    code: "QC_ANALYST",
    name: "Kiểm nghiệm viên QC",
    description: "Lấy mẫu QC cho lô, thực hiện kiểm nghiệm và nhập kết quả.",
    permissions: ["master.data.view", "inv.stock.view", "inv.lot.sample", "qms.qc.view", "qms.qc.analyze", "qms.deviation.report"],
  },
  {
    code: "QA_RELEASER",
    name: "QA giải phóng lô",
    description: "Duyệt kết quả QC, phê duyệt tiêu chuẩn, giải phóng / tạm giữ / loại lô (cần chữ ký điện tử).",
    permissions: [
      "master.data.view",
      "inv.stock.view",
      "inv.lot.release",
      "inv.lot.hold",
      "inv.lot.reject",
      "qms.qc.view",
      "qms.qc.review",
      "qms.qc.lead",
      "qms.spec.approve",
      "qms.deviation.report",
    ],
  },
  {
    code: "QA_SOAN_TIEU_CHUAN",
    name: "Soạn tiêu chuẩn QC",
    description: "Soạn bản nháp tiêu chuẩn QC và phiên bản mới.",
    permissions: ["master.data.view", "qms.qc.view", "qms.spec.manage"],
  },
  {
    code: "MUA_HANG_NVL",
    name: "Cung ứng NVL",
    description: "Quản lý nhà cung cấp, xử lý đề nghị mua đã duyệt, lập và phát hành đơn mua NVL.",
    permissions: ["master.data.view", "master.partner.manage", "inv.stock.view", "purchase.pr.view", "purchase.po.view", "purchase.po.manage"],
  },
  {
    code: "NHAN_VIEN_PHONG",
    name: "Nhân viên phòng (đề nghị mua)",
    description: "Lập đề nghị mua NVL cho phòng. Cấp với phạm vi phòng.",
    permissions: ["master.data.view", "inv.stock.view", "purchase.pr.view", "purchase.pr.create"],
  },
  {
    code: "TRUONG_PHONG",
    name: "Trưởng phòng",
    description: "Lập và duyệt đề nghị mua NVL của phòng. Cấp với phạm vi phòng.",
    permissions: ["master.data.view", "inv.stock.view", "purchase.pr.view", "purchase.pr.create", "purchase.pr.approve"],
  },
  {
    code: "BAN_GIAM_DOC",
    name: "Ban giám đốc",
    description: "Duyệt đề nghị mua vượt ngưỡng (ký điện tử), xem đề nghị và đơn mua.",
    permissions: ["master.data.view", "inv.stock.view", "purchase.pr.view", "purchase.pr.approve", "purchase.pr.approve_bod", "purchase.po.view"],
  },
  {
    code: "QUAN_TRI_NHA_MAY",
    name: "Quản trị nhà máy",
    description: "Cơ cấu tổ chức, vai trò, cấp quyền, mẫu mã số, tham số, xem audit trail.",
    permissions: ["core.org.manage", "core.role.manage", "core.sequence.manage", "core.setting.manage", "core.audit.view"],
  },
];

/**
 * Creates missing default roles. A default role nobody has edited yet (no "update" in its audit trail)
 * also receives permissions added to its definition in later releases; an edited role is left as is.
 */
export async function ensureDefaultRoles(tx: Tx): Promise<string[]> {
  const changed: string[] = [];
  for (const r of DEFAULT_ROLES) {
    const ins = await tx.query(
      "INSERT INTO core.role (code, name, description) VALUES ($1, $2, $3) ON CONFLICT (code) DO NOTHING RETURNING id",
      [r.code, r.name, r.description]
    );
    if (ins.rowCount) {
      await tx.query("INSERT INTO core.role_permission (role_id, permission_code) SELECT $1, unnest($2::text[])", [ins.rows[0].id, r.permissions]);
      changed.push(r.code);
      continue;
    }
    const role = (await tx.query("SELECT id FROM core.role WHERE code = $1", [r.code])).rows[0];
    const edited = await tx.query("SELECT 1 FROM core.audit_log WHERE entity_type = 'role' AND entity_id = $1 AND action = 'update' LIMIT 1", [role.id]);
    if (edited.rowCount) continue;
    const added = await tx.query(
      "INSERT INTO core.role_permission (role_id, permission_code) SELECT $1, unnest($2::text[]) ON CONFLICT DO NOTHING RETURNING permission_code",
      [role.id, r.permissions]
    );
    if (added.rowCount) changed.push(`${r.code} (+${added.rowCount} quyền)`);
  }
  return changed;
}

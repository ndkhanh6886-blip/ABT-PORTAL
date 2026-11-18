import { registerPermissions } from "../core/authz";

/**
 * Phòng IT (Khối Kinh doanh) has its own permission set, separate from Khối Kỹ thuật.
 * Software projects and releases of P-IT are stored in the shared project tables (rd.*), but every check on a
 * record owned by P-IT asks for the `it.*` permission below instead of the `rd.*` one (see `IT_PERMISSION_FOR`
 * in core/authz): IT staff never need an R&D permission, and R&D / KTCN permissions never open an IT record.
 */
registerPermissions([
  { code: "it.view", description: "Xem Phòng IT: dự án phần mềm, vòng đời phát triển và bản phát hành phần mềm của Phòng IT" },
  { code: "it.project.manage", description: "Quản lý dự án phần mềm Phòng IT: thành viên, yêu cầu – test case – lỗi, cột mốc và nộp hồ sơ cổng Gate" },
  { code: "it.project.edit", description: "Chỉnh sửa thông tin dự án phần mềm Phòng IT (tên, chủ nhiệm, ngân sách, tiến độ, trạng thái)" },
  { code: "it.project.delete", description: "Xóa dự án phần mềm Phòng IT khỏi hệ thống (ghi nhật ký kiểm toán)", gxpCritical: true },
  { code: "it.gate.review", description: "Hội đồng duyệt cổng Stage-Gate dự án phần mềm Phòng IT (GO / RECYCLE / HOLD / KILL)", gxpCritical: true },
  { code: "it.transfer.manage", description: "Lập bản phát hành phần mềm (bản nháp) và gói bàn giao của Phòng IT", gxpCritical: true },
  { code: "it.software.release", description: "Ký phê duyệt phát hành / thu hồi phiên bản phần mềm của Phòng IT (Trưởng phòng IT hoặc Ban Giám Đốc)", gxpCritical: true },
]);

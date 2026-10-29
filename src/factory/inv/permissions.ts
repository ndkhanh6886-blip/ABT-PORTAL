import { registerPermissions } from "../core/authz";

// Warehouse permissions are checked against the warehouse's owning org unit (a role scoped to a
// department covers that department's warehouses; a company-wide role covers all of them).
registerPermissions([
  { code: "inv.stock.view", description: "Xem tồn kho, lô, thẻ kho" },
  { code: "inv.document.create", description: "Lập phiếu kho (nháp)" },
  { code: "inv.document.post", description: "Ghi sổ phiếu kho", gxpCritical: true },
  { code: "inv.document.reverse", description: "Đảo phiếu kho đã ghi sổ", gxpCritical: true },
  { code: "inv.reservation.manage", description: "Giữ chỗ / bỏ giữ chỗ tồn kho" },
  { code: "inv.lot.sample", description: "Lấy mẫu QC cho lô" },
  { code: "inv.lot.release", description: "Giải phóng lô (QA)", gxpCritical: true },
  { code: "inv.lot.hold", description: "Tạm giữ lô (QA)", gxpCritical: true },
  { code: "inv.lot.reject", description: "Loại lô không đạt (QA)", gxpCritical: true },
  { code: "inv.lot.system", description: "Chuyển trạng thái lô tự động (hệ thống)", systemOnly: true },
]);

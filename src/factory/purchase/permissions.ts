import { registerPermissions } from "../core/authz";

// Request permissions are checked against the requesting department (role scope);
// receipt permission against the owner of the receiving warehouse.
registerPermissions([
  { code: "purchase.pr.view", description: "Xem đề nghị mua NVL" },
  { code: "purchase.pr.create", description: "Lập, gửi, hủy đề nghị mua NVL của phòng" },
  { code: "purchase.pr.approve", description: "Trưởng phòng duyệt / trả lại / từ chối đề nghị mua" },
  { code: "purchase.pr.approve_bod", description: "Ban giám đốc duyệt đề nghị mua vượt ngưỡng (ký điện tử)", gxpCritical: true },
  { code: "purchase.po.view", description: "Xem đơn mua NVL" },
  { code: "purchase.po.manage", description: "Lập, phát hành, hủy, đóng đơn mua NVL" },
  { code: "purchase.receipt.post", description: "Nhận hàng theo đơn mua vào kho (biệt trữ)" },
  { code: "purchase.system", description: "Cập nhật trạng thái mua hàng tự động", systemOnly: true },
]);

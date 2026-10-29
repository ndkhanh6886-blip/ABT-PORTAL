import { registerPermissions } from "../core/authz";

// Scoped to the producing department (KIT / OLIGO / DEVICE org unit).
registerPermissions([
  { code: "intake.order.view", description: "Xem đơn nội bộ từ Kinh doanh" },
  { code: "intake.order.accept", description: "Nhận / từ chối đơn nội bộ, cam kết ngày giao (trưởng phòng, ký điện tử)", gxpCritical: true },
  { code: "intake.order.manage", description: "Cập nhật tiến độ, đổi ngày giao đơn nội bộ" },
  { code: "intake.shipment.post", description: "Xuất giao hàng cho Kinh doanh / giao thẳng khách" },
  { code: "intake.system", description: "Cập nhật đơn nội bộ tự động", systemOnly: true },
]);

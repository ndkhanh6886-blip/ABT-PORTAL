import { registerPermissions } from "../core/authz";

registerPermissions([
  { code: "device.view", description: "Xem model thiết bị, hồ sơ DMR/DHR, lệnh lắp ráp, gia công ngoài và dịch vụ bảo hành" },
  { code: "device.model.manage", description: "Quản lý model thiết bị, phiên bản thiết kế DMR, cấu trúc BOM 4 trạm", gxpCritical: true },
  { code: "device.eco.propose", description: "Đề xuất yêu cầu thay đổi kỹ thuật (ECO) và đánh giá ảnh hưởng" },
  { code: "device.eco.approve", description: "Hội đồng phê duyệt và ban hành hiệu lực thay đổi kỹ thuật (ECO)", gxpCritical: true },
  { code: "device.order.manage", description: "Tiếp nhận, phê duyệt lệnh lắp ráp thiết bị và cấp số serial sản xuất", gxpCritical: true },
  { code: "device.assembly.execute", description: "Thực hiện lắp ráp linh kiện theo trạm (DHR), nạp firmware, chạy lão hóa (Burn-in) và FQC" },
  { code: "device.unit.release", description: "QA ký giải phóng xuất xưởng máy theo số serial (FQC & DHR đạt)", gxpCritical: true },
  { code: "device.subcontract.manage", description: "Quản lý chi tiết gia công ngoài, đơn gia công, IQC dung sai và chấm điểm nhà cung cấp" },
  { code: "device.service.manage", description: "Quản lý phiếu bảo hành, bảo trì định kỳ, sửa chữa thiết bị và cập nhật DHR hậu mãi" },
]);

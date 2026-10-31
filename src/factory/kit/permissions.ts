import { registerPermissions } from "../core/authz";

registerPermissions([
  { code: "kit.view", description: "Xem định mức BOM, quy trình Routing, lệnh sản xuất Kit, hồ sơ lô EBR, COA, mẫu lưu và độ ổn định" },
  { code: "kit.bom.manage", description: "Soạn thảo định mức BOM nhiều cấp, cấu trúc đóng gói hộp/ống và quy trình công đoạn (Routing)" },
  { code: "kit.bom.approve", description: "Phê duyệt và ban hành hiệu lực BOM / Routing sản xuất Kit (cần chữ ký điện tử)", gxpCritical: true },
  { code: "kit.order.manage", description: "Lập, xác nhận lệnh sản xuất Kit (giữ chỗ FEFO, cấp mã lô), xuất vật tư và điều phối lệnh làm lại" },
  { code: "kit.ebr.execute", description: "Thực hiện công đoạn sản xuất trong Hồ sơ lô điện tử (EBR), ghi thông số và ký thực hiện", gxpCritical: true },
  { code: "kit.ebr.check", description: "Ký kiểm tra độc lập bước trọng yếu trong Hồ sơ lô điện tử (EBR — người kiểm tra ≠ người thực hiện)", gxpCritical: true },
  { code: "kit.order.release", description: "QA ký giải phóng lô Kit thành phẩm (nhập kho, ghi gia phả lô và phát hành COA bất biến)", gxpCritical: true },
  { code: "kit.rework.manage", description: "Lập, duyệt và thực hiện lệnh làm lại một phần / toàn bộ (Rework) lô Kit", gxpCritical: true },
  { code: "kit.quality.manage", description: "Quản lý mẫu lưu đối chứng (Retain Sample) và nghiên cứu độ ổn định (Stability Study) của lô Kit" },
]);

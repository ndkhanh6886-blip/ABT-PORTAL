import { registerPermissions } from "../core/authz";

registerPermissions([
  { code: "qms.qc.view", description: "Xem phiếu QC, tiêu chuẩn, sai lệch, NCR" },
  { code: "qms.spec.manage", description: "Soạn tiêu chuẩn QC (bản nháp)" },
  { code: "qms.spec.approve", description: "Phê duyệt cho tiêu chuẩn QC có hiệu lực", gxpCritical: true },
  { code: "qms.qc.analyze", description: "Thực hiện kiểm nghiệm, nhập kết quả QC" },
  { code: "qms.qc.review", description: "Xem xét và ký duyệt kết quả QC", gxpCritical: true },
  { code: "qms.qc.lead", description: "Hủy phiếu QC, yêu cầu kiểm lại" },
  { code: "qms.deviation.report", description: "Báo cáo sai lệch" },
]);

import { registerPermissions } from "../core/authz";

registerPermissions([
  { code: "qms.qc.view", description: "Xem phiếu QC, tiêu chuẩn, sai lệch, NCR" },
  { code: "qms.spec.manage", description: "Soạn tiêu chuẩn QC (bản nháp)" },
  { code: "qms.spec.approve", description: "Phê duyệt cho tiêu chuẩn QC có hiệu lực", gxpCritical: true },
  { code: "qms.qc.analyze", description: "Thực hiện kiểm nghiệm, nhập kết quả QC" },
  { code: "qms.qc.review", description: "Xem xét và ký duyệt kết quả QC", gxpCritical: true },
  { code: "qms.qc.lead", description: "Hủy phiếu QC, yêu cầu kiểm lại" },
  { code: "qms.deviation.report", description: "Báo cáo sai lệch" },
  { code: "qms.ncr.propose", description: "Đề xuất hướng xử lý NCR, điều tra sai lệch (trưởng bộ phận)" },
  { code: "qms.ncr.approve", description: "QA duyệt hướng xử lý NCR, đóng NCR / sai lệch (ký điện tử)", gxpCritical: true },
  { code: "qms.ncr.approve_bod", description: "Ban giám đốc duyệt chấp nhận đặc cách (ký điện tử)", gxpCritical: true },
  { code: "qms.doc.manage", description: "Soạn thảo, trình duyệt tài liệu kiểm soát SOP/WI và ghi nhận hồ sơ đào tạo" },
  { code: "qms.doc.approve", description: "Phê duyệt ban hành tài liệu kiểm soát SOP/WI có hiệu lực", gxpCritical: true },
]);

import { registerPermissions } from "../core/authz";

registerPermissions([
  { code: "rd.view", description: "Xem phễu ý tưởng, dự án Stage-Gate, ELN, mẫu sinh học và lộ trình R&D" },
  { code: "rd.idea.propose", description: "Đề xuất ý tưởng mới và gửi vào phễu R&D" },
  { code: "rd.idea.evaluate", description: "Chấm điểm hội đồng kỹ thuật / kinh doanh cho ý tưởng R&D" },
  { code: "rd.idea.approve", description: "Duyệt hoặc từ chối ý tưởng R&D, chuyển ý tưởng thành dự án", gxpCritical: true },
  { code: "rd.project.manage", description: "Quản lý dự án R&D, thành viên, thông số mục tiêu (TPP), cột mốc và nộp hồ sơ cổng Gate" },
  { code: "rd.gate.review", description: "Hội đồng duyệt cổng Stage-Gate (GO / RECYCLE / HOLD / KILL)", gxpCritical: true },
  { code: "rd.eln.write", description: "Lập thí nghiệm ELN, ghi nhật ký, xuất nguyên liệu R&D, gửi duyệt" },
  { code: "rd.eln.approve", description: "Phê duyệt sổ thí nghiệm điện tử (ELN) bằng chữ ký điện tử", gxpCritical: true },
  { code: "rd.sample.manage", description: "Quản lý mẫu sinh học Biobank (nhập mẫu, rã đông, sử dụng, hủy mẫu)" },
  { code: "rd.transfer.manage", description: "Lập gói chuyển giao công nghệ và lập bản phát hành phần mềm (bản nháp)", gxpCritical: true },
  { code: "rd.software.release", description: "Ký phê duyệt phát hành / thu hồi phiên bản phần mềm (Trưởng phòng chủ trì dự án — KTCN hoặc R&D — hoặc Ban Giám Đốc)", gxpCritical: true },
  { code: "rd.transfer.accept", description: "Phòng nhận ký nghiệm thu gói chuyển giao công nghệ từ R&D", gxpCritical: true },
  { code: "work.plan.submit", description: "Lập kế hoạch tuần cá nhân, gửi duyệt và ghi kết quả công việc" },
  { code: "work.plan.approve", description: "Trưởng bộ phận duyệt kế hoạch tuần, nhận xét và chấm điểm hiệu quả" },
]);

/**
 * Khối Kỹ thuật – Nhà máy in the portal "Ma trận thông báo" (shared by the settings screen and the server).
 * Each factory notice type is one matrix event keyed `factory_<type>`; the server always notifies its built-in
 * recipients (the department that must act), the matrix can switch the event off or add recipient groups.
 */

/** Recipient groups of the technical block: everyone holding the permission in any department. */
export const TECHNICAL_MATRIX_ROLES: { code: string; label: string; short: string; permission: string }[] = [
  { code: "factory_rd", label: "Phòng Nghiên cứu R&D", short: "R&D", permission: "rd.view" },
  { code: "factory_kit", label: "Phòng Sản xuất Kit", short: "SX Kit", permission: "kit.view" },
  { code: "factory_oligo", label: "Phòng Tổng hợp Oligo", short: "Oligo", permission: "oligo.view" },
  { code: "factory_device", label: "Phòng Kỹ thuật – Thiết bị", short: "KT–Thiết bị", permission: "device.view" },
  { code: "factory_qa", label: "QA/QC Nhà máy", short: "QA/QC NM", permission: "qms.qc.view" },
  { code: "factory_wh", label: "Kho Nhà máy", short: "Kho NM", permission: "inv.stock.view" },
  { code: "factory_purchase", label: "Mua hàng Nhà máy", short: "Mua hàng NM", permission: "purchase.po.view" },
  { code: "factory_intake", label: "Điều phối Đơn Nội Bộ", short: "Đơn nội bộ", permission: "intake.order.accept" },
];

export const factoryNoticeKey = (type: string) => `factory_${type.toLowerCase()}`;

/**
 * Workflow steps that notify whoever must act next: `notify` holders in the record's department (company-wide
 * holders too). Sent from the outbox event `<entity>.<action>`, never to the person who did the step.
 */
export const TRANSITION_NOTICES: { entity: string; action: string; notify: string; dept: string; name: string; description: string }[] = [
  // Nghiên cứu R&D
  { entity: "rd_idea", action: "submit", notify: "rd.idea.evaluate", dept: "Nghiên cứu R&D", name: "Ý tưởng mới chờ đánh giá", description: "Nhân sự gửi ý tưởng sản phẩm / cải tiến. Mặc định gửi người đánh giá ý tưởng." },
  { entity: "rd_idea", action: "complete_evaluation", notify: "rd.idea.approve", dept: "Nghiên cứu R&D", name: "Ý tưởng đã đánh giá — chờ phê duyệt", description: "Đánh giá khả thi / chấm điểm xong. Mặc định gửi người phê duyệt ý tưởng." },
  { entity: "rd_idea", action: "approve", notify: "rd.project.manage", dept: "Nghiên cứu R&D", name: "Ý tưởng được duyệt — lập đề tài", description: "Ý tưởng được phê duyệt, chờ chuyển thành đề tài. Mặc định gửi người quản lý đề tài." },
  { entity: "rd_idea", action: "reject", notify: "rd.idea.propose", dept: "Nghiên cứu R&D", name: "Ý tưởng bị từ chối", description: "Ý tưởng không được phê duyệt. Mặc định gửi người đề xuất ý tưởng của phòng." },
  { entity: "rd_project_gate", action: "submit", notify: "rd.gate.review", dept: "Nghiên cứu R&D", name: "Cổng giai đoạn chờ hội đồng xét duyệt", description: "Đề tài nộp hồ sơ qua cổng giai đoạn (Stage-Gate). Mặc định gửi hội đồng xét duyệt cổng." },
  { entity: "rd_project_gate", action: "decide_go", notify: "rd.project.manage", dept: "Nghiên cứu R&D", name: "Cổng giai đoạn đạt (GO)", description: "Hội đồng quyết định cho đề tài qua cổng. Mặc định gửi người quản lý đề tài." },
  { entity: "rd_project", action: "hold", notify: "rd.project.manage", dept: "Nghiên cứu R&D", name: "Đề tài bị tạm dừng", description: "Hội đồng tạm dừng đề tài. Mặc định gửi người quản lý đề tài." },
  { entity: "rd_project", action: "kill", notify: "rd.project.manage", dept: "Nghiên cứu R&D", name: "Đề tài bị hủy (Kill)", description: "Hội đồng chấm dứt đề tài. Mặc định gửi người quản lý đề tài." },
  { entity: "rd_experiment", action: "submit", notify: "rd.eln.approve", dept: "Nghiên cứu R&D", name: "Nhật ký thí nghiệm (ELN) chờ duyệt", description: "Nghiên cứu viên nộp ELN. Mặc định gửi người duyệt ELN." },
  { entity: "rd_experiment", action: "return", notify: "rd.eln.write", dept: "Nghiên cứu R&D", name: "ELN bị trả lại để bổ sung", description: "Người duyệt trả ELN. Mặc định gửi nghiên cứu viên của phòng." },
  { entity: "rd_experiment", action: "approve", notify: "rd.eln.write", dept: "Nghiên cứu R&D", name: "ELN đã được duyệt", description: "ELN được ký duyệt. Mặc định gửi nghiên cứu viên của phòng." },
  { entity: "rd_tech_transfer", action: "submit", notify: "rd.transfer.accept", dept: "Nghiên cứu R&D", name: "Hồ sơ chuyển giao công nghệ chờ tiếp nhận", description: "R&D nộp hồ sơ chuyển giao sang sản xuất. Mặc định gửi người tiếp nhận chuyển giao." },
  { entity: "rd_tech_transfer", action: "return_draft", notify: "rd.transfer.manage", dept: "Nghiên cứu R&D", name: "Hồ sơ chuyển giao bị trả lại", description: "Bên tiếp nhận trả hồ sơ chuyển giao. Mặc định gửi người lập hồ sơ chuyển giao." },
  { entity: "rd_tech_transfer", action: "accept", notify: "rd.transfer.manage", dept: "Nghiên cứu R&D", name: "Sản xuất đã tiếp nhận chuyển giao", description: "Phòng sản xuất tiếp nhận hồ sơ chuyển giao. Mặc định gửi người lập hồ sơ chuyển giao." },
  { entity: "work_plan", action: "submit", notify: "work.plan.approve", dept: "Nghiên cứu R&D", name: "Kế hoạch công việc chờ duyệt", description: "Nhân sự nộp kế hoạch công việc tuần / tháng. Mặc định gửi người duyệt kế hoạch." },
  { entity: "work_plan", action: "return", notify: "work.plan.submit", dept: "Nghiên cứu R&D", name: "Kế hoạch công việc bị trả lại", description: "Kế hoạch cần chỉnh sửa. Mặc định gửi người lập kế hoạch của phòng." },
  // Tổng hợp Oligo
  { entity: "synthesis_batch", action: "finish", notify: "oligo.post.manage", dept: "Tổng hợp Oligo", name: "Mẻ tổng hợp hoàn tất — chờ hậu xử lý", description: "Máy tổng hợp chạy xong mẻ. Mặc định gửi người phụ trách hậu xử lý (cắt, khử bảo vệ, tinh sạch)." },
  { entity: "synthesis_batch", action: "abort", notify: "oligo.batch.manage", dept: "Tổng hợp Oligo", name: "Mẻ tổng hợp bị dừng giữa chừng", description: "Trưởng nhóm hủy mẻ đang chạy. Mặc định gửi người vận hành tổng hợp." },
  { entity: "oligo_sequence", action: "fail", notify: "oligo.order.manage", dept: "Tổng hợp Oligo", name: "Trình tự tổng hợp thất bại", description: "Trình tự lỗi trong tổng hợp, cần tổng hợp lại. Mặc định gửi người quản lý đơn Oligo." },
  { entity: "oligo_sequence", action: "send_qc", notify: "qms.qc.analyze", dept: "Tổng hợp Oligo", name: "Trình tự Oligo chờ kiểm nghiệm", description: "Hậu xử lý xong, gửi QC (OD, MS, HPLC). Mặc định gửi kiểm nghiệm viên." },
  { entity: "oligo_sequence", action: "qc_failed", notify: "oligo.post.manage", dept: "Tổng hợp Oligo", name: "Trình tự Oligo QC không đạt", description: "Kết quả QC không đạt, chờ xử lý / làm lại. Mặc định gửi người phụ trách hậu xử lý." },
  { entity: "oligo_sequence", action: "qc_passed", notify: "oligo.delivery.manage", dept: "Tổng hợp Oligo", name: "Trình tự Oligo QC đạt — sẵn sàng giao", description: "Trình tự đạt QC, chờ đóng gói giao hàng. Mặc định gửi người giao hàng Oligo." },
  // Kỹ thuật – Thiết bị / công nghệ
  { entity: "device_eco", action: "submit_approval", notify: "device.eco.approve", dept: "Kỹ thuật – Thiết bị", name: "Yêu cầu thay đổi kỹ thuật (ECO) chờ duyệt", description: "ECO đã đánh giá ảnh hưởng, chờ phê duyệt. Mặc định gửi người phê duyệt ECO." },
  { entity: "device_eco", action: "approve", notify: "device.eco.propose", dept: "Kỹ thuật – Thiết bị", name: "ECO được phê duyệt", description: "ECO được duyệt, chờ triển khai. Mặc định gửi người đề xuất ECO." },
  { entity: "device_eco", action: "reject", notify: "device.eco.propose", dept: "Kỹ thuật – Thiết bị", name: "ECO bị từ chối", description: "ECO không được duyệt. Mặc định gửi người đề xuất ECO." },
  { entity: "device_model_revision", action: "release", notify: "device.view", dept: "Kỹ thuật – Thiết bị", name: "Phát hành phiên bản thiết kế thiết bị", description: "Phiên bản thiết kế / hồ sơ DMR mới có hiệu lực. Mặc định gửi Phòng Kỹ thuật – Thiết bị." },
  { entity: "device_order", action: "approve", notify: "device.assembly.execute", dept: "Kỹ thuật – Thiết bị", name: "Lệnh lắp ráp thiết bị được duyệt", description: "Lệnh sản xuất / lắp ráp thiết bị được duyệt. Mặc định gửi kỹ thuật viên lắp ráp." },
  { entity: "device_unit", action: "to_fqc", notify: "device.unit.release", dept: "Kỹ thuật – Thiết bị", name: "Thiết bị chờ kiểm tra cuối (FQC)", description: "Thiết bị lắp ráp / chạy thử xong. Mặc định gửi người kiểm tra và giải phóng thiết bị." },
  { entity: "device_unit", action: "fail_fqc", notify: "device.assembly.execute", dept: "Kỹ thuật – Thiết bị", name: "Thiết bị không đạt FQC — trả lắp ráp", description: "Kiểm tra cuối không đạt. Mặc định gửi kỹ thuật viên lắp ráp." },
  { entity: "device_unit", action: "qa_pass", notify: "device.order.manage", dept: "Kỹ thuật – Thiết bị", name: "Thiết bị đạt QA — sẵn sàng giao", description: "Thiết bị được giải phóng. Mặc định gửi người quản lý lệnh lắp ráp." },
  { entity: "device_service_ticket", action: "await_parts", notify: "device.service.manage", dept: "Kỹ thuật – Thiết bị", name: "Phiếu dịch vụ chờ linh kiện", description: "Sửa chữa tại hiện trường đang chờ linh kiện. Mặc định gửi người quản lý dịch vụ kỹ thuật." },
  { entity: "device_subcontract_order", action: "issue", notify: "device.subcontract.manage", dept: "Kỹ thuật – Thiết bị", name: "Phát hành đơn gia công ngoài", description: "Đơn gia công cơ khí / linh kiện gửi nhà thầu. Mặc định gửi người quản lý gia công." },
  { entity: "rd_sw_problem", action: "fix", notify: "rd.project.manage", dept: "Kỹ thuật – Thiết bị", name: "Lỗi phần mềm đã sửa — chờ xác nhận", description: "Lỗi phần mềm đã sửa trên phiên bản mới, cần người khác kiểm tra xác nhận. Mặc định gửi người quản lý dự án phần mềm." },
  { entity: "rd_sw_validation", action: "complete_pq", notify: "rd.software.release", dept: "Kỹ thuật – Thiết bị", name: "Phần mềm nội bộ chờ phê duyệt đưa vào sử dụng", description: "Thẩm định IQ/OQ/PQ đã xong. Mặc định gửi người ký phê duyệt (Trưởng phòng KTCN / Ban Giám Đốc)." },
  // Sản xuất Kit
  { entity: "kit_bom", action: "submit_review", notify: "kit.bom.approve", dept: "Sản xuất Kit", name: "BOM Kit chờ phê duyệt", description: "Định mức BOM mới / sửa đổi chờ ban hành. Mặc định gửi người phê duyệt BOM." },
  { entity: "kit_routing", action: "submit_review", notify: "kit.bom.approve", dept: "Sản xuất Kit", name: "Quy trình công đoạn (Routing) chờ phê duyệt", description: "Routing mới / sửa đổi chờ ban hành. Mặc định gửi người phê duyệt BOM / Routing." },
  { entity: "kit_production_step", action: "complete_for_check", notify: "kit.ebr.check", dept: "Sản xuất Kit", name: "Bước EBR chờ kiểm tra độc lập", description: "Bước trọng yếu đã thực hiện, chờ người thứ hai ký kiểm tra. Mặc định gửi người kiểm tra EBR." },
  { entity: "kit_production_order", action: "pass_qc", notify: "kit.order.release", dept: "Sản xuất Kit", name: "Lô Kit chờ QA giải phóng", description: "Lô đạt QC, chờ QA ký giải phóng và phát hành COA. Mặc định gửi QA giải phóng lô." },
  { entity: "kit_production_order", action: "fail_qc", notify: "kit.order.manage", dept: "Sản xuất Kit", name: "Lô Kit QC không đạt — treo lô", description: "Lô bị treo, mở NCR. Mặc định gửi người quản lý lệnh sản xuất Kit." },
  // QA/QC
  { entity: "qc_test", action: "submit_results", notify: "qms.qc.review", dept: "QA/QC", name: "Kết quả kiểm nghiệm chờ xem xét", description: "Kiểm nghiệm viên nhập xong kết quả. Mặc định gửi người xem xét kết quả QC." },
  { entity: "qc_test", action: "return", notify: "qms.qc.analyze", dept: "QA/QC", name: "Phiếu kiểm nghiệm bị trả lại", description: "Người xem xét trả phiếu để kiểm nghiệm lại. Mặc định gửi kiểm nghiệm viên." },
  { entity: "ncr", action: "propose", notify: "qms.ncr.approve", dept: "QA/QC", name: "NCR chờ phê duyệt hướng xử lý", description: "Đề xuất xử lý sản phẩm không phù hợp. Mặc định gửi người phê duyệt NCR." },
  { entity: "ncr", action: "qa_approve_concession", notify: "qms.ncr.approve_bod", dept: "QA/QC", name: "Nhân nhượng chờ BGĐ phê duyệt", description: "QA đồng ý nhân nhượng sử dụng, chờ Ban Giám đốc. Mặc định gửi người duyệt cấp BGĐ." },
  { entity: "qms_controlled_document", action: "submit_review", notify: "qms.doc.approve", dept: "QA/QC", name: "Tài liệu kiểm soát chờ phê duyệt", description: "SOP / tài liệu mới hoặc sửa đổi chờ ban hành. Mặc định gửi người phê duyệt tài liệu." },
  { entity: "qms_controlled_document", action: "approve", notify: "qms.doc.manage", dept: "QA/QC", name: "Tài liệu kiểm soát có hiệu lực", description: "Tài liệu được ban hành — cần đào tạo / phân phối. Mặc định gửi người quản lý tài liệu." },
  // Kho & Mua hàng nhà máy
  { entity: "lot", action: "reject", notify: "inv.document.post", dept: "Kho Nhà máy", name: "Lô vật tư bị loại (QC không đạt)", description: "Lô bị loại, cần trả nhà cung cấp / hủy. Mặc định gửi người lập phiếu kho." },
  { entity: "lot", action: "hold", notify: "inv.document.post", dept: "Kho Nhà máy", name: "Lô vật tư bị treo", description: "Lô bị treo, không được xuất dùng. Mặc định gửi người lập phiếu kho." },
  { entity: "purchase_request", action: "submit", notify: "purchase.pr.approve", dept: "Mua hàng Nhà máy", name: "Đề nghị mua hàng (PR) chờ duyệt", description: "Phòng ban gửi PR. Mặc định gửi người duyệt PR." },
  { entity: "purchase_request", action: "escalate", notify: "purchase.pr.approve_bod", dept: "Mua hàng Nhà máy", name: "PR vượt hạn mức — chờ BGĐ duyệt", description: "PR vượt thẩm quyền trưởng phòng. Mặc định gửi người duyệt cấp BGĐ." },
  { entity: "purchase_request", action: "approve", notify: "purchase.po.manage", dept: "Mua hàng Nhà máy", name: "PR đã duyệt — lập đơn mua (PO)", description: "PR được duyệt. Mặc định gửi người lập PO." },
  { entity: "purchase_request", action: "bod_approve", notify: "purchase.po.manage", dept: "Mua hàng Nhà máy", name: "PR được BGĐ duyệt — lập đơn mua (PO)", description: "BGĐ duyệt PR vượt hạn mức. Mặc định gửi người lập PO." },
  { entity: "purchase_request", action: "reject", notify: "purchase.pr.create", dept: "Mua hàng Nhà máy", name: "PR bị từ chối", description: "PR không được duyệt. Mặc định gửi người lập PR của phòng." },
];

export const transitionNoticeType = (entity: string, action: string) => `${entity}_${action}`.toUpperCase();

/** Factory notice types, with who is notified by default (always, whatever the matrix adds). */
export const FACTORY_NOTICE_EVENTS: { type: string; dept: string; name: string; description: string }[] = [
  ...TRANSITION_NOTICES.map((t) => ({ type: transitionNoticeType(t.entity, t.action), dept: t.dept, name: t.name, description: t.description })),
  { type: "INTERNAL_ORDER_NEW", dept: "Đơn Nội Bộ", name: "Đơn nội bộ mới", description: "Kinh doanh / phòng ban đặt đơn nội bộ cho phòng sản xuất. Mặc định gửi người tiếp nhận đơn của phòng nhận." },
  { type: "INTERNAL_ORDER_CANCEL_CONFLICT", dept: "Đơn Nội Bộ", name: "Hủy đơn nội bộ đang sản xuất", description: "Bên đặt hủy đơn khi phòng sản xuất đã bắt đầu. Mặc định gửi người tiếp nhận đơn của phòng nhận." },
  { type: "KIT_QA_ASSIGNED", dept: "Sản xuất Kit", name: "Phân công QA giám sát lệnh Kit", description: "QA/QC được phân công giám sát lệnh sản xuất Kit. Mặc định gửi QA/QC." },
  { type: "KIT_IPC_GATE_REQUEST", dept: "Sản xuất Kit", name: "Yêu cầu QC xen kẽ (IPQC) lệnh Kit", description: "Công đoạn kiểm soát trung gian chờ QC xác nhận. Mặc định gửi QA/QC." },
  { type: "KIT_IPC_GATE_PASSED", dept: "Sản xuất Kit", name: "IPQC đạt — được tiếp tục công đoạn", description: "QC xác nhận đạt chốt kiểm soát trung gian. Mặc định gửi Phòng Sản xuất Kit." },
  { type: "KIT_IPC_GATE_REJECTED", dept: "Sản xuất Kit", name: "IPQC không đạt — dừng công đoạn", description: "QC từ chối chốt kiểm soát trung gian. Mặc định gửi Phòng Sản xuất Kit." },
  { type: "ASSET_EVENT_REQUEST", dept: "Kỹ thuật – Thiết bị", name: "Đề xuất bảo trì / hiệu chuẩn / báo hỏng thiết bị", description: "Phòng ban đề xuất bảo trì, hiệu chuẩn, sửa chữa hoặc báo ngừng máy. Mặc định gửi Phòng Kỹ thuật – Thiết bị." },
  { type: "DEVICE_FQC_ASSIGNED", dept: "Kỹ thuật – Thiết bị", name: "Giao QC phụ trách kiểm tra xuất xưởng (FQC)", description: "Phòng KTCN chuyển thiết bị đã lão hóa đạt sang QC-QA. Mặc định gửi QC phụ trách được chọn." },
  { type: "ASSET_EVENT_DONE", dept: "Kỹ thuật – Thiết bị", name: "Hoàn tất bảo trì / hiệu chuẩn thiết bị", description: "Phòng Kỹ thuật – Thiết bị hoàn thành phiếu. Mặc định gửi phòng sở hữu thiết bị." },
  { type: "IQC_PENDING", dept: "QA/QC", name: "Lô nhập chờ lấy mẫu kiểm nghiệm (IQC)", description: "Nguyên vật liệu vừa nhận về đang biệt trữ chờ lấy mẫu. Mặc định gửi người lấy mẫu của kho nhận." },
  { type: "QMS_DEVIATION", dept: "QA/QC", name: "Sự cố chất lượng / sai lệch mới", description: "Báo cáo sai lệch, sự cố chất lượng hoặc CAPA mới. Mặc định gửi người xem xét QC." },
  { type: "INV_RECONCILE_MISMATCH", dept: "Kho Nhà máy", name: "Lệch đối soát tồn kho", description: "Đối soát định kỳ phát hiện lệch giữa sổ kho và tồn thực tế. Mặc định gửi người được đảo phiếu kho." },
];

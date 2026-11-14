/**
 * Khối Kỹ thuật – Nhà máy in the portal "Ma trận thông báo" (shared by the settings screen and the server).
 * Each factory notice type is one matrix event keyed `factory_<type>`; the server always notifies its built-in
 * recipients (the department that must act), the matrix can switch the event off or add recipient groups.
 */

/** Recipient groups of the technical block: everyone holding the permission in any department. */
export const TECHNICAL_MATRIX_ROLES: { code: string; label: string; short: string; permission: string }[] = [
  { code: "factory_rd", label: "Phòng Nghiên cứu R&D (Khối Kỹ thuật)", short: "R&D", permission: "rd.view" },
  { code: "factory_kit", label: "Phòng Sản xuất Kit (Khối Kỹ thuật)", short: "SX Kit", permission: "kit.view" },
  { code: "factory_oligo", label: "Phòng Tổng hợp Oligo (Khối Kỹ thuật)", short: "Oligo", permission: "oligo.view" },
  { code: "factory_device", label: "Phòng Kỹ thuật – Thiết bị (Khối Kỹ thuật)", short: "KT–Thiết bị", permission: "device.view" },
  { code: "factory_qa", label: "Phòng QA/QC Nhà máy (Khối Kỹ thuật)", short: "QA/QC NM", permission: "qms.qc.view" },
  { code: "factory_wh", label: "Kho Nhà máy – Vật tư & Thành phẩm SX (Khối Kỹ thuật)", short: "Kho Nhà Máy", permission: "inv.stock.view" },
  { code: "factory_purchase", label: "Cung ứng & Mua hàng Nhà máy – NVL/Hóa chất SX (Khối Kỹ thuật)", short: "Cung Ứng KT", permission: "purchase.po.view" },
  { code: "factory_intake", label: "Điều phối Đơn Nội Bộ (Khối Kỹ thuật)", short: "Đơn Nội Bộ", permission: "intake.order.accept" },
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
  // Kho & Mua hàng nhà máy (Khối Kỹ thuật)
  { entity: "lot", action: "reject", notify: "inv.document.post", dept: "Kho Nhà máy", name: "Lô vật tư/hóa chất bị loại (QC không đạt) — Kho Nhà máy", description: "Lô nguyên vật liệu/bán thành phẩm bị loại sau kiểm nghiệm QC, cần cô lập trả nhà cung cấp hoặc hủy theo SOP Kho Nhà máy." },
  { entity: "lot", action: "hold", notify: "inv.document.post", dept: "Kho Nhà máy", name: "Lô vật tư/hóa chất bị treo (Hold) — Kho Nhà máy", description: "Lô vật tư kỹ thuật tại Kho Nhà máy bị tạm khóa trạng thái Hold, chặn xuất cấp phát cho sản xuất." },
  { entity: "purchase_request", action: "submit", notify: "purchase.pr.approve", dept: "Mua hàng Nhà máy", name: "Đề nghị mua sắm NVL/Hóa chất kỹ thuật (PR Nhà máy) chờ duyệt", description: "Các phòng R&D, Sản xuất Kit, Oligo, Thiết bị, QA/QC gửi PR mua sắm vật tư kỹ thuật. Mặc định gửi Trưởng bộ phận / người duyệt PR." },
  { entity: "purchase_request", action: "escalate", notify: "purchase.pr.approve_bod", dept: "Mua hàng Nhà máy", name: "PR Kỹ thuật vượt hạn mức — trình BGĐ phê duyệt", description: "Đề nghị mua sắm vật tư/thiết bị kỹ thuật vượt thẩm quyền trưởng phòng. Mặc định gửi Ban Giám Đốc." },
  { entity: "purchase_request", action: "approve", notify: "purchase.po.manage", dept: "Mua hàng Nhà máy", name: "PR Kỹ thuật đã duyệt — Cung ứng Nhà máy lập PO", description: "PR vật tư kỹ thuật được duyệt, chuyển bộ phận Cung ứng Kỹ thuật tìm nhà cung cấp và lập đơn mua PO Nhà máy." },
  { entity: "purchase_request", action: "bod_approve", notify: "purchase.po.manage", dept: "Mua hàng Nhà máy", name: "PR Kỹ thuật được BGĐ duyệt — lập đơn mua (PO Nhà máy)", description: "BGĐ duyệt PR kỹ thuật vượt hạn mức, chuyển bộ phận Cung ứng Kỹ thuật phát hành đơn mua PO." },
  { entity: "purchase_request", action: "reject", notify: "purchase.pr.create", dept: "Mua hàng Nhà máy", name: "PR Kỹ thuật bị từ chối", description: "Đề nghị mua sắm vật tư kỹ thuật không được phê duyệt. Mặc định gửi người lập PR của phòng kỹ thuật." },
];

export const transitionNoticeType = (entity: string, action: string) => `${entity}_${action}`.toUpperCase();

/** Factory notice types, with who is notified by default (always, whatever the matrix adds). */
export const FACTORY_NOTICE_EVENTS: { type: string; dept: string; name: string; description: string; defaultRoles?: string[] }[] = [
  ...TRANSITION_NOTICES.map((t) => ({ type: transitionNoticeType(t.entity, t.action), dept: t.dept, name: t.name, description: t.description })),
  { type: "INTERNAL_ORDER_NEW", dept: "Đơn Nội Bộ", name: "Đơn đặt hàng nội bộ mới (KD → Nhà máy)", description: "Khối Kinh doanh hoặc phòng ban phát hành đơn đặt hàng nội bộ (Kit / Oligo / Thiết bị) sang Nhà máy sản xuất.", defaultRoles: ["factory_intake", "factory_kit", "factory_oligo", "factory_device", "sales_head"] },
  { type: "INTERNAL_ORDER_CANCEL_CONFLICT", dept: "Đơn Nội Bộ", name: "Cảnh báo hủy/điều chỉnh đơn nội bộ đang sản xuất", description: "Bên đặt yêu cầu hủy hoặc sửa đơn nội bộ khi phòng sản xuất đã triển khai lệnh.", defaultRoles: ["factory_intake", "factory_kit", "factory_oligo", "sales_head", "admin"] },
  { type: "KIT_QA_ASSIGNED", dept: "Sản xuất Kit", name: "Phân công QA giám sát lệnh sản xuất Kit", description: "QA/QC được phân công giám sát hồ sơ lô điện tử (eBR) lệnh sản xuất Kit.", defaultRoles: ["factory_kit", "factory_qa"] },
  { type: "KIT_IPC_GATE_REQUEST", dept: "Sản xuất Kit", name: "Yêu cầu QC kiểm tra bán thành phẩm xen kẽ (IPQC)", description: "Công đoạn pha chế/chia liều Kit chờ QC xác nhận điểm dừng kiểm soát trung gian (IPQC).", defaultRoles: ["factory_qa", "factory_kit"] },
  { type: "KIT_IPC_GATE_PASSED", dept: "Sản xuất Kit", name: "IPQC đạt — mở khóa công đoạn sản xuất Kit tiếp theo", description: "QA/QC xác nhận đạt chốt kiểm soát trung gian, cho phép tiếp tục dây chuyền đóng gói/dán nhãn.", defaultRoles: ["factory_kit", "factory_qa"] },
  { type: "KIT_IPC_GATE_REJECTED", dept: "Sản xuất Kit", name: "IPQC không đạt — tạm dừng công đoạn sản xuất Kit", description: "QA/QC từ chối chốt kiểm soát trung gian do thông số lệch chuẩn, yêu cầu xử lý sai lệch.", defaultRoles: ["factory_kit", "factory_qa", "admin"] },
  { type: "ASSET_EVENT_REQUEST", dept: "Kỹ thuật – Thiết bị", name: "Đề xuất bảo trì / hiệu chuẩn / báo hỏng máy phòng Lab", description: "Các phòng Lab đề xuất bảo trì định kỳ, hiệu chuẩn ISO 13485 hoặc báo sự cố ngừng máy.", defaultRoles: ["factory_device", "factory_qa"] },
  { type: "DEVICE_FQC_ASSIGNED", dept: "Kỹ thuật – Thiết bị", name: "Chuyển thiết bị sang QC kiểm tra xuất xưởng (FQC)", description: "Phòng Kỹ thuật – Thiết bị hoàn tất lắp ráp & burn-in, bàn giao QA/QC kiểm định xuất xưởng.", defaultRoles: ["factory_device", "factory_qa"] },
  { type: "ASSET_EVENT_DONE", dept: "Kỹ thuật – Thiết bị", name: "Hoàn tất bảo trì / hiệu chuẩn & mở khóa thiết bị Lab", description: "Phòng Kỹ thuật – Thiết bị hoàn thành hiệu chuẩn/sửa chữa và cập nhật tem hiệu chuẩn hợp lệ.", defaultRoles: ["factory_device", "factory_qa", "factory_rd", "factory_kit", "factory_oligo"] },
  { type: "IQC_PENDING", dept: "QA/QC", name: "Lô NVL/Hóa chất mới nhập chờ lấy mẫu kiểm nghiệm (IQC)", description: "Nguyên vật liệu, hóa chất, primer/probe vừa nhập Kho Nhà máy đang biệt trữ (Quarantine) chờ QA/QC lấy mẫu IQC.", defaultRoles: ["factory_qa", "factory_wh"] },
  { type: "QMS_DEVIATION", dept: "QA/QC", name: "Báo cáo sai lệch chất lượng (Deviation / OOS / CAPA)", description: "Phát sinh kết quả ngoài tiêu chuẩn (OOS), sự không phù hợp (NCR) hoặc hành động khắc phục phòng ngừa (CAPA).", defaultRoles: ["factory_qa", "admin"] },
  // Kho Nhà máy (Khối Kỹ thuật) bổ sung chuyên sâu
  { type: "LOT_IQC_QUARANTINE", dept: "Kho Nhà máy", name: "Tiếp nhận lô NVL/Hóa chất về Kho Nhà máy (Biệt trữ chờ IQC)", description: "Kho Nhà máy tiếp nhận lô nguyên vật liệu, hóa chất, enzyme, vật tư tiêu hao từ PO Kỹ thuật vào khu biệt trữ chờ IQC.", defaultRoles: ["factory_wh", "factory_qa", "factory_purchase"] },
  { type: "LOT_FEFO_ISSUED", dept: "Kho Nhà máy", name: "Xuất cấp phát NVL/Hóa chất theo FEFO cho lệnh sản xuất", description: "Kho Tổng Nhà máy xuất cấp phát hóa chất, enzyme, vật tư theo nguyên tắc FEFO sang Kho nhánh (R&D / SX Kit / Oligo / Thiết bị).", defaultRoles: ["factory_wh", "factory_kit", "factory_oligo", "factory_rd", "factory_device"] },
  { type: "FINISHED_LOT_RECEIPT", dept: "Kho Nhà máy", name: "Nhập kho Thành phẩm / Bán thành phẩm từ dây chuyền SX", description: "Kho Nhà máy tiếp nhận lô thành phẩm (Kit IVD, Oligo, Thiết bị) sau khi QA giải phóng lô hoặc chuyển sang Kho Kinh doanh.", defaultRoles: ["factory_wh", "factory_qa", "warehouse"] },
  { type: "FEFO_EXPIRY_FREEZE_THAW_ALERT", dept: "Kho Nhà máy", name: "Cảnh báo hạn dùng FEFO & số chu kỳ rã đông (Freeze-Thaw) hóa chất", description: "Cảnh báo tự động khi lô enzyme/sinh phẩm tại Kho Nhà máy hoặc Kho nhánh Lab cận hạn dùng hoặc vượt giới hạn rã đông.", defaultRoles: ["factory_wh", "factory_qa", "factory_rd", "factory_kit", "factory_oligo"] },
  { type: "INV_RECONCILE_MISMATCH", dept: "Kho Nhà máy", name: "Lệch đối soát tồn kho Nhà máy & Kho nhánh phòng Lab", description: "Đối soát định kỳ phát hiện chênh lệch giữa sổ kho điện tử và tồn thực tế tại Kho Tổng Nhà máy hoặc Kho nhánh.", defaultRoles: ["factory_wh", "factory_qa", "accountant", "admin"] },
  // Cung ứng & Mua hàng Nhà máy (Khối Kỹ thuật) bổ sung chuyên sâu
  { type: "MRP_BOM_SHORTAGE_ALERT", dept: "Mua hàng Nhà máy", name: "Cảnh báo thiếu hụt định mức vật tư (MRP) theo BOM sản xuất", description: "Hệ thống MRP phát hiện tồn kho NVL/hóa chất khả dụng không đủ định mức BOM cho lệnh sản xuất, yêu cầu Cung ứng Kỹ thuật đặt hàng.", defaultRoles: ["factory_purchase", "factory_wh", "factory_kit", "factory_oligo", "factory_device"] },
  { type: "FACTORY_PO_DELIVERY_TRACKING", dept: "Mua hàng Nhà máy", name: "Theo dõi tiến độ PO vật tư kỹ thuật & hồ sơ CoA/MSDS nhà cung cấp", description: "Thông báo lịch giao hàng đơn mua PO Nhà máy (hóa chất, cột tổng hợp, linh kiện) và nhắc kiểm tra CoA/MSDS trước khi nhập Kho Nhà máy.", defaultRoles: ["factory_purchase", "factory_wh", "factory_qa"] },
];

export interface KitOptions {
  units: { id: string; code: string; name: string; unit_type: string }[];
  warehouses: { id: string; code: string; name: string; owner_org_unit_id: string }[];
  items: {
    id: string;
    code: string;
    name: string;
    item_type: string;
    base_uom: string;
    tracking: string;
    shelf_life_days: number | null;
  }[];
  assets: {
    id: string;
    code: string;
    name: string;
    asset_type: string;
    status: string;
    next_calibration_due: string | null;
  }[];
  lots: {
    id: string;
    code: string;
    status: string;
    expiry_date: string | null;
    item_code: string;
    item_name: string;
    item_type: string;
  }[];
  po_lines?: {
    line_id: string;
    order_id: string;
    item_id: string;
    item_code: string;
    description: string;
    qty_ordered: number;
    qty_delivered: number;
    uom: string;
    internal_order_code: string;
    kd_po_code: string;
    requested_date: string | null;
    order_status: string;
  }[];
  kit_staff?: {
    user_id: number;
    full_name: string;
    position: string;
    label: string;
    is_lead: boolean;
  }[];
  qa_staff?: {
    user_id: number;
    full_name: string;
    position: string;
    label: string;
    is_lead: boolean;
  }[];
}

export const ROLE_LABELS: Record<string, string> = {
  MASTER_MIX: "Master Mix",
  PRIMER_PROBE: "Primer / Probe Mix",
  ENZYME: "Enzyme (Taq / RT)",
  POSITIVE_CONTROL: "Chứng dương (+)",
  NEGATIVE_CONTROL: "Chứng âm (-)",
  EXTRACTION_BUFFER: "Đệm tách chiết",
  PACKAGING: "Bao bì / Nhãn / Hộp",
  SEMI_FINISHED: "Bán thành phẩm",
  REAGENT: "Hóa chất khác",
};

export const CONTAINER_LABELS: Record<string, string> = {
  TUBE_0_5ML: "Ống 0.5 mL",
  TUBE_1_5ML: "Ống 1.5 mL",
  TUBE_2_0ML: "Ống 2.0 mL",
  BOTTLE_10ML: "Chai 10 mL",
  BOTTLE_50ML: "Chai 50 mL",
  STRIP_8: "Dải 8 giếng",
  PLATE_96: "Đĩa 96 giếng",
  BOX_OUTER: "Hộp giấy ngoài",
};

export const STEP_CATEGORY_LABELS: Record<string, string> = {
  PREPARATION: "Chuẩn bị & Cấp phát",
  FORMULATION: "Pha chế đệm / Master Mix",
  FILLING: "Chiết rót phân liều (Aliquot)",
  LYOPHILIZATION: "Đông khô (Lyophilization)",
  QC: "Kiểm định QC (IPC / Thành phẩm)",
  PACKAGING: "Đóng gói Hộp / Bộ Kit",
  LABELING: "In & Dán nhãn",
};

export const ACTION_LABELS: Record<string, string> = {
  submit_review: "📤 Gửi thẩm định quy trình",
  return_draft: "↩️ Trả về bản nháp",
  approve: "✅ Phê duyệt ban hành chính thức ✍",
  supersede: "🔄 Thay thế bằng phiên bản mới (Chuyển hết hiệu lực)",
  obsolete: "🚫 Ngừng hiệu lực (Đóng phiên bản)",
  confirm: "✅ Xác nhận lệnh & Giữ chỗ nguyên liệu (FEFO)",
  begin_execution: "▶️ Bắt đầu triển khai sản xuất (Mở EBR)",
  submit_qc: "📤 Gửi lô thành phẩm sang QC kiểm nghiệm xuất xưởng (FQC)",
  cancel: "❌ Hủy lệnh sản xuất",
  pass_qc: "✅ Xác nhận Đạt QC xuất xưởng",
  fail_qc: "❌ Không đạt QC → Treo lô & Mở phiếu KPH (NCR)",
  hold: "⏸️ Tạm giữ lô (Biệt trữ chờ xử lý)",
  rework_from_hold: "🔧 Mở giữ → Quay lại Sản xuất / Làm lại (Rework)",
  resume_from_hold: "▶️ Mở giữ → Gửi kiểm tra lại QC",
  scrap_from_hold: "🗑️ Hủy lô không thể khắc phục (Scrap) ✍",
  release: "🛡️ QA Giải phóng lô & Nhập kho Thành phẩm ✍",
  start: "▶️ Bắt đầu thực hiện bước này",
  complete: "✅ Hoàn tất bước công đoạn ✍",
  complete_for_check: "📤 Hoàn tất thực hiện & Chờ ký kiểm tra chéo ✍",
  check: "✅ Ký xác nhận kiểm tra chéo (Người thứ 2) ✍",
  fail: "⚠️ Báo lỗi / Không đạt công đoạn",
  reopen: "🔄 Mở lại bước công đoạn để làm lại",
  skip: "⏭️ Bỏ qua bước (Có giải trình) ✍",
  inspect: "🔍 Ghi nhận kiểm tra mẫu lưu định kỳ",
  dispose: "🗑️ Hủy mẫu lưu đã hết hạn",
};

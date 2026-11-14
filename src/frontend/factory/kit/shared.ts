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
    supply_form?: string | null;
    tube_code?: string | null;
    specification?: string | null;
    line_notes?: string | null;
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
  effective_boms?: {
    id: string;
    code: string;
    name: string;
    bom_version: number;
    product_item_id: string;
    bom_type?: string;
    bom_category?: string;
    variant_code?: string;
    supply_form?: string;
    tests_per_kit?: number;
    specification?: string;
  }[];
}

export const ROLE_LABELS: Record<string, string> = {
  MASTER_MIX: "Master Mix",
  PRIMER_PROBE: "Primer / Probe Mix",
  ENZYME: "Enzyme (Taq / RT)",
  INTERNAL_CONTROL: "Ống Chứng nội rời (IC)",
  POSITIVE_CONTROL: "Chứng dương (+)",
  NEGATIVE_CONTROL: "Chứng âm (-)",
  EXTRACTION_BUFFER: "Đệm tách chiết",
  PCR_TUBE_STRIP: "Tube / Strip PCR cấp kèm",
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

export interface StepParamDraft {
  key: string;
  label: string;
  type: "number" | "text" | "boolean";
  unit: string;
  min: string;
  max: string;
  required: boolean;
}

export interface StepFunctionalFlags {
  qc_gate: boolean;
  dual_sign: boolean;
  require_line_clearance: boolean;
  require_material_scan: boolean;
  require_env_log: boolean;
  require_yield_reconcile: boolean;
  require_label_ifu_check: boolean;
  expected_output?: string;
}

export interface RoutingStepDraft {
  seq: number;
  step_code: string;
  step_name: string;
  category: string;
  step_function: string;
  work_center: string;
  instructions: string;
  sop_doc_code: string;
  required_asset_id: string;
  std_duration_min: number;
  is_qc: boolean;
  requires_check_signature: boolean;
  allow_skip: boolean;
  functional_flags: StepFunctionalFlags;
  param_schema: StepParamDraft[];
}

export interface StepFunctionArchetype {
  key: string;
  icon: string;
  shortLabel: string;
  label: string;
  description: string;
  badgeClass: string;
  defaultCategory: string;
  defaultStepCodePrefix: string;
  defaultStepName: string;
  defaultWorkCenter: string;
  defaultSop: string;
  defaultDurationMin: number;
  defaultInstructions: string;
  defaultFlags: StepFunctionalFlags;
  defaultParams: StepParamDraft[];
}

export const WORK_CENTER_PRESETS: string[] = [
  "Phòng sạch Chuẩn bị & Cấp phát (ISO 7)",
  "Phòng Pha chế MasterMix / PCR Hood (ISO 6)",
  "Phòng Pha chế Đệm Tách chiết (ISO 7)",
  "Phòng Chiết rót Định lượng (ISO 7)",
  "Buồng Đông khô Chân không (RH < 40%)",
  "Phòng Kiểm nghiệm QC Sinh học Phân tử",
  "Khu vực Đóng gói Hoàn thiện & Dán nhãn",
  "Kho Biệt trữ / Kho Bán thành phẩm",
];

export const STEP_FUNCTION_CATALOG: Record<string, StepFunctionArchetype> = {
  LINE_CLEARANCE: {
    key: "LINE_CLEARANCE",
    icon: "🧹",
    shortLabel: "Dọn dây chuyền & UV (Line Clearance)",
    label: "1. Dọn dây chuyền, Khử trùng UV & Kiểm tra Môi trường (Line Clearance)",
    description: "Bắt buộc tích đạt 4 hạng mục vệ sinh phòng sạch, hủy nhãn lô cũ, chiếu UV ≥ 30 phút và kiểm tra nhiệt-ẩm trước khi chạy lô.",
    badgeClass: "bg-cyan-50 text-cyan-800 border-cyan-300 dark:bg-cyan-950/50 dark:text-cyan-200 dark:border-cyan-800",
    defaultCategory: "PREPARATION",
    defaultStepCodePrefix: "STEP-CLEAR",
    defaultStepName: "Dọn dây chuyền (Line Clearance), Khử trùng UV & Kiểm tra Môi trường",
    defaultWorkCenter: "Phòng sạch Chuẩn bị & Cấp phát (ISO 7)",
    defaultSop: "SOP-KIT-001",
    defaultDurationMin: 30,
    defaultInstructions: "Kiểm tra vệ sinh dây chuyền, hủy toàn bộ nhãn thừa lô cũ, chiếu UV 30 phút và ghi nhận nhiệt độ/độ ẩm phòng sạch.",
    defaultFlags: {
      qc_gate: false,
      dual_sign: true,
      require_line_clearance: true,
      require_material_scan: false,
      require_env_log: true,
      require_yield_reconcile: false,
      require_label_ifu_check: false,
      expected_output: "Dây chuyền đạt chuẩn GMP, sẵn sàng cấp phát NVL",
    },
    defaultParams: [
      { key: "room_temp_c", label: "Nhiệt độ phòng pha chế", type: "number", unit: "°C", min: "18", max: "25", required: true },
      { key: "room_rh_pct", label: "Độ ẩm tương đối (RH)", type: "number", unit: "%", min: "35", max: "65", required: true },
      { key: "uv_time_min", label: "Thời gian chiếu khử trùng UV", type: "number", unit: "phút", min: "30", max: "60", required: true },
    ],
  },
  MATERIAL_VERIFY_FEFO: {
    key: "MATERIAL_VERIFY_FEFO",
    icon: "📦",
    shortLabel: "Cân đong & Quét Lô NVL (FEFO)",
    label: "2. Cân đong / Cấp phát & Quét đối chiếu Lô NVL đầu vào (FEFO)",
    description: "Đối chiếu mã lô nguyên vật liệu xuất kho theo FEFO, rã đông Enzyme/Oligo trên block lạnh hoặc cân hóa chất rắn.",
    badgeClass: "bg-sky-50 text-sky-800 border-sky-300 dark:bg-sky-950/50 dark:text-sky-200 dark:border-sky-800",
    defaultCategory: "PREPARATION",
    defaultStepCodePrefix: "STEP-MAT",
    defaultStepName: "Nhận bàn giao Lô NVL FEFO, Cân đong & Rã đông trên Block lạnh",
    defaultWorkCenter: "Phòng sạch Chuẩn bị & Cấp phát (ISO 7)",
    defaultSop: "SOP-KIT-001B",
    defaultDurationMin: 25,
    defaultInstructions: "Quét/đối chiếu mã lô NVL theo Phiếu xuất kho FEFO, rã đông hoàn toàn Enzyme/Oligo trên đá lạnh (2–8°C) và vortex nhẹ.",
    defaultFlags: {
      qc_gate: false,
      dual_sign: true,
      require_line_clearance: false,
      require_material_scan: true,
      require_env_log: true,
      require_yield_reconcile: false,
      require_label_ifu_check: false,
      expected_output: "Đủ định mức nguyên liệu đã rã đông/cân đong chính xác",
    },
    defaultParams: [
      { key: "thaw_temp_c", label: "Nhiệt độ block lạnh rã đông", type: "number", unit: "°C", min: "2", max: "8", required: true },
    ],
  },
  FORMULATION_MIXING: {
    key: "FORMULATION_MIXING",
    icon: "🧪",
    shortLabel: "Pha chế / Phối trộn Bán TP",
    label: "3. Pha chế / Phối trộn Bán thành phẩm (MasterMix / Oligo Mix / Buffer)",
    description: "Phối trộn theo bảng nổ BOM trong Tủ ATSH BSC-II hoặc máy khuấy từ, kiểm soát nhiệt độ, tốc độ khuấy và thời gian đồng nhất.",
    badgeClass: "bg-indigo-50 text-indigo-800 border-indigo-300 dark:bg-indigo-950/50 dark:text-indigo-200 dark:border-indigo-800",
    defaultCategory: "FORMULATION",
    defaultStepCodePrefix: "STEP-MIX",
    defaultStepName: "Pha chế Bán thành phẩm MasterMix & Hỗn hợp Primer/Probe trong Tủ BSC-II",
    defaultWorkCenter: "Phòng Pha chế MasterMix / PCR Hood (ISO 6)",
    defaultSop: "SOP-KIT-002",
    defaultDurationMin: 45,
    defaultInstructions: "Phối trộn các cấu phần hóa chất theo đúng thứ tự và thể tích bảng nổ BOM trên block lạnh, vortex đồng nhất và spin-down.",
    defaultFlags: {
      qc_gate: false,
      dual_sign: true,
      require_line_clearance: false,
      require_material_scan: true,
      require_env_log: true,
      require_yield_reconcile: false,
      require_label_ifu_check: false,
      expected_output: "Dung dịch bán thành phẩm đồng nhất, sẵn sàng lấy mẫu IPQC",
    },
    defaultParams: [
      { key: "cold_block_c", label: "Nhiệt độ block lạnh khi pha", type: "number", unit: "°C", min: "2", max: "8", required: true },
      { key: "mix_time_sec", label: "Thời gian trộn đồng nhất", type: "number", unit: "giây", min: "10", max: "60", required: true },
    ],
  },
  IPQC_PH_GATE: {
    key: "IPQC_PH_GATE",
    icon: "🛡️",
    shortLabel: "Cổng chặn QC xen kẽ (IPQC Gate)",
    label: "4. Kiểm soát Chất lượng Bán thành phẩm Xen kẽ (IPQC Gate — Đo pH / OD / Ct)",
    description: "Chốt chặn bắt buộc: Tự động khóa các bước phía sau trong EBR cho tới khi QA/QC ký xác nhận PASS. Tự động đồng bộ độ pH lên COA.",
    badgeClass: "bg-amber-100 text-amber-900 border-amber-400 dark:bg-amber-950/60 dark:text-amber-200 dark:border-amber-700",
    defaultCategory: "QC",
    defaultStepCodePrefix: "STEP-IPQC",
    defaultStepName: "Kiểm soát Chất lượng Bán thành phẩm Xen kẽ (IPQC Gate: Đo pH & Chạy Ct thử nghiệm)",
    defaultWorkCenter: "Phòng Kiểm nghiệm QC Sinh học Phân tử",
    defaultSop: "SOP-QC-KIT-01",
    defaultDurationMin: 60,
    defaultInstructions: "Lấy mẫu bán thành phẩm đo pH thực tế và chạy kiểm tra tín hiệu qPCR (Chứng dương Ct đạt ngưỡng, Chứng âm NTC âm tính). Chờ QA/QC xác nhận PASS.",
    defaultFlags: {
      qc_gate: true,
      dual_sign: true,
      require_line_clearance: false,
      require_material_scan: false,
      require_env_log: false,
      require_yield_reconcile: false,
      require_label_ifu_check: false,
      expected_output: "QA/QC duyệt PASS cổng IPQC — Mở khóa bước Chia lẻ",
    },
    defaultParams: [
      { key: "actual_ph", label: "Giá trị pH thực tế đo được", type: "number", unit: "pH", min: "8.1", max: "8.5", required: true },
      { key: "pc_ct_fam", label: "Giá trị Ct Chứng dương (FAM)", type: "number", unit: "Ct", min: "22", max: "30", required: true },
    ],
  },
  DISPENSING_ALIQUOT: {
    key: "DISPENSING_ALIQUOT",
    icon: "💧",
    shortLabel: "Chiết rót / Chia lẻ Ống (Aliquot)",
    label: "5. Chiết rót / Chia lẻ định lượng vào Ống hoặc Strip (Aliquot Thường / .D.IC / Demo)",
    description: "Chia lẻ chính xác thể tích vào từng ống/chai/strip theo quy cách Hộp/Ống của BOM và kiểm soát cân bằng lượng bán thành phẩm.",
    badgeClass: "bg-teal-50 text-teal-800 border-teal-300 dark:bg-teal-950/50 dark:text-teal-200 dark:border-teal-800",
    defaultCategory: "FILLING",
    defaultStepCodePrefix: "STEP-ALIQUOT",
    defaultStepName: "Chia lẻ (Aliquot) vào Ống / Strip theo Chế độ PO (Thường / Chia sẵn .D.IC / Demo)",
    defaultWorkCenter: "Phòng Chiết rót Định lượng (ISO 7)",
    defaultSop: "SOP-KIT-003",
    defaultDurationMin: 60,
    defaultInstructions: "Chia lẻ chính xác thể tích vào từng ống thành phần theo cấu trúc Hộp/Ống của BOM, đóng nắp kín và kiểm tra sai số thể tích.",
    defaultFlags: {
      qc_gate: false,
      dual_sign: true,
      require_line_clearance: false,
      require_material_scan: false,
      require_env_log: true,
      require_yield_reconcile: true,
      require_label_ifu_check: false,
      expected_output: "Đủ số lượng ống thành phần, sai số thể tích trong giới hạn ±2%",
    },
    defaultParams: [
      { key: "fill_vol_ul", label: "Thể tích chiết rót kiểm tra", type: "number", unit: "µL", min: "15", max: "1500", required: true },
      { key: "yield_check_pct", label: "Tỷ lệ thu hồi chiết rót", type: "number", unit: "%", min: "95", max: "100", required: true },
    ],
  },
  LYOPHILIZATION: {
    key: "LYOPHILIZATION",
    icon: "❄️",
    shortLabel: "Đông khô Chân không (Lyophilization)",
    label: "6. Đông khô / Sấy thăng hoa chân không (Lyophilization Cycle)",
    description: "Kiểm soát chu trình cấp đông sâu (-45°C), sấy thăng hoa sơ cấp & thứ cấp dưới áp suất chân không (mTorr).",
    badgeClass: "bg-purple-50 text-purple-800 border-purple-300 dark:bg-purple-950/50 dark:text-purple-200 dark:border-purple-800",
    defaultCategory: "LYOPHILIZATION",
    defaultStepCodePrefix: "STEP-LYO",
    defaultStepName: "Chạy Chu trình Đông khô Chân không & Đóng nắp trong Khí Nitơ khô",
    defaultWorkCenter: "Buồng Đông khô Chân không (RH < 40%)",
    defaultSop: "SOP-LYO-004",
    defaultDurationMin: 1080,
    defaultInstructions: "Chạy chu trình cấp đông sâu và sấy chân không theo biểu đồ nhiệt, kiểm tra áp suất buồng và đóng nắp kín.",
    defaultFlags: {
      qc_gate: false,
      dual_sign: true,
      require_line_clearance: false,
      require_material_scan: false,
      require_env_log: true,
      require_yield_reconcile: false,
      require_label_ifu_check: false,
      expected_output: "Bánh đông khô trắng xốp đồng đều, độ ẩm tồn dư < 3%",
    },
    defaultParams: [
      { key: "shelf_min_temp_c", label: "Nhiệt độ cấp đông sâu", type: "number", unit: "°C", min: "-55", max: "-40", required: true },
      { key: "vacuum_mtorr", label: "Áp suất chân không buồng sấy", type: "number", unit: "mTorr", min: "30", max: "120", required: true },
    ],
  },
  LABELING_IFU_PACKAGING: {
    key: "LABELING_IFU_PACKAGING",
    icon: "🏷️",
    shortLabel: "In Dán Nhãn, Kèm IFU & Đóng Hộp",
    label: "7. In & Dán Nhãn Ống/Hộp, Đính kèm Tờ HDSD (IFU) & Đóng gói Bộ Kit",
    description: "In bộ nhãn Lô (LOT/NSX/HSD/UDI-DI) & Tờ HDSD (IFU) từ BOM, kiểm tra đối chiếu 100%, đóng hộp thành phẩm và tách mẫu lưu.",
    badgeClass: "bg-emerald-50 text-emerald-800 border-emerald-300 dark:bg-emerald-950/50 dark:text-emerald-200 dark:border-emerald-800",
    defaultCategory: "PACKAGING",
    defaultStepCodePrefix: "STEP-PACK",
    defaultStepName: "In & Dán Nhãn Ống/Hộp, Đính kèm Tờ HDSD (IFU), Tách Mẫu Lưu & Đóng gói",
    defaultWorkCenter: "Khu vực Đóng gói Hoàn thiện & Dán nhãn",
    defaultSop: "SOP-KIT-004",
    defaultDurationMin: 45,
    defaultInstructions: "In bộ nhãn Lô và Tờ Hướng dẫn sử dụng (IFU) hiệu lực, dán nhãn ống/hộp, tách mẫu lưu QC và kiểm tra đối chiếu 100%.",
    defaultFlags: {
      qc_gate: false,
      dual_sign: true,
      require_line_clearance: false,
      require_material_scan: false,
      require_env_log: false,
      require_yield_reconcile: true,
      require_label_ifu_check: true,
      expected_output: "Bộ Kit đóng gói hoàn chỉnh + Mẫu lưu QC",
    },
    defaultParams: [
      { key: "ifu_checked", label: "Tỷ lệ kiểm tra khớp Nhãn & Tờ HDSD (IFU)", type: "number", unit: "%", min: "100", max: "100", required: true },
    ],
  },
  FQC_RELEASE_HANDOVER: {
    key: "FQC_RELEASE_HANDOVER",
    icon: "📋",
    shortLabel: "Cân bằng lượng & Bàn giao FQC/Kho",
    label: "8. Quyết toán Cân bằng lượng (Yield), Bàn giao FQC Xuất xưởng & Nhập kho Biệt trữ",
    description: "Tổng hợp hiệu suất lô (Yield %), quyết toán bao bì/nhãn hỏng, gửi mẫu FQC xuất COA và bàn giao nhập kho Biệt trữ.",
    badgeClass: "bg-rose-50 text-rose-800 border-rose-300 dark:bg-rose-950/50 dark:text-rose-200 dark:border-rose-800",
    defaultCategory: "QC",
    defaultStepCodePrefix: "STEP-FQC",
    defaultStepName: "Quyết toán Cân bằng lượng Lô (Yield), Gửi mẫu FQC & Bàn giao Kho Biệt trữ",
    defaultWorkCenter: "Kho Biệt trữ / Kho Bán thành phẩm",
    defaultSop: "SOP-KIT-005",
    defaultDurationMin: 30,
    defaultInstructions: "Kiểm đếm tổng số bộ Kit đạt, mẫu lưu, mẫu FQC và hao hụt; bàn giao lô sang khu Biệt trữ chờ QA giải phóng và cấp COA.",
    defaultFlags: {
      qc_gate: false,
      dual_sign: true,
      require_line_clearance: false,
      require_material_scan: false,
      require_env_log: false,
      require_yield_reconcile: true,
      require_label_ifu_check: true,
      expected_output: "Hoàn tất Hồ sơ lô EBR, chuyển trạng thái Chờ QC xuất xưởng (PENDING_QC)",
    },
    defaultParams: [
      { key: "batch_yield_pct", label: "Hiệu suất tổng thể của Lô (Yield)", type: "number", unit: "%", min: "90", max: "102", required: true },
    ],
  },
};

export const ROUTING_STANDARD_TEMPLATES: {
  key: string;
  label: string;
  subtitle: string;
  badge: string;
  steps: RoutingStepDraft[];
}[] = [
  {
    key: "PCR_5_STEPS",
    label: "Mẫu 1: Quy trình 5 bước chuẩn sản xuất Kit Real-time PCR / RT-qPCR",
    subtitle: "Chuẩn ISO 13485: Dọn dây chuyền UV ➔ Pha chế MasterMix/Oligo ➔ Cổng chặn IPQC (Đo pH & Ct) ➔ Chia lẻ Aliquot ➔ Dán nhãn, kèm IFU & Đóng gói",
    badge: "5 bước · 1 cổng IPQC",
    steps: [
      {
        seq: 10,
        step_code: "STEP-10-CLEAR",
        step_name: "Dọn dây chuyền (Line Clearance), Khử trùng UV & Cấp phát Lô NVL FEFO",
        category: "PREPARATION",
        step_function: "LINE_CLEARANCE",
        work_center: "Phòng sạch Chuẩn bị & Cấp phát (ISO 7)",
        instructions: "Kiểm tra vệ sinh dây chuyền, hủy toàn bộ nhãn thừa lô cũ, chiếu UV 30 phút, đối chiếu mã lô FEFO và rã đông Enzyme/MasterMix/Oligo trên block lạnh (2–8°C).",
        sop_doc_code: "SOP-KIT-001",
        required_asset_id: "",
        std_duration_min: 30,
        is_qc: false,
        requires_check_signature: true,
        allow_skip: false,
        functional_flags: {
          qc_gate: false,
          dual_sign: true,
          require_line_clearance: true,
          require_material_scan: true,
          require_env_log: true,
          require_yield_reconcile: false,
          require_label_ifu_check: false,
          expected_output: "Dây chuyền sạch 100%, đủ lô NVL theo phiếu xuất kho FEFO",
        },
        param_schema: [
          { key: "room_temp_c", label: "Nhiệt độ phòng pha chế", type: "number", unit: "°C", min: "18", max: "25", required: true },
          { key: "room_rh_pct", label: "Độ ẩm tương đối (RH)", type: "number", unit: "%", min: "35", max: "65", required: true },
          { key: "uv_time_min", label: "Thời gian chiếu khử trùng UV", type: "number", unit: "phút", min: "30", max: "60", required: true },
        ],
      },
      {
        seq: 20,
        step_code: "STEP-20-MIX",
        step_name: "Pha chế Bán thành phẩm MasterMix & Hỗn hợp Primer/Probe trong Tủ BSC-II",
        category: "FORMULATION",
        step_function: "FORMULATION_MIXING",
        work_center: "Phòng Pha chế MasterMix / PCR Hood (ISO 6)",
        instructions: "Phối trộn qPCR MasterMix 2X, Primer/Probe Mix và Chứng dương/Chứng âm theo đúng định mức nổ BOM trên block lạnh (2–8°C), vortex nhẹ 15 giây và spin-down ngắn.",
        sop_doc_code: "SOP-KIT-002",
        required_asset_id: "",
        std_duration_min: 45,
        is_qc: false,
        requires_check_signature: true,
        allow_skip: false,
        functional_flags: {
          qc_gate: false,
          dual_sign: true,
          require_line_clearance: false,
          require_material_scan: true,
          require_env_log: true,
          require_yield_reconcile: false,
          require_label_ifu_check: false,
          expected_output: "Dung dịch bán thành phẩm đồng nhất, bảo quản lạnh 2–8°C",
        },
        param_schema: [
          { key: "cold_block_c", label: "Nhiệt độ block lạnh khi pha", type: "number", unit: "°C", min: "2", max: "8", required: true },
          { key: "vortex_sec", label: "Thời gian trộn đồng nhất (Vortex)", type: "number", unit: "giây", min: "10", max: "30", required: true },
        ],
      },
      {
        seq: 30,
        step_code: "STEP-30-IPQC",
        step_name: "Kiểm soát Chất lượng Bán thành phẩm Xen kẽ (IPQC Gate: Đo pH & Chạy Ct thử nghiệm)",
        category: "QC",
        step_function: "IPQC_PH_GATE",
        work_center: "Phòng Kiểm nghiệm QC Sinh học Phân tử",
        instructions: "Lấy mẫu bán thành phẩm đo pH thực tế và chạy kiểm tra tín hiệu khuếch đại Real-time PCR (Chứng dương FAM/HEX đạt ngưỡng Ct mục tiêu, Chứng âm NTC không lên tín hiệu). Khóa công đoạn chia lẻ cho tới khi QA/QC ký duyệt PASS.",
        sop_doc_code: "SOP-QC-KIT-01",
        required_asset_id: "",
        std_duration_min: 60,
        is_qc: true,
        requires_check_signature: true,
        allow_skip: false,
        functional_flags: {
          qc_gate: true,
          dual_sign: true,
          require_line_clearance: false,
          require_material_scan: false,
          require_env_log: false,
          require_yield_reconcile: false,
          require_label_ifu_check: false,
          expected_output: "Phiếu IPQC đạt (PASS) — Cho phép mở khóa bước Chia lẻ Aliquot",
        },
        param_schema: [
          { key: "actual_ph", label: "Giá trị pH thực tế đo được", type: "number", unit: "pH", min: "8.1", max: "8.5", required: true },
          { key: "pc_ct_fam", label: "Giá trị Ct Chứng dương (FAM)", type: "number", unit: "Ct", min: "22", max: "30", required: true },
        ],
      },
      {
        seq: 40,
        step_code: "STEP-40-ALIQUOT",
        step_name: "Chia lẻ (Aliquot) vào Ống / Strip theo Chế độ PO (Thường / Chia sẵn .D.IC / Demo)",
        category: "FILLING",
        step_function: "DISPENSING_ALIQUOT",
        work_center: "Phòng Chiết rót Định lượng (ISO 7)",
        instructions: "Chia lẻ chính xác thể tích từng thành phần vào ống 1.5mL hoặc dải 8-strip (.D.IC) theo quy cách Hộp/Ống của BOM. Kiểm tra độ kín nắp và cân bằng lượng bán thành phẩm.",
        sop_doc_code: "SOP-KIT-003",
        required_asset_id: "",
        std_duration_min: 60,
        is_qc: false,
        requires_check_signature: true,
        allow_skip: false,
        functional_flags: {
          qc_gate: false,
          dual_sign: true,
          require_line_clearance: false,
          require_material_scan: false,
          require_env_log: true,
          require_yield_reconcile: true,
          require_label_ifu_check: false,
          expected_output: "Đủ số lượng ống thành phần theo cỡ lô, sai số thể tích ≤ ±2%",
        },
        param_schema: [
          { key: "fill_vol_ul", label: "Thể tích chiết rót kiểm tra", type: "number", unit: "µL", min: "15", max: "1500", required: true },
          { key: "yield_check_pct", label: "Tỷ lệ thu hồi bán thành phẩm", type: "number", unit: "%", min: "95", max: "100", required: true },
        ],
      },
      {
        seq: 50,
        step_code: "STEP-50-LABEL-PACK",
        step_name: "In & Dán Nhãn Ống/Hộp, Đính kèm Tờ HDSD (IFU), Tách Mẫu Lưu & Bàn giao FQC",
        category: "PACKAGING",
        step_function: "LABELING_IFU_PACKAGING",
        work_center: "Khu vực Đóng gói Hoàn thiện & Dán nhãn",
        instructions: "In bộ nhãn Lô (LOT/MFG/EXP/UDI-DI) và Tờ Hướng dẫn sử dụng (IFU) hiệu lực, dán nhãn ống/hộp phụ/hộp ngoài, tách mẫu lưu QC (Retention Sample) và bàn giao lô sang chờ FQC giải phóng.",
        sop_doc_code: "SOP-KIT-004",
        required_asset_id: "",
        std_duration_min: 45,
        is_qc: false,
        requires_check_signature: true,
        allow_skip: false,
        functional_flags: {
          qc_gate: false,
          dual_sign: true,
          require_line_clearance: false,
          require_material_scan: false,
          require_env_log: false,
          require_yield_reconcile: true,
          require_label_ifu_check: true,
          expected_output: "Bộ Kit hoàn chỉnh + Mẫu lưu QC + Hồ sơ lô EBR chuyển FQC",
        },
        param_schema: [
          { key: "ifu_checked", label: "Tỷ lệ kiểm tra khớp Nhãn & Tờ HDSD (IFU)", type: "number", unit: "%", min: "100", max: "100", required: true },
        ],
      },
    ],
  },
  {
    key: "LYO_6_STEPS",
    label: "Mẫu 2: Quy trình 6 bước sản xuất Kit PCR Đông khô (Lyophilized qPCR Kit)",
    subtitle: "Có thêm công đoạn Chiết rót Strip ➔ Chạy chu trình Đông khô chân không (-45°C / mTorr) ➔ Cổng IPQC kiểm tra độ ẩm bánh đông khô",
    badge: "6 bước · Đông khô + IPQC",
    steps: [
      {
        seq: 10,
        step_code: "LYO-10-CLEAR",
        step_name: "Dọn dây chuyền (Line Clearance), Khử ẩm & Chuẩn bị Lô NVL Đông khô",
        category: "PREPARATION",
        step_function: "LINE_CLEARANCE",
        work_center: "Buồng Đông khô Chân không (RH < 40%)",
        instructions: "Vệ sinh khử trùng UV, kiểm soát độ ẩm phòng < 40%, đối chiếu mã lô FEFO cho chất bảo vệ đông khô (Trehalose/Mannitol) và Enzyme.",
        sop_doc_code: "SOP-LYO-001",
        required_asset_id: "",
        std_duration_min: 30,
        is_qc: false,
        requires_check_signature: true,
        allow_skip: false,
        functional_flags: { qc_gate: false, dual_sign: true, require_line_clearance: true, require_material_scan: true, require_env_log: true, require_yield_reconcile: false, require_label_ifu_check: false },
        param_schema: [{ key: "room_rh_pct", label: "Độ ẩm phòng đông khô", type: "number", unit: "%", min: "20", max: "40", required: true }],
      },
      {
        seq: 20,
        step_code: "LYO-20-MIX",
        step_name: "Pha chế Dịch Lyophilization MasterMix (Không Glycerol) & Primer/Probe",
        category: "FORMULATION",
        step_function: "FORMULATION_MIXING",
        work_center: "Phòng Pha chế MasterMix / PCR Hood (ISO 6)",
        instructions: "Phối trộn Glycerol-free Taq/RT Enzyme, dNTPs, Trehalose và Primer/Probe theo BOM trên block lạnh.",
        sop_doc_code: "SOP-LYO-002",
        required_asset_id: "",
        std_duration_min: 45,
        is_qc: false,
        requires_check_signature: true,
        allow_skip: false,
        functional_flags: { qc_gate: false, dual_sign: true, require_line_clearance: false, require_material_scan: true, require_env_log: true, require_yield_reconcile: false, require_label_ifu_check: false },
        param_schema: [{ key: "cold_block_c", label: "Nhiệt độ block lạnh", type: "number", unit: "°C", min: "2", max: "8", required: true }],
      },
      {
        seq: 30,
        step_code: "LYO-30-FILL",
        step_name: "Chiết rót Định lượng vào Dải 8-Strip / Ống Đông khô & Đặt nắp hờ",
        category: "FILLING",
        step_function: "DISPENSING_ALIQUOT",
        work_center: "Phòng Chiết rót Định lượng (ISO 7)",
        instructions: "Chiết rót 20 µL/giếng vào strip 8 giếng chuyên dụng, đặt nắp thông khí và xếp lên khay inox máy đông khô.",
        sop_doc_code: "SOP-LYO-003",
        required_asset_id: "",
        std_duration_min: 45,
        is_qc: false,
        requires_check_signature: true,
        allow_skip: false,
        functional_flags: { qc_gate: false, dual_sign: true, require_line_clearance: false, require_material_scan: false, require_env_log: false, require_yield_reconcile: true, require_label_ifu_check: false },
        param_schema: [{ key: "fill_vol_ul", label: "Thể tích chiết rót mỗi giếng", type: "number", unit: "µL", min: "19.5", max: "20.5", required: true }],
      },
      {
        seq: 40,
        step_code: "LYO-40-FREEZEDRY",
        step_name: "Chạy Chu trình Đông khô Chân không (Cấp đông -45°C ➔ Sơ cấp ➔ Thứ cấp)",
        category: "LYOPHILIZATION",
        step_function: "LYOPHILIZATION",
        work_center: "Buồng Đông khô Chân không (RH < 40%)",
        instructions: "Chạy chu trình đông khô tự động 18–24h, kiểm tra áp suất chân không và đóng nắp kín trong môi trường khí Nitơ khô.",
        sop_doc_code: "SOP-LYO-004",
        required_asset_id: "",
        std_duration_min: 1080,
        is_qc: false,
        requires_check_signature: true,
        allow_skip: false,
        functional_flags: { qc_gate: false, dual_sign: true, require_line_clearance: false, require_material_scan: false, require_env_log: true, require_yield_reconcile: false, require_label_ifu_check: false },
        param_schema: [
          { key: "shelf_min_temp_c", label: "Nhiệt độ cấp đông sâu", type: "number", unit: "°C", min: "-55", max: "-40", required: true },
          { key: "vacuum_mtorr", label: "Áp suất chân không buồng sấy", type: "number", unit: "mTorr", min: "30", max: "120", required: true },
        ],
      },
      {
        seq: 50,
        step_code: "LYO-50-IPQC",
        step_name: "Cổng Kiểm soát Chất lượng Bánh Đông khô (IPQC Gate: Độ ẩm tồn dư & Hoạt tính Ct)",
        category: "QC",
        step_function: "IPQC_PH_GATE",
        work_center: "Phòng Kiểm nghiệm QC Sinh học Phân tử",
        instructions: "Kiểm tra cảm quan bánh đông khô (trắng xốp, không sụp), độ ẩm tồn dư < 3% và chạy qPCR sau hoàn nguyên.",
        sop_doc_code: "SOP-QC-LYO-01",
        required_asset_id: "",
        std_duration_min: 60,
        is_qc: true,
        requires_check_signature: true,
        allow_skip: false,
        functional_flags: { qc_gate: true, dual_sign: true, require_line_clearance: false, require_material_scan: false, require_env_log: false, require_yield_reconcile: false, require_label_ifu_check: false },
        param_schema: [{ key: "residual_moisture_pct", label: "Độ ẩm tồn dư bánh đông khô", type: "number", unit: "%", min: "0.5", max: "3.0", required: true }],
      },
      {
        seq: 60,
        step_code: "LYO-60-PACK",
        step_name: "Hàn túi Nhôm chống ẩm kèm Gói hút ẩm, Dán nhãn Hộp & Đính kèm IFU",
        category: "PACKAGING",
        step_function: "LABELING_IFU_PACKAGING",
        work_center: "Khu vực Đóng gói Hoàn thiện & Dán nhãn",
        instructions: "Hàn kín túi nhôm phức hợp kèm gói hút ẩm Silica, dán nhãn hộp ngoài + IFU và bàn giao FQC.",
        sop_doc_code: "SOP-KIT-004",
        required_asset_id: "",
        std_duration_min: 45,
        is_qc: false,
        requires_check_signature: true,
        allow_skip: false,
        functional_flags: { qc_gate: false, dual_sign: true, require_line_clearance: false, require_material_scan: false, require_env_log: false, require_yield_reconcile: true, require_label_ifu_check: true },
        param_schema: [{ key: "ifu_checked", label: "Tỷ lệ kiểm tra khớp Nhãn & IFU", type: "number", unit: "%", min: "100", max: "100", required: true }],
      },
    ],
  },
  {
    key: "EXTRACTION_5_STEPS",
    label: "Mẫu 3: Quy trình 5 bước sản xuất Kit Tách chiết DNA/RNA & Hệ đệm Buffer",
    subtitle: "Cân hóa chất FEFO ➔ Hòa tan khuấy từ & lọc 0.22µm ➔ Cổng IPQC đo pH/độ trong ➔ Chiết rót chai HDPE ➔ Đóng hộp kèm Cột Silica/Hạt từ & IFU",
    badge: "5 bước · Kit Tách chiết",
    steps: [
      {
        seq: 10,
        step_code: "EXT-10-CLEAR",
        step_name: "Dọn dây chuyền (Line Clearance) & Cân đong Hóa chất Pha đệm (Guanidine / Tris / Muối)",
        category: "PREPARATION",
        step_function: "MATERIAL_VERIFY_FEFO",
        work_center: "Phòng sạch Chuẩn bị & Cấp phát (ISO 7)",
        instructions: "Kiểm tra dọn dây chuyền, quét mã lô FEFO các hóa chất rắn/lỏng, cân chính xác trên cân phân tích đã hiệu chuẩn.",
        sop_doc_code: "SOP-EXT-001",
        required_asset_id: "",
        std_duration_min: 30,
        is_qc: false,
        requires_check_signature: true,
        allow_skip: false,
        functional_flags: { qc_gate: false, dual_sign: true, require_line_clearance: true, require_material_scan: true, require_env_log: true, require_yield_reconcile: false, require_label_ifu_check: false },
        param_schema: [{ key: "room_temp_c", label: "Nhiệt độ phòng cân", type: "number", unit: "°C", min: "18", max: "26", required: true }],
      },
      {
        seq: 20,
        step_code: "EXT-20-FORMULATE",
        step_name: "Hòa tan Khuấy từ Gia nhiệt, Hiệu chỉnh pH & Lọc vô trùng 0.22 µm",
        category: "FORMULATION",
        step_function: "FORMULATION_MIXING",
        work_center: "Phòng Pha chế Đệm Tách chiết (ISO 7)",
        instructions: "Hòa tan hoàn toàn các thành phần đệm (Lysis/Wash/Elution Buffer) bằng máy khuấy từ, chuẩn độ pH và lọc qua màng 0.22 µm.",
        sop_doc_code: "SOP-EXT-002",
        required_asset_id: "",
        std_duration_min: 60,
        is_qc: false,
        requires_check_signature: true,
        allow_skip: false,
        functional_flags: { qc_gate: false, dual_sign: true, require_line_clearance: false, require_material_scan: false, require_env_log: true, require_yield_reconcile: false, require_label_ifu_check: false },
        param_schema: [{ key: "stir_rpm", label: "Tốc độ khuấy từ", type: "number", unit: "rpm", min: "200", max: "600", required: true }],
      },
      {
        seq: 30,
        step_code: "EXT-30-IPQC",
        step_name: "Cổng Kiểm soát Chất lượng Hệ đệm (IPQC Gate: Đo pH, Độ dẫn điện & Độ trong)",
        category: "QC",
        step_function: "IPQC_PH_GATE",
        work_center: "Phòng Kiểm nghiệm QC Sinh học Phân tử",
        instructions: "Đo kiểm pH thực tế, kiểm tra độ trong suốt (không kết tủa) và hiệu suất thu hồi ADN/ARN trên mẫu chuẩn trước khi chiết rót.",
        sop_doc_code: "SOP-QC-EXT-01",
        required_asset_id: "",
        std_duration_min: 45,
        is_qc: true,
        requires_check_signature: true,
        allow_skip: false,
        functional_flags: { qc_gate: true, dual_sign: true, require_line_clearance: false, require_material_scan: false, require_env_log: false, require_yield_reconcile: false, require_label_ifu_check: false },
        param_schema: [{ key: "actual_ph", label: "Giá trị pH thực tế đo được", type: "number", unit: "pH", min: "6.4", max: "8.6", required: true }],
      },
      {
        seq: 40,
        step_code: "EXT-40-FILL",
        step_name: "Chiết rót Đệm vào Chai HDPE / Ống Proteinase K & Siết nắp Màng seal",
        category: "FILLING",
        step_function: "DISPENSING_ALIQUOT",
        work_center: "Phòng Chiết rót Định lượng (ISO 7)",
        instructions: "Chiết rót thể tích định mức vào chai HDPE 10mL/50mL, siết nắp lực chuẩn và kiểm tra độ kín.",
        sop_doc_code: "SOP-EXT-003",
        required_asset_id: "",
        std_duration_min: 50,
        is_qc: false,
        requires_check_signature: true,
        allow_skip: false,
        functional_flags: { qc_gate: false, dual_sign: true, require_line_clearance: false, require_material_scan: false, require_env_log: false, require_yield_reconcile: true, require_label_ifu_check: false },
        param_schema: [{ key: "fill_vol_ml", label: "Thể tích chiết rót chai", type: "number", unit: "mL", min: "5", max: "60", required: true }],
      },
      {
        seq: 50,
        step_code: "EXT-50-PACK",
        step_name: "Đóng hộp Cột lọc Silica / Hạt từ + Bộ chai Đệm, Dán nhãn & Kèm Tờ HDSD (IFU)",
        category: "PACKAGING",
        step_function: "LABELING_IFU_PACKAGING",
        work_center: "Khu vực Đóng gói Hoàn thiện & Dán nhãn",
        instructions: "Tập hợp đủ túi Cột thu hồi Silica, ống Collection Tube, các chai đệm VBL/WB1/WB2/Elution, dán nhãn Lô và kèm IFU.",
        sop_doc_code: "SOP-KIT-004",
        required_asset_id: "",
        std_duration_min: 45,
        is_qc: false,
        requires_check_signature: true,
        allow_skip: false,
        functional_flags: { qc_gate: false, dual_sign: true, require_line_clearance: false, require_material_scan: false, require_env_log: false, require_yield_reconcile: true, require_label_ifu_check: true },
        param_schema: [{ key: "ifu_checked", label: "Tỷ lệ kiểm tra khớp Nhãn & IFU", type: "number", unit: "%", min: "100", max: "100", required: true }],
      },
    ],
  },
  {
    key: "SEMI_FINISHED_4_STEPS",
    label: "Mẫu 4: Quy trình 4 bước pha chế Bán thành phẩm (MasterMix gốc / Primer-Probe 10X / Đệm BTP)",
    subtitle: "Dành cho sản phẩm trung gian (SEMI_FINISHED): Dọn dây chuyền ➔ Phối trộn ➔ Cổng IPQC (Đo pH/OD) ➔ Dán nhãn BTP & Nhập kho Bán thành phẩm",
    badge: "4 bước · Bán thành phẩm",
    steps: [
      {
        seq: 10,
        step_code: "BTP-10-PREP",
        step_name: "Dọn dây chuyền (Line Clearance) & Cấp phát Nguyên liệu gốc FEFO",
        category: "PREPARATION",
        step_function: "LINE_CLEARANCE",
        work_center: "Phòng sạch Chuẩn bị & Cấp phát (ISO 7)",
        instructions: "Khử trùng UV buồng pha chế, đối chiếu mã lô nguyên liệu gốc theo BOM Bán thành phẩm.",
        sop_doc_code: "SOP-BTP-001",
        required_asset_id: "",
        std_duration_min: 20,
        is_qc: false,
        requires_check_signature: true,
        allow_skip: false,
        functional_flags: { qc_gate: false, dual_sign: true, require_line_clearance: true, require_material_scan: true, require_env_log: true, require_yield_reconcile: false, require_label_ifu_check: false },
        param_schema: [{ key: "room_temp_c", label: "Nhiệt độ phòng pha chế", type: "number", unit: "°C", min: "18", max: "25", required: true }],
      },
      {
        seq: 20,
        step_code: "BTP-20-MIX",
        step_name: "Phối trộn Bán thành phẩm (MasterMix gốc / Primer-Probe 10X / Đệm BTP)",
        category: "FORMULATION",
        step_function: "FORMULATION_MIXING",
        work_center: "Phòng Pha chế MasterMix / PCR Hood (ISO 6)",
        instructions: "Phối trộn theo đúng công thức BOM Bán thành phẩm, đồng nhất dung dịch và kiểm soát nhiệt độ.",
        sop_doc_code: "SOP-BTP-002",
        required_asset_id: "",
        std_duration_min: 40,
        is_qc: false,
        requires_check_signature: true,
        allow_skip: false,
        functional_flags: { qc_gate: false, dual_sign: true, require_line_clearance: false, require_material_scan: true, require_env_log: true, require_yield_reconcile: false, require_label_ifu_check: false },
        param_schema: [{ key: "batch_vol_ml", label: "Tổng thể tích mẻ pha chế", type: "number", unit: "mL", min: "1", max: "5000", required: true }],
      },
      {
        seq: 30,
        step_code: "BTP-30-IPQC",
        step_name: "Cổng Kiểm soát Chất lượng Bán thành phẩm (IPQC Gate: Đo pH / OD260 / Ct)",
        category: "QC",
        step_function: "IPQC_PH_GATE",
        work_center: "Phòng Kiểm nghiệm QC Sinh học Phân tử",
        instructions: "Đo kiểm pH thực tế và chỉ tiêu chất lượng bán thành phẩm trước khi nhập kho bán thành phẩm.",
        sop_doc_code: "SOP-QC-BTP-01",
        required_asset_id: "",
        std_duration_min: 45,
        is_qc: true,
        requires_check_signature: true,
        allow_skip: false,
        functional_flags: { qc_gate: true, dual_sign: true, require_line_clearance: false, require_material_scan: false, require_env_log: false, require_yield_reconcile: false, require_label_ifu_check: false },
        param_schema: [{ key: "actual_ph", label: "Giá trị pH thực tế đo được", type: "number", unit: "pH", min: "6.5", max: "8.6", required: true }],
      },
      {
        seq: 40,
        step_code: "BTP-40-STORE",
        step_name: "Chiết chai/ống Bán thành phẩm, Dán nhãn BTP & Bàn giao Nhập kho",
        category: "PACKAGING",
        step_function: "FQC_RELEASE_HANDOVER",
        work_center: "Kho Biệt trữ / Kho Bán thành phẩm",
        instructions: "Chiết vào chai/ống Falcon bảo quản, dán nhãn Lô Bán thành phẩm, tách mẫu lưu và nhập kho.",
        sop_doc_code: "SOP-BTP-003",
        required_asset_id: "",
        std_duration_min: 25,
        is_qc: false,
        requires_check_signature: true,
        allow_skip: false,
        functional_flags: { qc_gate: false, dual_sign: true, require_line_clearance: false, require_material_scan: false, require_env_log: false, require_yield_reconcile: true, require_label_ifu_check: true },
        param_schema: [{ key: "yield_pct", label: "Hiệu suất thu hồi mẻ BTP", type: "number", unit: "%", min: "95", max: "100", required: true }],
      },
    ],
  },
];

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

/**
 * Bảng 8 mã nhận diện Vật tư Tube / Strip theo dòng máy Real-time PCR của khách hàng (Chuẩn ABT).
 */
export interface AbtTubeStripSpec {
  code: string;
  item_code: string;
  name: string;
  note: string;
  wells_per_unit: number;
  unit_label: string;
  compatible_machines: string;
}

export const ABT_TUBE_STRIP_CATALOG: AbtTubeStripSpec[] = [
  {
    code: "T02",
    item_code: "VT-TUBE-T02",
    name: "Strip 0.2 mL trong",
    note: "Strip-8",
    wells_per_unit: 8,
    unit_label: "Strip-8 (8 giếng/dải)",
    compatible_machines: "ABI 7500 Standard, Bio-Rad CFX96, Agilent AriaMx, QuantStudio 3/5 (0.2mL)",
  },
  {
    code: "T01",
    item_code: "VT-TUBE-T01",
    name: "Strip 0.1 mL trong",
    note: "Strip-8",
    wells_per_unit: 8,
    unit_label: "Strip-8 (8 giếng/dải)",
    compatible_machines: "ABI 7500 Fast, StepOnePlus, QuantStudio Fast (0.1mL)",
  },
  {
    code: "S02",
    item_code: "VT-TUBE-S02",
    name: "Strip 0.2 mL trắng đục",
    note: "Strip-8",
    wells_per_unit: 8,
    unit_label: "Strip-8 (8 giếng/dải)",
    compatible_machines: "Bio-Rad CFX96, Roche LightCycler 96 (0.2mL trắng đục tăng phản xạ huỳnh quang)",
  },
  {
    code: "S01",
    item_code: "VT-TUBE-S01",
    name: "Strip 0.1 mL trắng đục",
    note: "Strip-8",
    wells_per_unit: 8,
    unit_label: "Strip-8 (8 giếng/dải)",
    compatible_machines: "Roche LightCycler 480/96, Bio-Rad Fast (0.1mL trắng đục)",
  },
  {
    code: "LQ02",
    item_code: "VT-TUBE-LQ02",
    name: "Tube qPCR 0.2 mL",
    note: "Tube rời",
    wells_per_unit: 1,
    unit_label: "Tube rời (nắp phẳng quang học)",
    compatible_machines: "Các dòng máy Real-time qPCR dùng ống đơn 0.2 mL",
  },
  {
    code: "MIC",
    item_code: "VT-TUBE-MIC",
    name: "MIC TUBES and CAPS",
    note: "Strip-4",
    wells_per_unit: 4,
    unit_label: "Strip-4 chuyên dụng (4 giếng/dải)",
    compatible_machines: "Bio Molecular Systems Mic qPCR Cycler (48 giếng)",
  },
  {
    code: "R01",
    item_code: "VT-TUBE-R01",
    name: "Strip-4 0.1 mL trong",
    note: "Strip-4",
    wells_per_unit: 4,
    unit_label: "Strip-4 (4 giếng/dải)",
    compatible_machines: "Qiagen Rotor-Gene Q / Corbett Rotor-Gene (Strip-4 0.1mL)",
  },
  {
    code: "LP02",
    item_code: "VT-TUBE-LP02",
    name: "Tube PCR 0.2 mL",
    note: "Tube rời",
    wells_per_unit: 1,
    unit_label: "Tube rời 0.2 mL thường",
    compatible_machines: "Máy PCR cổ điển / Điện di / Chuẩn bị mẫu",
  },
];

export type AbtKitSupplyFormKey = "NO_SPLIT_NO_IC" | "NO_SPLIT_WITH_IC" | "SPLIT_NO_IC" | "SPLIT_WITH_IC";

export interface AbtKitSupplyFormSpec {
  key: AbtKitSupplyFormKey;
  variant_code: string;
  lot_infix: string; // "" | "IC" | "C" | "C.IC"
  short_label: string;
  label: string;
  is_aliquoted: boolean;
  has_premixed_ic: boolean;
  mix_tests_per_kit: number; // 75 tests (không chia sẵn) vs 64 tests (chia sẵn)
  pcr_tubes_per_kit: number; // 80 tube PCR (không chia sẵn) vs 64 tube PCR (chia sẵn)
  include_ic_tube: boolean; // Có kèm ống IC rời hay không
  include_mix_1_5ml_tubes: boolean; // Có kèm các tube 1.5mL để chứa PCR mix hay không
  description: string;
  badge_class: string;
}

export const ABT_KIT_SUPPLY_FORMS: Record<string, AbtKitSupplyFormSpec> = {
  NO_SPLIT_NO_IC: {
    key: "NO_SPLIT_NO_IC",
    variant_code: "BASE",
    lot_infix: "",
    short_label: "Không chia sẵn · Không sẵn IC",
    label: "1. Dạng Không chia sẵn, Không sẵn IC — Lot: B2611001.[Mã tube]",
    is_aliquoted: false,
    has_premixed_ic: false,
    mix_tests_per_kit: 75,
    pcr_tubes_per_kit: 80,
    include_ic_tube: true,
    include_mix_1_5ml_tubes: true,
    description:
      "PCR Mix cung cấp đủ cho 75 test (chứa trong các tube 1.5 mL) + Kèm ống IC rời + Kèm 80 tube PCR theo mã nhận diện tube.",
    badge_class: "bg-slate-100 text-slate-800 border-slate-300 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700",
  },
  NO_SPLIT_WITH_IC: {
    key: "NO_SPLIT_WITH_IC",
    variant_code: "IC",
    lot_infix: "IC",
    short_label: "Không chia sẵn · Sẵn IC (.IC)",
    label: "2. Dạng Không chia sẵn, Có sẵn IC (.IC) — Lot: B2611001.IC.[Mã tube]",
    is_aliquoted: false,
    has_premixed_ic: true,
    mix_tests_per_kit: 75,
    pcr_tubes_per_kit: 80,
    include_ic_tube: false,
    include_mix_1_5ml_tubes: true,
    description:
      "PCR Mix (đã pha sẵn IC bên trong) đủ cho 75 test chứa trong tube 1.5 mL + KHÔNG kèm ống IC rời + Kèm 80 tube PCR theo mã tube.",
    badge_class: "bg-sky-50 text-sky-800 border-sky-300 dark:bg-sky-950/60 dark:text-sky-200 dark:border-sky-800",
  },
  SPLIT_NO_IC: {
    key: "SPLIT_NO_IC",
    variant_code: "C",
    lot_infix: "C",
    short_label: "Chia sẵn · Không sẵn IC (.C)",
    label: "3. Dạng Chia sẵn, Không sẵn IC (.C) — Lot: B2611001.C.[Mã tube]",
    is_aliquoted: true,
    has_premixed_ic: false,
    mix_tests_per_kit: 64,
    pcr_tubes_per_kit: 64,
    include_ic_tube: true,
    include_mix_1_5ml_tubes: false,
    description:
      "PCR Mix chia sẵn trực tiếp vào 64 tube PCR (đủ 64 test, không dùng tube 1.5 mL chứa Mix) + Kèm ống IC rời.",
    badge_class: "bg-indigo-50 text-indigo-800 border-indigo-300 dark:bg-indigo-950/60 dark:text-indigo-200 dark:border-indigo-800",
  },
  SPLIT_WITH_IC: {
    key: "SPLIT_WITH_IC",
    variant_code: "C.IC",
    lot_infix: "C.IC",
    short_label: "Chia sẵn · Sẵn IC (.C.IC)",
    label: "4. Dạng Chia sẵn & Có sẵn IC (.C.IC) — Lot: B2611001.C.IC.[Mã tube]",
    is_aliquoted: true,
    has_premixed_ic: true,
    mix_tests_per_kit: 64,
    pcr_tubes_per_kit: 64,
    include_ic_tube: false,
    include_mix_1_5ml_tubes: false,
    description:
      "PCR Mix (đã có sẵn IC) chia sẵn trực tiếp vào 64 tube PCR (đủ 64 test) + KHÔNG kèm ống IC rời & KHÔNG dùng tube 1.5 mL chứa Mix.",
    badge_class: "bg-emerald-50 text-emerald-800 border-emerald-300 dark:bg-emerald-950/60 dark:text-emerald-200 dark:border-emerald-800",
  },
};

/**
 * Xây dựng Số Lô (Lot Code) chuẩn ABT cho Kit PCR theo quy cách đặt hàng:
 * - B2611001.[mã tube]: không chia sẵn, không sẵn IC
 * - B2611001.IC.[mã tube]: không chia sẵn, sẵn IC
 * - B2611001.C.[mã tube]: chia sẵn, không sẵn IC
 * - B2611001.C.IC.[mã tube]: chia sẵn, sẵn IC
 */
export function buildAbtKitLotCode(params: {
  baseLot?: string;
  mfgDate?: string;
  seqNo?: number;
  supplyForm?: AbtKitSupplyFormKey | string | null;
  tubeCode?: string | null;
}): string {
  let base = (params.baseLot || "").trim();
  // Tách phần gốc nếu người dùng truyền cả chuỗi B2611001.C.IC.T02
  if (base.includes(".")) {
    base = base.split(".")[0].trim();
  }
  if (!base) {
    const dt = params.mfgDate && /^\d{4}-\d{2}/.test(params.mfgDate) ? params.mfgDate : "2026-11-14";
    const yy = dt.slice(2, 4);
    const mm = dt.slice(5, 7);
    const seq = String(params.seqNo || 1).padStart(3, "0");
    base = `B${yy}${mm}${seq}`;
  }
  const formSpec =
    ABT_KIT_SUPPLY_FORMS[(params.supplyForm as AbtKitSupplyFormKey) || "NO_SPLIT_NO_IC"] ||
    ABT_KIT_SUPPLY_FORMS.NO_SPLIT_NO_IC;
  const tube = (params.tubeCode || "").trim().toUpperCase();
  const parts = [base];
  if (formSpec.lot_infix) parts.push(formSpec.lot_infix);
  if (tube) parts.push(tube);
  return parts.join(".");
}

/**
 * Giải mã tự động Số Lô (Lot Code) của Kit PCR (VD: B2611001.C.IC.T02)
 * để hiển thị rõ trên Tồn kho, Phiếu xuất kho, Phiếu giao hàng và COA.
 */
export function parseAbtKitLotCode(lotCode: string | null | undefined): {
  isAbtStructuredLot: boolean;
  baseLot: string;
  supplyForm: AbtKitSupplyFormSpec | null;
  tubeSpec: AbtTubeStripSpec | null;
  summaryShort: string;
  summaryDetail: string;
} {
  const raw = String(lotCode || "").trim().toUpperCase();
  if (!raw || !raw.includes(".")) {
    return {
      isAbtStructuredLot: false,
      baseLot: raw,
      supplyForm: null,
      tubeSpec: null,
      summaryShort: "",
      summaryDetail: "",
    };
  }
  const tokens = raw.split(".").filter(Boolean);
  const baseLot = tokens[0] || raw;
  const rest = tokens.slice(1);
  const lastToken = rest[rest.length - 1] || "";
  const matchedTube = ABT_TUBE_STRIP_CATALOG.find((t) => t.code === lastToken) || null;
  const middleTokens = matchedTube ? rest.slice(0, -1) : rest;
  const infix = middleTokens.join(".");

  let supplyForm: AbtKitSupplyFormSpec | null = null;
  if (infix === "C.IC") supplyForm = ABT_KIT_SUPPLY_FORMS.SPLIT_WITH_IC;
  else if (infix === "C") supplyForm = ABT_KIT_SUPPLY_FORMS.SPLIT_NO_IC;
  else if (infix === "IC") supplyForm = ABT_KIT_SUPPLY_FORMS.NO_SPLIT_WITH_IC;
  else if (infix === "" && matchedTube) supplyForm = ABT_KIT_SUPPLY_FORMS.NO_SPLIT_NO_IC;

  if (!supplyForm && !matchedTube) {
    return {
      isAbtStructuredLot: false,
      baseLot: raw,
      supplyForm: null,
      tubeSpec: null,
      summaryShort: "",
      summaryDetail: "",
    };
  }

  const formText = supplyForm ? supplyForm.short_label : "Chuẩn";
  const tubeText = matchedTube ? `Tube ${matchedTube.code} (${matchedTube.name} - ${matchedTube.note})` : "";
  const mixText = supplyForm
    ? `${supplyForm.mix_tests_per_kit}T Mix + ${supplyForm.pcr_tubes_per_kit} tube PCR${supplyForm.include_ic_tube ? " + Có ống IC rời" : " (IC pha sẵn)"}`
    : "";

  return {
    isAbtStructuredLot: true,
    baseLot,
    supplyForm,
    tubeSpec: matchedTube,
    summaryShort: [formText, matchedTube ? `Tube ${matchedTube.code}` : ""].filter(Boolean).join(" · "),
    summaryDetail: [formText, tubeText, mixText].filter(Boolean).join(" · "),
  };
}


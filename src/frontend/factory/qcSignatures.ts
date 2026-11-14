export type CoaExportLang = "BI" | "VI" | "EN";

export interface QcStaffSignatureEntry {
  id: string;
  emp_code: string;
  full_name: string;
  title_vi: string;
  title_en: string;
  role: "ANALYST" | "MANAGER";
  signature_url: string;
  aliases: string[];
  active?: boolean;
}

export interface CoaDefaultRow {
  seq: number;
  parameter_name: string;
  parameter_name_en?: string;
  method: string;
  method_en?: string;
  spec_limit: string;
  spec_limit_en?: string;
  observed_value: string;
  observed_value_en?: string;
  passed: boolean;
}

export interface QcReportFormSettings {
  form_code: string;
  doc_prefix: string;
  title_en: string;
  title_vi: string;
  conclusion_prefix_bi: string;
  conclusion_pass_bi: string;
  conclusion_fail_bi: string;
  show_equipment_in_method: boolean;
}

export interface QcCoaFormSettings {
  form_code: string;
  doc_prefix: string;
  default_lang: CoaExportLang;
  title_bi_main: string;
  title_bi_sub: string;
  title_vi_main: string;
  title_en_main: string;
  title_en_sub: string;
  results_mode: "TCCS_CONFORMANCE" | "SUMMARY_TEMPLATE" | "CONFORMS_ONLY" | "DETAILED_QC";
  tccs_param_vi: string;
  tccs_param_en: string;
  tccs_method_vi: string;
  tccs_method_en: string;
  tccs_spec_template_vi: string;
  tccs_spec_template_en: string;
  tccs_spec_fallback_vi: string;
  tccs_spec_fallback_en: string;
  conclusion_pass_vi: string;
  conclusion_pass_en: string;
  conclusion_fail_vi: string;
  conclusion_fail_en: string;
  custom_summary_rows: CoaDefaultRow[];
}

export interface QcFormsConfig {
  company_name_vi: string;
  company_name_en: string;
  address_vi: string;
  address_en: string;
  phone: string;
  email: string;
  iso_badge_vi: string;
  iso_badge_en: string;
  analyst_label_vi: string;
  analyst_label_en: string;
  manager_label_vi: string;
  manager_label_en: string;
  analyst_verified_vi: string;
  analyst_verified_en: string;
  manager_verified_vi: string;
  manager_verified_en: string;
  default_analyst_name: string;
  default_manager_name: string;
  footer_note: string;
  qc_report: QcReportFormSettings;
  coa: QcCoaFormSettings;
  staff_signatures: QcStaffSignatureEntry[];
}

export const DEFAULT_QC_STAFF_SIGNATURES: QcStaffSignatureEntry[] = [
  {
    id: "nv-qc01",
    emp_code: "NV.QC01",
    full_name: "Phan Thị Thảo Trinh",
    title_vi: "TRƯỞNG PHÒNG QC/QA",
    title_en: "QC/QA Manager",
    role: "MANAGER",
    signature_url: "/signatures/qc/chukythaotrinh.png",
    aliases: ["thaotrinh", "thao trinh", "phan thi thao trinh", "nv.qc01", "qaqc@abt-vn.net"],
    active: true,
  },
  {
    id: "nv-qc09",
    emp_code: "NV.QC09",
    full_name: "Lâm Kiều Mi",
    title_vi: "NGƯỜI KIỂM NGHIỆM",
    title_en: "Tested by (QC Analyst)",
    role: "ANALYST",
    signature_url: "/signatures/qc/chukykieumi.png",
    aliases: ["kieumi", "kieu mi", "lam kieu mi", "nv.qc09"],
    active: true,
  },
  {
    id: "nv-qc03",
    emp_code: "NV.QC03",
    full_name: "Nguyễn Thị Thông",
    title_vi: "NGƯỜI KIỂM NGHIỆM",
    title_en: "Tested by (QC Analyst)",
    role: "ANALYST",
    signature_url: "/signatures/qc/chukythithong.png",
    aliases: ["thithong", "thi thong", "nguyen thi thong", "nv.qc03"],
    active: true,
  },
  {
    id: "nv-qc04",
    emp_code: "NV.QC04",
    full_name: "Bạch Ngọc Mai",
    title_vi: "NGƯỜI KIỂM NGHIỆM",
    title_en: "Tested by (QC Analyst)",
    role: "ANALYST",
    signature_url: "/signatures/qc/chukyngocmai.png",
    aliases: ["ngocmai", "ngoc mai", "bach ngoc mai", "nv.qc04"],
    active: true,
  },
  {
    id: "nv-qc05",
    emp_code: "NV.QC05",
    full_name: "Nguyễn Ngọc Yến Nhi",
    title_vi: "NGƯỜI KIỂM NGHIỆM",
    title_en: "Tested by (QC Analyst)",
    role: "ANALYST",
    signature_url: "/signatures/qc/chukyyennhi1.png",
    aliases: ["yennhi", "yennhi1", "yen nhi", "nguyen ngoc yen nhi", "nv.qc05"],
    active: true,
  },
  {
    id: "nv-qc06",
    emp_code: "NV.QC06",
    full_name: "Phan Yến Ngọc",
    title_vi: "NGƯỜI KIỂM NGHIỆM",
    title_en: "Tested by (QC Analyst)",
    role: "ANALYST",
    signature_url: "/signatures/qc/chukyyenngoc.png",
    aliases: ["yenngoc", "yen ngoc", "phan yen ngoc", "nv.qc06"],
    active: true,
  },
  {
    id: "nv-qc08",
    emp_code: "NV.QC08",
    full_name: "Huỳnh Thị Kim Anh",
    title_vi: "NGƯỜI KIỂM NGHIỆM",
    title_en: "Tested by (QC Analyst)",
    role: "ANALYST",
    signature_url: "/signatures/qc/chukykimanh.png",
    aliases: ["kimanh", "kim anh", "huynh thi kim anh", "nv.qc08"],
    active: true,
  },
];

export const DEFAULT_QC_FORMS_CONFIG: QcFormsConfig = {
  company_name_vi: "CÔNG TY TNHH GIẢI PHÁP Y SINH ABT - CHI NHÁNH LONG HẬU",
  company_name_en: "ABT BIOLOGICAL SOLUTIONS COMPANY LIMITED - LONG HAU BRANCH",
  address_vi:
    "Địa chỉ: Xưởng 6.07 và 5.02, Lô L2, Đường Long Hậu-Hiệp Phước, KCN Long Hậu, Xã Cần Giuộc, Tỉnh Tây Ninh, Việt Nam",
  address_en:
    "Address: Workshop 6.07 & 5.02, Lot L2, Long Hau-Hiep Phuoc Road, Long Hau IP, Can Giuoc, Tay Ninh Province, Vietnam",
  phone: "028 2216 0885",
  email: "sales@abtvn.com",
  iso_badge_vi: "✓ HỆ THỐNG QUẢN LÝ CHẤT LƯỢNG ĐẠT TIÊU CHUẨN ISO 13485:2016 & ISO 9001:2015",
  iso_badge_en: "✓ QUALITY MANAGEMENT SYSTEM CERTIFIED TO ISO 13485:2016 & ISO 9001:2015",
  analyst_label_vi: "NGƯỜI KIỂM NGHIỆM",
  analyst_label_en: "Tested by (QC Analyst)",
  manager_label_vi: "TRƯỞNG PHÒNG QC/QA",
  manager_label_en: "QC/QA Manager",
  analyst_verified_vi: "✓ ĐÃ XÁC NHẬN KẾT QUẢ",
  analyst_verified_en: "✓ RESULT CONFIRMED",
  manager_verified_vi: "✓ ĐÃ KIỂM SOÁT & PHÊ DUYỆT",
  manager_verified_en: "✓ REVIEWED & APPROVED",
  default_analyst_name: "",
  default_manager_name: "Phan Thị Thảo Trinh",
  footer_note: "",
  qc_report: {
    form_code: "BM-QC-TR-01",
    doc_prefix: "TR-",
    title_en: "QUALITY TEST REPORT",
    title_vi: "PHIẾU TRẢ KẾT QUẢ KIỂM TRA CHẤT LƯỢNG THÀNH PHẨM",
    conclusion_prefix_bi: "KẾT LUẬN (CONCLUSION):",
    conclusion_pass_bi:
      "Lô hàng đã được kiểm nghiệm đầy đủ các chỉ tiêu theo đúng Tiêu chuẩn Cơ sở và quy định của Hệ thống Quản lý Chất lượng ISO 13485:2016 & ISO 9001:2015. Mẫu kiểm nghiệm đạt tất cả các yêu cầu kỹ thuật quy định. Lô hàng đủ điều kiện xuất xưởng.",
    conclusion_fail_bi:
      "Lô hàng KHÔNG ĐẠT một hoặc nhiều chỉ tiêu kỹ thuật theo Tiêu chuẩn Cơ sở. Yêu cầu giữ biệt trữ, lập phiếu Sai lệch/NCR và không được phép xuất xưởng.",
    show_equipment_in_method: true,
  },
  coa: {
    form_code: "BM-QC-COA-01",
    doc_prefix: "COA-",
    default_lang: "BI",
    title_bi_main: "CERTIFICATE OF ANALYSIS (COA)",
    title_bi_sub: "PHIẾU PHÂN TÍCH KẾT QUẢ KIỂM NGHIỆM THÀNH PHẨM",
    title_vi_main: "PHIẾU PHÂN TÍCH KẾT QUẢ KIỂM NGHIỆM THÀNH PHẨM (COA)",
    title_en_main: "CERTIFICATE OF ANALYSIS (COA)",
    title_en_sub: "FINISHED PRODUCT QUALITY ANALYSIS CERTIFICATE",
    results_mode: "TCCS_CONFORMANCE",
    tccs_param_vi: "Cảm quan và kỹ thuật",
    tccs_param_en: "Appearance and Technical Specifications",
    tccs_method_vi: "Kiểm tra theo SOP",
    tccs_method_en: "Tested according to SOP",
    tccs_spec_template_vi: "Đạt yêu cầu về cảm quan và kỹ thuật theo {TCCS}",
    tccs_spec_template_en: "Conforms to appearance and technical specifications per {TCCS}",
    tccs_spec_fallback_vi: "Đạt yêu cầu về cảm quan và kỹ thuật theo TCCS hiện hành",
    tccs_spec_fallback_en: "Conforms to appearance and technical specifications per current In-house Standard",
    conclusion_pass_vi:
      "Lô hàng đã được kiểm nghiệm đầy đủ các chỉ tiêu theo đúng Tiêu chuẩn Cơ sở và quy định của Hệ thống Quản lý Chất lượng ISO 13485:2016 & ISO 9001:2015. Mẫu kiểm nghiệm đạt tất cả các yêu cầu kỹ thuật quy định. Lô hàng đủ điều kiện xuất xưởng.",
    conclusion_pass_en:
      "This batch has been fully tested in accordance with the In-house Specification (TCCS) and the requirements of the ISO 13485:2016 & ISO 9001:2015 Quality Management System. All tested parameters meet technical requirements. The batch is approved for release.",
    conclusion_fail_vi:
      "Lô hàng KHÔNG ĐẠT yêu cầu kỹ thuật theo Tiêu chuẩn Cơ sở. Không đủ điều kiện xuất xưởng.",
    conclusion_fail_en:
      "This batch DOES NOT MEET the In-house Specification (TCCS) requirements and is rejected for release.",
    custom_summary_rows: [],
  },
  staff_signatures: DEFAULT_QC_STAFF_SIGNATURES,
};

export function stripVnAccents(input: string): string {
  return String(input ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

const GENERIC_NAMES = new Set([
  "",
  "truong phong qa/qc",
  "truong phong qc/qa",
  "truong phong qc",
  "truong bo phan qa/qc",
  "truong qa",
  "qa/qc",
  "qa/qc manager",
  "qc/qa manager",
  "qa",
  "qc",
  "phong kiem nghiem qc",
  "chuyen vien kiem nghiem",
  "kiem nghiem vien",
  "admin",
  "admin he thong",
  "quan tri vien",
  "system",
  "he thong",
]);

function matchesStaff(queryNorm: string, queryCompact: string, staff: QcStaffSignatureEntry): boolean {
  const fullNorm = stripVnAccents(staff.full_name);
  const fullCompact = fullNorm.replace(/\s+/g, "");
  const codeNorm = stripVnAccents(staff.emp_code);
  if (!queryNorm) return false;
  if (queryNorm === fullNorm || queryCompact === fullCompact || queryNorm === codeNorm) return true;
  if (staff.aliases?.some((a) => {
    const an = stripVnAccents(a);
    return an === queryNorm || an.replace(/\s+/g, "") === queryCompact;
  })) {
    return true;
  }
  const tokens = fullNorm.split(" ").filter(Boolean);
  if (tokens.length >= 2) {
    const lastTwo = tokens.slice(-2).join(" ");
    const lastTwoCompact = tokens.slice(-2).join("");
    if (queryNorm === lastTwo || queryCompact === lastTwoCompact || queryNorm.endsWith(` ${lastTwo}`)) return true;
  }
  return false;
}

export interface ResolvedQcSignature {
  displayName: string;
  signatureUrl: string | null;
  entry: QcStaffSignatureEntry | null;
}

/**
 * Resolves a staff member's handwritten PNG signature by full name, code, or accentless alias.
 * Falls back cleanly to `config.default_manager_name` (`Phan Thị Thảo Trinh`) when role === "MANAGER"
 * and the recorded label is blank or generic (e.g., "Trưởng phòng QA/QC").
 */
export function resolveQcSignature(
  personName: string | null | undefined,
  role: "ANALYST" | "MANAGER",
  config?: Partial<QcFormsConfig> | null
): ResolvedQcSignature {
  const staffList =
    Array.isArray(config?.staff_signatures) && config!.staff_signatures.length > 0
      ? config!.staff_signatures
      : DEFAULT_QC_STAFF_SIGNATURES;

  const trimmed = String(personName ?? "").trim();
  const norm = stripVnAccents(trimmed);
  const compact = norm.replace(/\s+/g, "");

  if (trimmed && !GENERIC_NAMES.has(norm)) {
    const matched = staffList.find((s) => s.active !== false && matchesStaff(norm, compact, s));
    if (matched) {
      return {
        displayName: matched.full_name || trimmed,
        signatureUrl: matched.signature_url || null,
        entry: matched,
      };
    }
  }

  const fallbackName =
    role === "MANAGER"
      ? (config?.default_manager_name ?? DEFAULT_QC_FORMS_CONFIG.default_manager_name).trim()
      : (config?.default_analyst_name ?? DEFAULT_QC_FORMS_CONFIG.default_analyst_name).trim();

  if (fallbackName && (GENERIC_NAMES.has(norm) || !trimmed)) {
    const fNorm = stripVnAccents(fallbackName);
    const fCompact = fNorm.replace(/\s+/g, "");
    const fMatched = staffList.find((s) => s.active !== false && matchesStaff(fNorm, fCompact, s));
    return {
      displayName: fMatched?.full_name || fallbackName,
      signatureUrl: fMatched?.signature_url || null,
      entry: fMatched ?? null,
    };
  }

  return {
    displayName: trimmed || (role === "MANAGER" ? "Trưởng phòng QC/QA" : "Phòng Kiểm nghiệm QC"),
    signatureUrl: null,
    entry: null,
  };
}

/**
 * Merges database `qms.coa_template_config` and `core.setting['qms.qc_forms_config']`
 * with `DEFAULT_QC_FORMS_CONFIG` so partial or legacy records always yield a complete config.
 */
export function normalizeQcFormsConfig(
  rawCoaTemplate?: Record<string, any> | null,
  rawFormsJson?: Partial<QcFormsConfig> | null
): QcFormsConfig {
  const base = DEFAULT_QC_FORMS_CONFIG;
  const f = rawFormsJson && typeof rawFormsJson === "object" ? rawFormsJson : {};

  // Ensure default 7 QC staff signatures are preserved and merged with any custom uploads/edits
  const incomingStaff = Array.isArray(f.staff_signatures) ? f.staff_signatures : [];
  const mergedStaffMap = new Map<string, QcStaffSignatureEntry>();
  for (const s of base.staff_signatures) mergedStaffMap.set(s.id, s);
  for (const s of incomingStaff) {
    if (s && typeof s === "object" && s.full_name && s.signature_url) {
      const id = s.id || stripVnAccents(s.full_name).replace(/\s+/g, "-");
      mergedStaffMap.set(id, {
        ...s,
        id,
        aliases: Array.isArray(s.aliases) ? s.aliases : [stripVnAccents(s.full_name)],
      });
    }
  }

  const legacyMode = rawCoaTemplate?.results_display_mode;
  const mappedMode: QcCoaFormSettings["results_mode"] =
    f.coa?.results_mode ??
    (legacyMode === "SUMMARY_TEMPLATE" || legacyMode === "CONFORMS_ONLY" || legacyMode === "DETAILED_QC" || legacyMode === "TCCS_CONFORMANCE"
      ? legacyMode
      : "TCCS_CONFORMANCE");

  const customRows: CoaDefaultRow[] =
    Array.isArray(f.coa?.custom_summary_rows) && f.coa!.custom_summary_rows.length > 0
      ? f.coa!.custom_summary_rows
      : Array.isArray(rawCoaTemplate?.default_coa_parameters)
        ? rawCoaTemplate!.default_coa_parameters
        : [];

  return {
    company_name_vi: f.company_name_vi || base.company_name_vi,
    company_name_en: f.company_name_en || base.company_name_en,
    address_vi: f.address_vi || base.address_vi,
    address_en: f.address_en || base.address_en,
    phone: f.phone ?? base.phone,
    email: f.email ?? base.email,
    iso_badge_vi: f.iso_badge_vi || base.iso_badge_vi,
    iso_badge_en: f.iso_badge_en || base.iso_badge_en,
    analyst_label_vi: f.analyst_label_vi || base.analyst_label_vi,
    analyst_label_en: f.analyst_label_en || base.analyst_label_en,
    manager_label_vi: f.manager_label_vi || base.manager_label_vi,
    manager_label_en: f.manager_label_en || base.manager_label_en,
    analyst_verified_vi: f.analyst_verified_vi || base.analyst_verified_vi,
    analyst_verified_en: f.analyst_verified_en || base.analyst_verified_en,
    manager_verified_vi: f.manager_verified_vi || base.manager_verified_vi,
    manager_verified_en: f.manager_verified_en || base.manager_verified_en,
    default_analyst_name: f.default_analyst_name ?? base.default_analyst_name,
    default_manager_name: f.default_manager_name || base.default_manager_name,
    footer_note: f.footer_note ?? base.footer_note,
    qc_report: {
      ...base.qc_report,
      ...(f.qc_report ?? {}),
    },
    coa: {
      ...base.coa,
      ...(f.coa ?? {}),
      results_mode: mappedMode,
      custom_summary_rows: customRows,
    },
    staff_signatures: Array.from(mergedStaffMap.values()),
  };
}

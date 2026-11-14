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

export interface HrQcPersonnelInput {
  employee_code: string;
  full_name: string;
  position?: string | null;
  email?: string | null;
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
    id: "nv-abt-059",
    emp_code: "NV-ABT-059",
    full_name: "Phan Thị Thảo Trinh",
    title_vi: "Phó Trưởng phòng QC-QA",
    title_en: "Deputy QC/QA Manager",
    role: "MANAGER",
    signature_url: "/signatures/qc/chukythaotrinh.png",
    aliases: ["nv-abt-059", "abt059", "nv.qc01", "nv-qc01", "thaotrinh", "thao trinh", "phan thi thao trinh", "qaqc@abt-vn.net", "thaotrinh070799@gmail.com"],
    active: true,
  },
  {
    id: "nv-abt-060",
    emp_code: "NV-ABT-060",
    full_name: "Nguyễn Thị Thông",
    title_vi: "Nhân viên QC",
    title_en: "QC Analyst",
    role: "ANALYST",
    signature_url: "/signatures/qc/chukythithong.png",
    aliases: ["nv-abt-060", "abt060", "nv.qc03", "nv-qc03", "thithong", "thi thong", "nguyen thi thong", "nguyenthithongactapy@gmail.com"],
    active: true,
  },
  {
    id: "nv-abt-061",
    emp_code: "NV-ABT-061",
    full_name: "Bạch Ngọc Mai",
    title_vi: "Nhân viên QC",
    title_en: "QC Analyst",
    role: "ANALYST",
    signature_url: "/signatures/qc/chukyngocmai.png",
    aliases: ["nv-abt-061", "abt061", "nv.qc04", "nv-qc04", "ngocmai", "ngoc mai", "bach ngoc mai", "maibach172@gmail.com"],
    active: true,
  },
  {
    id: "nv-abt-062",
    emp_code: "NV-ABT-062",
    full_name: "Nguyễn Ngọc Yến Nhi",
    title_vi: "Nhân viên QC",
    title_en: "QC Analyst",
    role: "ANALYST",
    signature_url: "/signatures/qc/chukyyennhi1.png",
    aliases: ["nv-abt-062", "abt062", "nv.qc05", "nv-qc05", "yennhi", "yennhi1", "yen nhi", "nguyen ngoc yen nhi", "yennhi782001@gmail.com"],
    active: true,
  },
  {
    id: "nv-abt-063",
    emp_code: "NV-ABT-063",
    full_name: "Phan Yến Ngọc",
    title_vi: "Nhân viên QC",
    title_en: "QC Analyst",
    role: "ANALYST",
    signature_url: "/signatures/qc/chukyyenngoc.png",
    aliases: ["nv-abt-063", "abt063", "nv.qc06", "nv-qc06", "yenngoc", "yen ngoc", "phan yen ngoc", "latd2777@gmail.com"],
    active: true,
  },
  {
    id: "nv-abt-064",
    emp_code: "NV-ABT-064",
    full_name: "Huỳnh Thị Kim Anh",
    title_vi: "Nhân viên QC",
    title_en: "QC Analyst",
    role: "ANALYST",
    signature_url: "/signatures/qc/chukykimanh.png",
    aliases: ["nv-abt-064", "abt064", "nv.qc08", "nv-qc08", "kimanh", "kim anh", "huynh thi kim anh", "anh.huynhkthh@gmail.com"],
    active: true,
  },
  {
    id: "nv-abt-065",
    emp_code: "NV-ABT-065",
    full_name: "Lâm Kiều Mi",
    title_vi: "Nhân viên QC",
    title_en: "QC Analyst",
    role: "ANALYST",
    signature_url: "/signatures/qc/chukykieumi.png",
    aliases: ["nv-abt-065", "abt065", "nv.qc09", "nv-qc09", "kieumi", "kieu mi", "lam kieu mi", "lamkieumi210803@gmail.com"],
    active: true,
  },
  {
    id: "nv-abt-066",
    emp_code: "NV-ABT-066",
    full_name: "Ngụy Thảo Ngân",
    title_vi: "Nhân viên ISO",
    title_en: "ISO Specialist",
    role: "ANALYST",
    signature_url: "",
    aliases: ["nv-abt-066", "abt066", "thaongan", "thao ngan", "nguy thao ngan", "nguythaongan317@gmail.com"],
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

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isManagerPositionText(pos?: string | null): boolean {
  return /trưởng phòng|phó trưởng phòng|quản lý|giám đốc|manager|head|lead/i.test(String(pos ?? ""));
}

function inferTitleEnFromPosition(pos?: string | null): string {
  const p = stripVnAccents(pos ?? "");
  if (p.includes("pho truong phong")) return "Deputy QC/QA Manager";
  if (p.includes("truong phong") || p.includes("manager")) return "QC/QA Manager";
  if (p.includes("iso")) return "ISO Specialist";
  if (p.includes("qa")) return "QA Specialist";
  return "QC Analyst";
}

function buildHrAliases(hr: HrQcPersonnelInput): string[] {
  const code = String(hr.employee_code ?? "").trim().toLowerCase();
  const shortCode = code.replace(/^nv-/, "").replace(/-/g, "");
  const nameNorm = stripVnAccents(hr.full_name);
  const email = String(hr.email ?? "").trim().toLowerCase();
  return Array.from(new Set([code, shortCode, nameNorm, email].filter(Boolean)));
}

function matchesSingleCandidate(candNorm: string, candCompact: string, staff: QcStaffSignatureEntry): boolean {
  if (!candNorm) return false;
  const fullNorm = stripVnAccents(staff.full_name);
  const fullCompact = fullNorm.replace(/\s+/g, "");
  const codeNorm = stripVnAccents(staff.emp_code);
  if (candNorm === fullNorm || candCompact === fullCompact || (codeNorm && candNorm === codeNorm)) return true;
  if (
    staff.aliases?.some((a) => {
      const an = stripVnAccents(a);
      return an && (an === candNorm || an.replace(/\s+/g, "") === candCompact);
    })
  ) {
    return true;
  }
  const tokens = fullNorm.split(" ").filter(Boolean);
  if (tokens.length >= 2) {
    const lastTwo = tokens.slice(-2).join(" ");
    const lastTwoCompact = tokens.slice(-2).join("");
    if (candNorm === lastTwo || candCompact === lastTwoCompact || candNorm.endsWith(` ${lastTwo}`)) return true;
  }
  return false;
}

function matchesStaff(queryNorm: string, queryCompact: string, staff: QcStaffSignatureEntry): boolean {
  if (!queryNorm) return false;
  if (matchesSingleCandidate(queryNorm, queryCompact, staff)) return true;

  const codeNorm = stripVnAccents(staff.emp_code);
  if (codeNorm.length >= 3) {
    const codeBoundary = new RegExp(`(^|[\\s(\\[—–\\-:,·/])${escapeRegExp(codeNorm)}($|[\\s)\\]—–\\-:,·/])`);
    if (codeBoundary.test(queryNorm)) return true;
  }

  // Strip parenthetical info like "(NV-ABT-060 · Nhân viên QC)" and split "NV-ABT-060 — Nguyễn Thị Thông"
  const withoutParens = queryNorm.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
  if (withoutParens && withoutParens !== queryNorm) {
    if (matchesSingleCandidate(withoutParens, withoutParens.replace(/\s+/g, ""), staff)) return true;
  }
  const splitParts = queryNorm.split(/[—–·|()]+/).map((p) => p.replace(/^[\s\-:,]+|[\s\-:,]+$/g, "").trim()).filter(Boolean);
  for (const part of splitParts) {
    if (part !== queryNorm && matchesSingleCandidate(part, part.replace(/\s+/g, ""), staff)) return true;
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
function findMatchingSignatureIndex(
  list: QcStaffSignatureEntry[],
  candidate: { id?: string; emp_code?: string; full_name?: string }
): number {
  const cid = String(candidate.id ?? "").trim().toLowerCase();
  const ccode = stripVnAccents(candidate.emp_code ?? "");
  const cname = stripVnAccents(candidate.full_name ?? "");
  if (cid) {
    const idx = list.findIndex((s) => s.id.toLowerCase() === cid);
    if (idx >= 0) return idx;
  }
  if (ccode) {
    const idx = list.findIndex(
      (s) =>
        stripVnAccents(s.emp_code) === ccode ||
        s.aliases?.some((a) => stripVnAccents(a) === ccode)
    );
    if (idx >= 0) return idx;
  }
  if (cid) {
    const idx = list.findIndex((s) => s.aliases?.some((a) => stripVnAccents(a) === cid));
    if (idx >= 0) return idx;
  }
  if (cname) {
    const idx = list.findIndex((s) => stripVnAccents(s.full_name) === cname);
    if (idx >= 0) return idx;
  }
  return -1;
}

/**
 * Synchronizes a QC staff signature list with active HR personnel (`NV-ABT-xxx`),
 * preserving uploaded handwritten signature URLs and upgrading legacy `NV.QC*` codes.
 */
export function syncSignaturesWithHrPersonnel(
  signatures: QcStaffSignatureEntry[],
  hrQaPersonnel?: HrQcPersonnelInput[] | null
): QcStaffSignatureEntry[] {
  const list: QcStaffSignatureEntry[] = signatures.map((s) => ({
    ...s,
    aliases: Array.isArray(s.aliases) ? [...s.aliases] : [],
  }));

  if (!Array.isArray(hrQaPersonnel) || hrQaPersonnel.length === 0) return list;

  for (const hr of hrQaPersonnel) {
    const code = String(hr.employee_code ?? "").trim();
    const fullName = String(hr.full_name ?? "").trim();
    if (!code || !fullName) continue;

    const hrAliases = buildHrAliases(hr);
    const idx = findMatchingSignatureIndex(list, { id: code.toLowerCase(), emp_code: code, full_name: fullName });
    if (idx >= 0) {
      const cur = list[idx];
      list[idx] = {
        ...cur,
        emp_code: code,
        full_name: fullName,
        title_vi: hr.position?.trim() || cur.title_vi,
        aliases: Array.from(new Set([...cur.aliases, ...hrAliases])),
      };
    } else {
      list.push({
        id: code.toLowerCase(),
        emp_code: code,
        full_name: fullName,
        title_vi: hr.position?.trim() || "Nhân viên QC",
        title_en: inferTitleEnFromPosition(hr.position),
        role: isManagerPositionText(hr.position) ? "MANAGER" : "ANALYST",
        signature_url: "",
        aliases: hrAliases,
        active: true,
      });
    }
  }

  return list;
}

/**
 * Merges database `qms.coa_template_config` and `core.setting['qms.qc_forms_config']`
 * with `DEFAULT_QC_STAFF_SIGNATURES` and live HR QA/QC personnel so partial or legacy records
 * automatically upgrade `NV.QC*` codes to authoritative `NV-ABT-xxx` employee codes.
 */
export function normalizeQcFormsConfig(
  rawCoaTemplate?: Record<string, any> | null,
  rawFormsJson?: Partial<QcFormsConfig> | null,
  hrQaPersonnel?: HrQcPersonnelInput[] | null
): QcFormsConfig {
  const base = DEFAULT_QC_FORMS_CONFIG;
  const f = rawFormsJson && typeof rawFormsJson === "object" ? rawFormsJson : {};

  // Build authoritative baseline (defaults + live HR QA/QC personnel)
  const baseline = syncSignaturesWithHrPersonnel(base.staff_signatures, hrQaPersonnel);
  const mergedStaff = baseline.map((s) => ({ ...s, aliases: [...s.aliases] }));
  const hrEmpCodes = new Set(
    (hrQaPersonnel ?? []).map((h) => stripVnAccents(h.employee_code)).filter(Boolean)
  );
  const hrFullNames = new Set(
    (hrQaPersonnel ?? []).map((h) => stripVnAccents(h.full_name)).filter(Boolean)
  );

  // Merge saved uploads/customizations on top of baseline, upgrading any legacy NV.QC01..09 codes
  const incomingStaff = Array.isArray(f.staff_signatures) ? f.staff_signatures : [];
  for (const s of incomingStaff) {
    if (!s || typeof s !== "object" || !String(s.full_name ?? "").trim()) continue;
    const matchIdx = findMatchingSignatureIndex(mergedStaff, s);
    const sigUrl = String(s.signature_url ?? "").trim();
    const sAliases = Array.isArray(s.aliases) ? s.aliases : [];
    const oldCodeNorm = String(s.emp_code ?? "").trim();
    const isLegacyFakeCode = !oldCodeNorm || /^nv\.?qc\d+$/i.test(oldCodeNorm);

    if (matchIdx >= 0) {
      const target = mergedStaff[matchIdx];
      const hasAuthoritativeHrCode =
        hrEmpCodes.has(stripVnAccents(target.emp_code)) ||
        hrFullNames.has(stripVnAccents(target.full_name));
      mergedStaff[matchIdx] = {
        ...target,
        emp_code: isLegacyFakeCode || hasAuthoritativeHrCode ? target.emp_code : oldCodeNorm,
        full_name: String(s.full_name).trim() || target.full_name,
        title_vi: String(s.title_vi ?? "").trim() || target.title_vi,
        title_en: String(s.title_en ?? "").trim() || target.title_en,
        role: s.role === "MANAGER" || s.role === "ANALYST" ? s.role : target.role,
        signature_url: sigUrl || target.signature_url,
        aliases: Array.from(
          new Set([
            ...target.aliases,
            ...sAliases,
            target.emp_code.toLowerCase(),
            ...(oldCodeNorm ? [oldCodeNorm.toLowerCase()] : []),
            stripVnAccents(target.full_name),
          ])
        ),
        active: s.active ?? target.active ?? true,
      };
    } else {
      const id = String(s.id ?? "").trim() || stripVnAccents(s.full_name).replace(/\s+/g, "-");
      mergedStaff.push({
        id,
        emp_code: oldCodeNorm,
        full_name: String(s.full_name).trim(),
        title_vi: String(s.title_vi ?? "").trim() || "Nhân viên QC",
        title_en: String(s.title_en ?? "").trim() || "QC Analyst",
        role: s.role === "MANAGER" ? "MANAGER" : "ANALYST",
        signature_url: sigUrl,
        aliases: Array.from(
          new Set([
            ...sAliases,
            ...(oldCodeNorm ? [oldCodeNorm.toLowerCase()] : []),
            stripVnAccents(s.full_name),
          ])
        ),
        active: s.active ?? true,
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
    staff_signatures: mergedStaff,
  };
}

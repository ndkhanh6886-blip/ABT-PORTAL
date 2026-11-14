"use client";

import { api } from "./api";
import { barcode128SvgMarkup } from "./barcodeSvg";
import {
  normalizeQcFormsConfig,
  resolveQcSignature,
  type CoaExportLang,
  type QcFormsConfig,
  type ResolvedQcSignature,
} from "./qcSignatures";

const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const d = (v: string | null | undefined) => {
  if (!v) return "";
  const s = String(v).slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s.split("-").reverse().join("/");
  return s;
};
const num = (v: number | null | undefined) => (v == null || Number.isNaN(v) ? "" : v.toLocaleString("vi-VN", { maximumFractionDigits: 3 }));
const lines = (s: string | null) => (s ? s.split(/\r?\n/).map(esc).join("<br>") : "");
const safeOriginBase = () => {
  if (typeof window !== "undefined" && window.location?.origin && window.location.origin !== "null") {
    return `<base href="${esc(window.location.origin)}/">`;
  }
  return "";
};

export interface QcSignerOverrides {
  analyst_name?: string;
  manager_name?: string;
}

export function calcShelfLifeMonths(
  mfgDate: string | null | undefined,
  expiryDate: string | null | undefined,
  explicitMonths?: number | null
): number | null {
  if (mfgDate && expiryDate) {
    const m = new Date(String(mfgDate).slice(0, 10) + "T00:00:00Z");
    const e = new Date(String(expiryDate).slice(0, 10) + "T00:00:00Z");
    if (!Number.isNaN(m.getTime()) && !Number.isNaN(e.getTime()) && e > m) {
      const mDiff = (e.getUTCFullYear() - m.getUTCFullYear()) * 12 + (e.getUTCMonth() - m.getUTCMonth());
      const dayDiff = Math.abs(e.getUTCDate() - m.getUTCDate());
      if (mDiff > 0 && dayDiff <= 5) return mDiff;
      const approx = Math.round((e.getTime() - m.getTime()) / (1000 * 60 * 60 * 24 * 30.4375));
      if (approx > 0) return approx;
    }
  }
  return explicitMonths && Number(explicitMonths) > 0 ? Number(explicitMonths) : null;
}

export function formatStorageCondition(
  bomStorage?: string | null,
  itemStorage?: string | null,
  lang: CoaExportLang = "BI"
): string {
  const raw = String(bomStorage || itemStorage || "").trim();
  if (!raw || raw.toUpperCase() === "RT") {
    return "15-25 °C";
  }
  if (raw === "2-8") return "2-8 °C";
  if (raw === "-20") return "-20 °C";
  if (raw === "-80") return "-80 °C";
  if (lang === "EN") {
    return raw
      .replace(/Nhiệt độ phòng/gi, "Room temperature")
      .replace(/độ\s*C/gi, "°C")
      .replace(/riêng\s+/gi, "except ")
      .replace(/bảo quản|lưu trữ/gi, "stored at");
  }
  return raw;
}

export function translateUom(uom: string | null | undefined, lang: CoaExportLang, qty = 1): string {
  const raw = String(uom ?? "").trim();
  if (!raw) return "";
  if (lang !== "EN") return raw;
  const key = raw.toLowerCase();
  const plural = Number(qty) > 1;
  if (key === "bộ" || key === "bo") return plural ? "Kits" : "Kit";
  if (key === "chai") return plural ? "Bottles" : "Bottle";
  if (key === "hộp" || key === "hop") return plural ? "Boxes" : "Box";
  if (key === "ống" || key === "ong") return plural ? "Tubes" : "Tube";
  if (key === "cái" || key === "cai" || key === "chiếc") return "Pcs";
  if (key === "kit") return plural ? "Kits" : "Kit";
  return raw;
}

export function formatPresentationText(
  specification: string | null | undefined,
  testsPerKit: number | null | undefined,
  goodQty: number | null | undefined,
  uom: string | null | undefined,
  lang: CoaExportLang
): string {
  const specStr = String(specification ?? "").trim();
  if (specStr) {
    if (lang === "EN") {
      return specStr.replace(/\bbộ\b/gi, "Kits").replace(/\bchai\b/gi, "Bottles").replace(/\bhộp\b/gi, "Boxes");
    }
    return specStr;
  }
  if (Number(testsPerKit) > 0) return `${testsPerKit} tests`;
  if (goodQty != null && Number(goodQty) > 0) return `${num(Number(goodQty))} ${translateUom(uom, lang, Number(goodQty))}`;
  return "—";
}

export interface QcReportParamRowModel {
  seq: number;
  name: string;
  method: string;
  equipment: string | null;
  spec: string;
  actual: string;
  passed: boolean | null;
}

export interface QcTestReportViewModel {
  config: QcFormsConfig;
  reportCode: string;
  qcTestCode: string;
  formCode: string;
  issueDate: string;
  productName: string;
  lotCode: string;
  catalogNo: string;
  orderNo: string;
  mfgDate: string;
  expiryDate: string;
  shelfLifeMonths: number | null;
  batchSize: string;
  storageCondition: string;
  presentation: string;
  standardCode: string;
  rows: QcReportParamRowModel[];
  oligoRef: Record<string, any> | null;
  overallPassed: boolean;
  conclusionPrefix: string;
  conclusionBody: string;
  analyst: ResolvedQcSignature;
  manager: ResolvedQcSignature;
}

export function prepareQcTestReportModel(
  data: any,
  configOverrides?: Partial<QcFormsConfig> | null,
  signerOverrides?: QcSignerOverrides | null
): QcTestReportViewModel {
  const t = data?.test ?? {};
  const lot = data?.lot ?? null;
  const linkedCoa = data?.linked_coa ?? null;
  const cfg = normalizeQcFormsConfig(null, configOverrides ?? data?.qc_forms_config);

  const lotCode = String(lot?.code || t.lot_code || t.code || "—");
  const reportCode = `${cfg.qc_report.doc_prefix}${lotCode}`;
  const qcTestCode = String(t.code || "—");
  const formCode = cfg.qc_report.form_code || "BM-QC-TR-01";
  const issueDate = d(data?.signature?.signed_at || linkedCoa?.issued_at || t.updated_at || t.created_at) || "—";

  const mfgRaw = lot?.mfg_date ?? null;
  const expRaw = lot?.expiry_date ?? null;
  const shelfLifeMonths = calcShelfLifeMonths(mfgRaw, expRaw, lot?.shelf_life_months);
  const lotQty = lot?.lot_qty != null ? Number(lot.lot_qty) : null;
  const uom = lot?.uom || lot?.base_uom || "";
  const batchSize = lotQty != null && lotQty > 0 ? `${num(lotQty)} ${uom}`.trim() : "—";

  const params: any[] = Array.isArray(t.parameters) ? t.parameters : [];
  const results: any[] = Array.isArray(t.results) ? t.results : [];
  const rows: QcReportParamRowModel[] = params.map((p: any, idx: number) => {
    const r = results.find((x: any) => x.parameter_id === p.id);
    const specStr = `${spec(p)}${p.value_type === "NUMERIC" && p.unit ? ` ${p.unit}` : ""}`.trim() || "Đạt chuẩn";
    const eq =
      cfg.qc_report.show_equipment_in_method
        ? p.equipment_name || r?.instrument_name || r?.instrument_code || null
        : null;
    return {
      seq: p.seq ?? idx + 1,
      name: String(p.name ?? ""),
      method: String(p.method || "Kiểm tra theo SOP"),
      equipment: eq ? String(eq) : null,
      spec: specStr,
      actual: r ? value(r, p.unit) : "—",
      passed: r?.passed ?? null,
    };
  });

  const overallPassed = t.overall_result === "PASS";
  const analystRaw = signerOverrides?.analyst_name || t.analyst_name || linkedCoa?.analyst_name || cfg.default_analyst_name;
  const managerRaw =
    signerOverrides?.manager_name ||
    data?.signature?.signer_name ||
    t.reviewer_name ||
    linkedCoa?.issued_by_name ||
    cfg.default_manager_name;

  return {
    config: cfg,
    reportCode,
    qcTestCode,
    formCode,
    issueDate,
    productName: String(lot?.item_name || t.item_name || t.subject?.label || t.spec_name || "—"),
    lotCode,
    catalogNo: String(lot?.item_code || t.item_code || "—"),
    orderNo: String(lot?.kd_po_code || lot?.order_code || t.order_code || "—"),
    mfgDate: d(mfgRaw) || "—",
    expiryDate: d(expRaw) || "—",
    shelfLifeMonths,
    batchSize,
    storageCondition: formatStorageCondition(lot?.bom_storage_condition, lot?.item_storage_condition, "BI"),
    presentation: formatPresentationText(lot?.specification, lot?.tests_per_kit, lotQty, uom, "BI"),
    standardCode: String(lot?.tccs_code || (t.spec_code ? `${t.spec_code} v${t.spec_version ?? 1}` : "TCCS")),
    rows,
    oligoRef: t.subject?.reference ?? null,
    overallPassed,
    conclusionPrefix: cfg.qc_report.conclusion_prefix_bi,
    conclusionBody: overallPassed ? cfg.qc_report.conclusion_pass_bi : cfg.qc_report.conclusion_fail_bi,
    analyst: resolveQcSignature(analystRaw, "ANALYST", cfg),
    manager: resolveQcSignature(managerRaw, "MANAGER", cfg),
  };
}

export interface CoaTableRowModel {
  seq: number;
  parameter: string;
  method: string;
  spec: string;
  observed: string;
  resultText: string;
  passed: boolean;
}

export interface CoaCertificateViewModel {
  lang: CoaExportLang;
  config: QcFormsConfig;
  coaCode: string;
  qcTestCode: string;
  formCode: string;
  issueDate: string;
  companyNamePrimary: string;
  companyNameSecondary: string | null;
  addressText: string;
  contactText: string;
  titleMain: string;
  titleSub: string | null;
  isoBadge: string;
  section1Title: string;
  section2Title: string;
  section3Title: string;
  productName: string;
  lotCode: string;
  catalogNo: string;
  orderNo: string;
  mfgDate: string;
  expiryDate: string;
  shelfLifeText: string;
  batchSize: string;
  storageCondition: string;
  presentation: string;
  standardCode: string;
  includeActualColumn: boolean;
  rows: CoaTableRowModel[];
  overallPassed: boolean;
  conclusionPrefix: string;
  conclusionBody: string;
  analystTitleMain: string;
  analystTitleSub: string | null;
  analystVerifiedText: string;
  managerTitleMain: string;
  managerTitleSub: string | null;
  managerVerifiedText: string;
  analyst: ResolvedQcSignature;
  manager: ResolvedQcSignature;
  isSuperseded: boolean;
  customNotes: string | null;
}

export function prepareCoaCertificateModel(
  coa: any,
  configOverrides?: Partial<QcFormsConfig> | null,
  lang: CoaExportLang = "BI",
  signerOverrides?: QcSignerOverrides | null
): CoaCertificateViewModel {
  const cfg = normalizeQcFormsConfig(null, configOverrides);
  const snapshot: any[] = Array.isArray(coa?.qc_results_snapshot) ? coa.qc_results_snapshot : [];
  const summaryUpper = String(coa?.qc_summary ?? "").toUpperCase();
  const hasExplicitFail =
    snapshot.some((s) => s?.passed === false) ||
    summaryUpper.includes("KHÔNG ĐẠT") ||
    summaryUpper.includes("FAIL");
  const overallPassed = !hasExplicitFail;

  const tccsCode = String(coa?.tccs_code || coa?.spec_code || "").trim();
  const standardDisplay = tccsCode || "TCCS";
  const mfgRaw = coa?.mfg_date ?? null;
  const expRaw = coa?.expiry_date ?? null;
  const months = calcShelfLifeMonths(mfgRaw, expRaw, coa?.shelf_life_months);
  const shelfLifeText = months
    ? lang === "EN"
      ? `(${months} months)`
      : `(${months} tháng)`
    : "";

  const goodQty = coa?.good_qty != null ? Number(coa.good_qty) : 0;
  const uomText = translateUom(coa?.uom, lang, goodQty);
  const batchSize = `${num(goodQty)} ${uomText}`.trim();

  const resultLabel = (pass: boolean) => {
    if (lang === "EN") return pass ? "PASS" : "FAIL";
    if (lang === "VI") return pass ? "ĐẠT" : "KHÔNG ĐẠT";
    return pass ? "ĐẠT (PASS)" : "KHÔNG ĐẠT (FAIL)";
  };

  let includeActualColumn = false;
  let rows: CoaTableRowModel[] = [];

  if (cfg.coa.results_mode === "TCCS_CONFORMANCE") {
    const paramName = lang === "EN" ? cfg.coa.tccs_param_en : cfg.coa.tccs_param_vi;
    const methodName = lang === "EN" ? cfg.coa.tccs_method_en : cfg.coa.tccs_method_vi;
    const specName = tccsCode
      ? (lang === "EN" ? cfg.coa.tccs_spec_template_en : cfg.coa.tccs_spec_template_vi).replace(/\{TCCS\}/g, tccsCode)
      : lang === "EN"
        ? cfg.coa.tccs_spec_fallback_en
        : cfg.coa.tccs_spec_fallback_vi;
    rows = [
      {
        seq: 1,
        parameter: paramName,
        method: methodName,
        spec: specName,
        observed: resultLabel(overallPassed),
        resultText: resultLabel(overallPassed),
        passed: overallPassed,
      },
    ];
  } else if (cfg.coa.results_mode === "SUMMARY_TEMPLATE" && cfg.coa.custom_summary_rows.length > 0) {
    includeActualColumn = false;
    rows = cfg.coa.custom_summary_rows.map((r, i) => {
      const p = r.passed !== false;
      return {
        seq: r.seq ?? i + 1,
        parameter: lang === "EN" && r.parameter_name_en ? r.parameter_name_en : r.parameter_name,
        method: lang === "EN" && r.method_en ? r.method_en : r.method,
        spec: lang === "EN" && r.spec_limit_en ? r.spec_limit_en : r.spec_limit,
        observed: lang === "EN" && r.observed_value_en ? r.observed_value_en : r.observed_value,
        resultText: resultLabel(p),
        passed: p,
      };
    });
  } else if (cfg.coa.results_mode === "CONFORMS_ONLY") {
    includeActualColumn = false;
    rows = snapshot.map((st: any, idx: number) => {
      const p = st.passed !== false;
      return {
        seq: st.seq ?? idx + 1,
        parameter: String(st.parameter_name ?? `${st.step_code ?? ""} ${st.step_name ?? ""}`.trim()),
        method: String(st.method ?? (lang === "EN" ? "Tested according to SOP" : "Kiểm tra theo SOP")),
        spec: lang === "EN" ? `Conforms to ${standardDisplay}` : `Đạt yêu cầu theo ${standardDisplay}`,
        observed: resultLabel(p),
        resultText: resultLabel(p),
        passed: p,
      };
    });
  } else {
    includeActualColumn = true;
    rows = snapshot.map((st: any, idx: number) => {
      const p = st.passed !== false;
      const obs =
        st.observed_value ??
        (st.param_values && Object.keys(st.param_values).length > 0
          ? Object.entries(st.param_values)
              .map(([k, v]) => `${k}: ${v}`)
              .join(" · ")
          : "—");
      return {
        seq: st.seq ?? idx + 1,
        parameter: String(st.parameter_name ?? `${st.step_code ?? ""} ${st.step_name ?? ""}`.trim()),
        method: String(st.method ?? "SOP-QC"),
        spec: String(st.spec_limit ?? (lang === "EN" ? "Conforms" : "Đạt chuẩn")),
        observed: String(obs),
        resultText: resultLabel(p),
        passed: p,
      };
    });
  }

  const analystRaw = signerOverrides?.analyst_name || coa?.analyst_name || cfg.default_analyst_name;
  const managerRaw = signerOverrides?.manager_name || coa?.reviewer_name || coa?.issued_by_name || cfg.default_manager_name;

  return {
    lang,
    config: cfg,
    coaCode: String(coa?.code || `${cfg.coa.doc_prefix}${coa?.lot_code || ""}`),
    qcTestCode: String(coa?.qc_test_code || "—"),
    formCode: cfg.coa.form_code || "BM-QC-COA-01",
    issueDate: d(coa?.issued_at || coa?.mfg_date) || "—",
    companyNamePrimary: lang === "EN" ? cfg.company_name_en : cfg.company_name_vi,
    companyNameSecondary: lang === "BI" ? cfg.company_name_en : null,
    addressText: lang === "EN" ? cfg.address_en : cfg.address_vi,
    contactText:
      lang === "EN"
        ? `Tel: ${cfg.phone} | Email: ${cfg.email}`
        : `Điện thoại: ${cfg.phone} | Email: ${cfg.email}`,
    titleMain:
      lang === "EN" ? cfg.coa.title_en_main : lang === "VI" ? cfg.coa.title_vi_main : cfg.coa.title_bi_main,
    titleSub: lang === "EN" ? cfg.coa.title_en_sub : lang === "BI" ? cfg.coa.title_bi_sub : null,
    isoBadge: lang === "EN" ? cfg.iso_badge_en : cfg.iso_badge_vi,
    section1Title:
      lang === "EN"
        ? "I. PRODUCT & BATCH TRACEABILITY"
        : lang === "VI"
          ? "I. THÔNG TIN TRUY XUẤT LÔ HÀNG"
          : "I. THÔNG TIN TRUY XUẤT LÔ HÀNG (PRODUCT & BATCH TRACEABILITY)",
    section2Title:
      lang === "EN"
        ? "II. QUALITY CONTROL ANALYSIS RESULTS"
        : lang === "VI"
          ? "II. CHỈ TIÊU KIỂM NGHIỆM VÀ KẾT QUẢ PHÂN TÍCH"
          : "II. CHỈ TIÊU KIỂM NGHIỆM VÀ KẾT QUẢ PHÂN TÍCH (ANALYSIS RESULTS)",
    section3Title:
      lang === "EN"
        ? "III. CONCLUSION & APPROVAL"
        : lang === "VI"
          ? "III. KẾT LUẬN VÀ PHÊ DUYỆT"
          : "III. KẾT LUẬN VÀ PHÊ DUYỆT (CONCLUSION & APPROVAL)",
    productName: String(coa?.product_name || "—"),
    lotCode: String(coa?.lot_code || "—"),
    catalogNo: String(coa?.product_code || "—"),
    orderNo: String(coa?.kd_po_code || coa?.order_code || "—"),
    mfgDate: d(mfgRaw) || "—",
    expiryDate: d(expRaw) || "—",
    shelfLifeText,
    batchSize,
    storageCondition: formatStorageCondition(coa?.bom_storage_condition, coa?.item_storage_condition, lang),
    presentation: formatPresentationText(coa?.bom_specification, coa?.tests_per_kit, goodQty, coa?.uom, lang),
    standardCode: standardDisplay,
    includeActualColumn,
    rows,
    overallPassed,
    conclusionPrefix: lang === "EN" ? "CONCLUSION:" : lang === "VI" ? "KẾT LUẬN:" : "KẾT LUẬN (CONCLUSION):",
    conclusionBody: overallPassed
      ? lang === "EN"
        ? cfg.coa.conclusion_pass_en
        : cfg.coa.conclusion_pass_vi
      : lang === "EN"
        ? cfg.coa.conclusion_fail_en
        : cfg.coa.conclusion_fail_vi,
    analystTitleMain: lang === "EN" ? "TESTED BY" : cfg.analyst_label_vi,
    analystTitleSub: lang === "EN" ? "QC Analyst" : lang === "VI" ? null : cfg.analyst_label_en,
    analystVerifiedText: lang === "EN" ? cfg.analyst_verified_en : cfg.analyst_verified_vi,
    managerTitleMain: lang === "EN" ? "APPROVED BY" : cfg.manager_label_vi,
    managerTitleSub: lang === "EN" ? cfg.manager_label_en : lang === "VI" ? null : cfg.manager_label_en,
    managerVerifiedText: lang === "EN" ? cfg.manager_verified_en : cfg.manager_verified_vi,
    analyst: resolveQcSignature(analystRaw, "ANALYST", cfg),
    manager: resolveQcSignature(managerRaw, "MANAGER", cfg),
    isSuperseded: Boolean(coa?.is_superseded),
    customNotes: coa?.custom_notes ? String(coa.custom_notes) : null,
  };
}

const OFFICIAL_SHEET_CSS = `
@page { size: A4; margin: 12mm 13mm; }
* { box-sizing: border-box; }
body { font-family: Arial, Helvetica, sans-serif; color: #0f172a; margin: 0; padding: 16px; background: #f1f5f9; font-size: 9pt; line-height: 1.38; }
.no-print { max-width: 210mm; margin: 0 auto 12px; display: flex; flex-wrap: wrap; gap: 8px; justify-content: space-between; align-items: center; background: #fff; padding: 10px 14px; border-radius: 8px; border: 1px solid #cbd5e1; font-size: 12px; }
.no-print-btn { background: #1e40af; color: #fff; border: none; padding: 7px 13px; border-radius: 6px; font-weight: bold; cursor: pointer; font-size: 12px; }
.no-print-btn.alt { background: #f1f5f9; color: #1e293b; border: 1px solid #cbd5e1; }
.no-print-btn.active { background: #0f766e; color: #fff; border-color: #0f766e; }
.print-sheet { width: 210mm; min-height: 297mm; margin: 0 auto; background: #fff; padding: 12mm 13mm; box-shadow: 0 4px 20px rgba(15,23,42,0.09); border-radius: 4px; }
.doc-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; border-bottom: 2px solid #1e40af; padding-bottom: 9px; margin-bottom: 12px; }
.doc-head-left { flex: 1; }
.co-name-vi { font-size: 10.5pt; font-weight: 800; color: #1e3a8a; line-height: 1.25; }
.co-name-en { font-size: 8.5pt; font-weight: 700; color: #475569; margin-top: 2px; line-height: 1.25; }
.co-addr { font-size: 7.8pt; color: #475569; margin-top: 3px; line-height: 1.3; }
.doc-head-right { text-align: right; font-size: 8.3pt; color: #334155; white-space: nowrap; line-height: 1.48; }
.doc-title-wrap { text-align: center; margin: 6px 0 12px; }
.doc-title-main { font-size: 15.5pt; font-weight: 800; color: #1e3a8a; letter-spacing: 0.3px; margin: 0; }
.doc-title-sub { font-size: 10.5pt; font-weight: 700; color: #334155; margin-top: 2px; }
.doc-iso { font-size: 8pt; font-weight: 600; color: #15803d; margin-top: 4px; }
.sec-title { font-size: 9.5pt; font-weight: 800; color: #1e3a8a; text-transform: uppercase; margin: 11px 0 5px; }
table.official { width: 100%; border-collapse: collapse; margin: 0 0 8px; font-size: 8.6pt; }
table.official th, table.official td { border: 0.75pt solid #cbd5e1; padding: 5px 7px; vertical-align: middle; text-align: left; }
table.trace td.lbl { background: #f8fafc; font-weight: 600; color: #334155; width: 22%; }
table.trace td.val { color: #0f172a; width: 28%; }
table.results th { background: #eef2ff; color: #1e3a8a; font-weight: 700; text-align: center; line-height: 1.25; }
table.results td { vertical-align: middle; line-height: 1.35; }
.pass-text { color: #15803d; font-weight: 800; text-align: center; white-space: nowrap; }
.fail-text { color: #b91c1c; font-weight: 800; text-align: center; white-space: nowrap; }
.conclusion-box { border: 1pt solid #86efac; background: #f0fdf4; color: #166534; padding: 8px 11px; border-radius: 4px; font-size: 8.7pt; line-height: 1.42; margin: 5px 0 14px; page-break-inside: avoid; }
.conclusion-box.fail { border-color: #fca5a5; background: #fef2f2; color: #991b1b; }
.sig-grid { display: flex; justify-content: space-between; gap: 20px; margin-top: 12px; page-break-inside: avoid; }
.sig-col { flex: 1; text-align: center; }
.sig-title { font-size: 8.8pt; font-weight: 800; color: #0f172a; text-transform: uppercase; }
.sig-sub { font-size: 8.2pt; color: #334155; margin-top: 1px; }
.sig-img-wrap { height: 64px; display: flex; align-items: center; justify-content: center; margin: 4px 0 2px; }
.sig-img-wrap img { max-height: 58px; max-width: 175px; object-fit: contain; display: block; }
.sig-name { font-size: 9pt; font-weight: 800; color: #0f172a; }
.sig-verified { font-size: 7.7pt; color: #15803d; font-weight: 600; margin-top: 2px; }
.doc-foot { margin-top: 14px; font-size: 7.5pt; color: #64748b; text-align: center; border-top: 0.5pt solid #e2e8f0; padding-top: 5px; }
.superseded-banner { border: 2px solid #dc2626; background: #fef2f2; color: #b91c1c; padding: 6px 10px; margin-bottom: 8px; text-align: center; font-weight: bold; }
@media print {
  body { background: #fff; padding: 0; }
  .no-print { display: none !important; }
  .print-sheet { width: auto; min-height: 0; margin: 0; padding: 0; box-shadow: none; border-radius: 0; }
}
`;

function renderSignatureColumnHtml(
  titleMain: string,
  titleSub: string | null,
  resolved: ResolvedQcSignature,
  verifiedText: string
): string {
  const imgTag = resolved.signatureUrl
    ? `<img src="${esc(resolved.signatureUrl)}" alt="Chữ ký ${esc(resolved.displayName)}" />`
    : `<span style="color:#cbd5e1;font-size:8pt;">(Chưa có ảnh chữ ký)</span>`;
  return `<div class="sig-col">
    <div class="sig-title">${esc(titleMain)}</div>
    ${titleSub ? `<div class="sig-sub">${esc(titleSub)}</div>` : ""}
    <div class="sig-img-wrap">${imgTag}</div>
    <div class="sig-name">${esc(resolved.displayName)}</div>
    <div class="sig-verified">${esc(verifiedText)}</div>
  </div>`;
}

export function buildQcTestReportSheetHtml(m: QcTestReportViewModel): string {
  const cfg = m.config;
  const rowsHtml =
    m.rows.length > 0
      ? m.rows
          .map((r) => {
            const evalCls = r.passed === false ? "fail-text" : "pass-text";
            const evalTxt = r.passed === false ? "KHÔNG ĐẠT (FAIL)" : r.passed === true ? "ĐẠT (PASS)" : "—";
            return `<tr>
              <td style="text-align:center;">${esc(r.seq)}</td>
              <td><b>${esc(r.name)}</b></td>
              <td>
                <div><b>Phương pháp:</b> ${esc(r.method)}</div>
                ${r.equipment ? `<div style="color:#1d4ed8;margin-top:2px;"><b>Thiết bị:</b> ${esc(r.equipment)}</div>` : ""}
              </td>
              <td>${esc(r.spec)}</td>
              <td style="text-align:center;"><b>${esc(r.actual)}</b></td>
              <td class="${evalCls}">${evalTxt}</td>
            </tr>`;
          })
          .join("")
      : `<tr><td colspan="6" style="text-align:center;color:#64748b;">Chưa có chỉ tiêu kiểm nghiệm trên phiếu QC</td></tr>`;

  const oligoSection = m.oligoRef
    ? `<table class="official trace" style="margin-top:4px;">
        <tr>
          <td class="lbl">Trình tự 5'→3':</td>
          <td colspan="3" style="font-family:'Courier New',monospace;word-break:break-all;">${esc(m.oligoRef.normalized_sequence)}</td>
        </tr>
        <tr>
          <td class="lbl">Số base / MW:</td>
          <td class="val">${esc(m.oligoRef.base_count)} nt · ${num(Number(m.oligoRef.mw))} Da</td>
          <td class="lbl">Thang / Tinh sạch:</td>
          <td class="val">${esc(m.oligoRef.scale_code)} · ${esc(m.oligoRef.purification)}</td>
        </tr>
      </table>`
    : "";

  return `<div class="doc-head">
      <div class="doc-head-left">
        <div class="co-name-vi">${esc(cfg.company_name_vi)}</div>
        <div class="co-name-en">${esc(cfg.company_name_en)}</div>
        <div class="co-addr">${esc(cfg.address_vi)}</div>
        <div class="co-addr">Điện thoại: ${esc(cfg.phone)} | Email: ${esc(cfg.email)}</div>
      </div>
      <div class="doc-head-right">
        <div>Mã số phiếu KQ: <b>${esc(m.reportCode)}</b></div>
        <div>Mã phiếu QC: <b>${esc(m.qcTestCode)}</b></div>
        <div>Biểu mẫu: ${esc(m.formCode)}</div>
        <div>Ngày ban hành: ${esc(m.issueDate)}</div>
      </div>
    </div>

    <div class="doc-title-wrap">
      <div class="doc-title-main">${esc(cfg.qc_report.title_en)}</div>
      <div class="doc-title-sub">${esc(cfg.qc_report.title_vi)}</div>
      <div class="doc-iso">${esc(cfg.iso_badge_vi)}</div>
    </div>

    <div class="sec-title">I. THÔNG TIN TRUY XUẤT LÔ HÀNG (PRODUCT &amp; BATCH TRACEABILITY)</div>
    <table class="official trace">
      <tr>
        <td class="lbl">Tên sản phẩm / Product Name:</td>
        <td class="val"><b>${esc(m.productName)}</b></td>
        <td class="lbl">Số lô / Batch (Lot) No.:</td>
        <td class="val"><b style="color:#1e40af;">${esc(m.lotCode)}</b></td>
      </tr>
      <tr>
        <td class="lbl">Mã sản phẩm / Catalog No.:</td>
        <td class="val">${esc(m.catalogNo)}</td>
        <td class="lbl">Lệnh sản xuất / Order No.:</td>
        <td class="val">${esc(m.orderNo)}</td>
      </tr>
      <tr>
        <td class="lbl">Ngày sản xuất / Mfg. Date:</td>
        <td class="val">${esc(m.mfgDate)}</td>
        <td class="lbl">Hạn sử dụng / Expiry Date:</td>
        <td class="val"><b>${esc(m.expiryDate)}</b>${m.shelfLifeMonths ? ` (${m.shelfLifeMonths} tháng)` : ""}</td>
      </tr>
      <tr>
        <td class="lbl">Số lượng lô / Batch Size:</td>
        <td class="val">${esc(m.batchSize)}</td>
        <td class="lbl">Điều kiện bảo quản / Storage:</td>
        <td class="val">${esc(m.storageCondition)}</td>
      </tr>
      <tr>
        <td class="lbl">Quy cách / Presentation:</td>
        <td class="val">${esc(m.presentation)}</td>
        <td class="lbl">Tiêu chuẩn / Standard:</td>
        <td class="val">${esc(m.standardCode)}</td>
      </tr>
    </table>
    ${oligoSection}

    <div class="sec-title">II. CHỈ TIÊU KIỂM NGHIỆM VÀ KẾT QUẢ THỬ NGHIỆM (ANALYSIS &amp; TEST RESULTS)</div>
    <table class="official results">
      <thead>
        <tr>
          <th style="width:6%;">STT<br>No.</th>
          <th style="width:21%;">Chỉ tiêu kiểm tra<br>Test Parameter</th>
          <th style="width:26%;">Phương pháp &amp; Thiết bị kiểm tra<br>Test Method &amp; Equipment</th>
          <th style="width:21%;">Yêu cầu kỹ thuật / Tiêu chuẩn<br>Specifications</th>
          <th style="width:14%;">Kết quả kiểm nghiệm<br>Actual Result</th>
          <th style="width:12%;">Đánh giá<br>Conclusion</th>
        </tr>
      </thead>
      <tbody>${rowsHtml}</tbody>
    </table>

    <div class="sec-title">III. KẾT LUẬN VÀ PHÊ DUYỆT (CONCLUSION &amp; APPROVAL)</div>
    <div class="conclusion-box ${m.overallPassed ? "" : "fail"}">
      <b>${esc(m.conclusionPrefix)}</b> ${esc(m.conclusionBody)}
    </div>

    <div class="sig-grid">
      ${renderSignatureColumnHtml(cfg.analyst_label_vi, cfg.analyst_label_en, m.analyst, cfg.analyst_verified_vi)}
      ${renderSignatureColumnHtml(cfg.manager_label_vi, cfg.manager_label_en, m.manager, cfg.manager_verified_vi)}
    </div>
    ${cfg.footer_note ? `<div class="doc-foot">${esc(cfg.footer_note)}</div>` : ""}`;
}

export function buildQcTestReportHtml(
  data: any,
  configOverrides?: Partial<QcFormsConfig> | null,
  signerOverrides?: QcSignerOverrides | null
): string {
  const m = prepareQcTestReportModel(data, configOverrides, signerOverrides);
  const sheetHtml = buildQcTestReportSheetHtml(m);
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8">${safeOriginBase()}<title>${esc(m.reportCode)} - ${esc(m.formCode)}</title><style>${OFFICIAL_SHEET_CSS}</style></head><body>
<div class="no-print">
  <div><b>📋 Phiếu trả kết quả QC ${esc(m.reportCode)}</b> (${esc(m.formCode)}) — Chi tiết từng chỉ tiêu</div>
  <div style="display:flex;gap:8px">
    <button class="no-print-btn" onclick="window.print()">🖨️ In / Lưu PDF (A4)</button>
    <button class="no-print-btn alt" onclick="window.close()">Đóng</button>
  </div>
</div>
<div class="print-sheet">${sheetHtml}</div>
</body></html>`;
}

export function getCoaSheetLabels(lang: CoaExportLang) {
  if (lang === "EN") {
    return {
      coaNo: "COA No.:",
      qcRef: "QC Test Ref.:",
      formCode: "Form Code:",
      issueDate: "Issue Date:",
      product: "Product Name:",
      lot: "Batch (Lot) No.:",
      catalog: "Catalog No.:",
      order: "Order No.:",
      mfg: "Mfg. Date:",
      exp: "Expiry Date:",
      size: "Batch Size:",
      storage: "Storage Condition:",
      pres: "Presentation:",
      std: "Standard:",
      colSeq: "No.",
      colParam: "Test Parameter",
      colMethod: "Test Method",
      colSpec: "Specifications",
      colObs: "Actual Result",
      colRes: "General Result",
    };
  }
  if (lang === "VI") {
    return {
      coaNo: "Mã số COA:",
      qcRef: "Mã phiếu QC:",
      formCode: "Biểu mẫu:",
      issueDate: "Ngày ban hành:",
      product: "Tên sản phẩm:",
      lot: "Số lô (Lot):",
      catalog: "Mã sản phẩm:",
      order: "Lệnh sản xuất:",
      mfg: "Ngày sản xuất:",
      exp: "Hạn sử dụng:",
      size: "Số lượng lô:",
      storage: "Điều kiện bảo quản:",
      pres: "Quy cách:",
      std: "Tiêu chuẩn áp dụng:",
      colSeq: "STT",
      colParam: "Chỉ tiêu kiểm tra",
      colMethod: "Phương pháp kiểm tra",
      colSpec: "Yêu cầu kỹ thuật / Tiêu chuẩn",
      colObs: "Kết quả thực tế",
      colRes: "Kết quả chung",
    };
  }
  return {
    coaNo: "Mã số COA:",
    qcRef: "Mã phiếu QC:",
    formCode: "Biểu mẫu:",
    issueDate: "Ngày ban hành:",
    product: "Tên sản phẩm / Product Name:",
    lot: "Số lô / Batch (Lot) No.:",
    catalog: "Mã sản phẩm / Catalog No.:",
    order: "Lệnh sản xuất / Order No.:",
    mfg: "Ngày sản xuất / Mfg. Date:",
    exp: "Hạn sử dụng / Expiry Date:",
    size: "Số lượng lô / Batch Size:",
    storage: "Điều kiện bảo quản / Storage:",
    pres: "Quy cách / Presentation:",
    std: "Tiêu chuẩn / Standard:",
    colSeq: "STT<br>No.",
    colParam: "Chỉ tiêu kiểm tra<br>Test Parameter",
    colMethod: "Phương pháp kiểm tra<br>Test Method",
    colSpec: "Yêu cầu kỹ thuật / Tiêu chuẩn<br>Specifications",
    colObs: "Kết quả thực tế<br>Actual Result",
    colRes: "Kết quả chung<br>General Result",
  };
}

export function buildCoaCertificateSheetHtml(m: CoaCertificateViewModel): string {
  const isEn = m.lang === "EN";
  const lbl = getCoaSheetLabels(m.lang);

  const rowsHtml = m.rows
    .map((r) => {
      const cls = r.passed ? "pass-text" : "fail-text";
      return `<tr>
        <td style="text-align:center;">${esc(r.seq)}</td>
        <td><b>${esc(r.parameter)}</b></td>
        <td>${esc(r.method)}</td>
        <td>${esc(r.spec)}</td>
        ${m.includeActualColumn ? `<td style="text-align:center;"><b>${esc(r.observed)}</b></td>` : ""}
        <td class="${cls}">${esc(r.resultText)}</td>
      </tr>`;
    })
    .join("");

  const tableHeadHtml = m.includeActualColumn
    ? `<tr>
        <th style="width:6%;">${lbl.colSeq}</th>
        <th style="width:22%;">${lbl.colParam}</th>
        <th style="width:20%;">${lbl.colMethod}</th>
        <th style="width:24%;">${lbl.colSpec}</th>
        <th style="width:15%;">${lbl.colObs}</th>
        <th style="width:13%;">${lbl.colRes}</th>
      </tr>`
    : `<tr>
        <th style="width:7%;">${lbl.colSeq}</th>
        <th style="width:23%;">${lbl.colParam}</th>
        <th style="width:20%;">${lbl.colMethod}</th>
        <th style="width:35%;">${lbl.colSpec}</th>
        <th style="width:15%;">${lbl.colRes}</th>
      </tr>`;

  return `${m.isSuperseded ? `<div class="superseded-banner">⚠️ ${isEn ? "SUPERSEDED VERSION — REFERENCE ONLY" : "BẢN ĐÃ THAY THẾ / SUPERSEDED — CHỈ DÙNG TRA CỨU LỊCH SỬ"}</div>` : ""}
    <div class="doc-head">
      <div class="doc-head-left">
        <div class="co-name-vi">${esc(m.companyNamePrimary)}</div>
        ${m.companyNameSecondary ? `<div class="co-name-en">${esc(m.companyNameSecondary)}</div>` : ""}
        <div class="co-addr">${esc(m.addressText)}</div>
        <div class="co-addr">${esc(m.contactText)}</div>
      </div>
      <div class="doc-head-right">
        <div>${esc(lbl.coaNo)} <b>${esc(m.coaCode)}</b></div>
        <div>${esc(lbl.qcRef)} <b>${esc(m.qcTestCode)}</b></div>
        <div>${esc(lbl.formCode)} ${esc(m.formCode)}</div>
        <div>${esc(lbl.issueDate)} ${esc(m.issueDate)}</div>
      </div>
    </div>

    <div class="doc-title-wrap">
      <div class="doc-title-main">${esc(m.titleMain)}</div>
      ${m.titleSub ? `<div class="doc-title-sub">${esc(m.titleSub)}</div>` : ""}
      <div class="doc-iso">${esc(m.isoBadge)}</div>
    </div>

    <div class="sec-title">${esc(m.section1Title)}</div>
    <table class="official trace">
      <tr>
        <td class="lbl">${esc(lbl.product)}</td>
        <td class="val"><b>${esc(m.productName)}</b></td>
        <td class="lbl">${esc(lbl.lot)}</td>
        <td class="val"><b style="color:#1e40af;">${esc(m.lotCode)}</b></td>
      </tr>
      <tr>
        <td class="lbl">${esc(lbl.catalog)}</td>
        <td class="val">${esc(m.catalogNo)}</td>
        <td class="lbl">${esc(lbl.order)}</td>
        <td class="val">${esc(m.orderNo)}</td>
      </tr>
      <tr>
        <td class="lbl">${esc(lbl.mfg)}</td>
        <td class="val">${esc(m.mfgDate)}</td>
        <td class="lbl">${esc(lbl.exp)}</td>
        <td class="val"><b>${esc(m.expiryDate)}</b>${m.shelfLifeText ? ` ${esc(m.shelfLifeText)}` : ""}</td>
      </tr>
      <tr>
        <td class="lbl">${esc(lbl.size)}</td>
        <td class="val">${esc(m.batchSize)}</td>
        <td class="lbl">${esc(lbl.storage)}</td>
        <td class="val">${esc(m.storageCondition)}</td>
      </tr>
      <tr>
        <td class="lbl">${esc(lbl.pres)}</td>
        <td class="val">${esc(m.presentation)}</td>
        <td class="lbl">${esc(lbl.std)}</td>
        <td class="val">${esc(m.standardCode)}</td>
      </tr>
    </table>

    <div class="sec-title">${esc(m.section2Title)}</div>
    <table class="official results">
      <thead>${tableHeadHtml}</thead>
      <tbody>${rowsHtml}</tbody>
    </table>
    ${m.customNotes ? `<div style="font-size:8.3pt;color:#334155;margin:4px 0 6px;"><b>${isEn ? "Remarks:" : "Ghi chú:"}</b> ${esc(m.customNotes)}</div>` : ""}

    <div class="sec-title">${esc(m.section3Title)}</div>
    <div class="conclusion-box ${m.overallPassed ? "" : "fail"}">
      <b>${esc(m.conclusionPrefix)}</b> ${esc(m.conclusionBody)}
    </div>

    <div class="sig-grid">
      ${renderSignatureColumnHtml(m.analystTitleMain, m.analystTitleSub, m.analyst, m.analystVerifiedText)}
      ${renderSignatureColumnHtml(m.managerTitleMain, m.managerTitleSub, m.manager, m.managerVerifiedText)}
    </div>
    ${m.config.footer_note ? `<div class="doc-foot">${esc(m.config.footer_note)}</div>` : ""}`;
}

export function buildCoaCertificateHtml(
  coa: any,
  configOverrides?: Partial<QcFormsConfig> | null,
  lang: CoaExportLang = "BI",
  signerOverrides?: QcSignerOverrides | null
): string {
  const m = prepareCoaCertificateModel(coa, configOverrides, lang, signerOverrides);
  const sheetHtml = buildCoaCertificateSheetHtml(m);
  return `<!doctype html><html lang="${lang === "EN" ? "en" : "vi"}"><head><meta charset="utf-8">${safeOriginBase()}<title>${esc(m.coaCode)} - ${esc(m.lotCode)}</title><style>${OFFICIAL_SHEET_CSS}</style></head><body>
<div class="no-print">
  <div><b>📜 ${esc(m.coaCode)}</b> (${esc(m.formCode)} · ${lang === "EN" ? "English" : lang === "VI" ? "Tiếng Việt" : "Song ngữ Mẫu chuẩn"})</div>
  <div style="display:flex;gap:8px">
    <button class="no-print-btn" onclick="window.print()">🖨️ ${lang === "EN" ? "Print / Save PDF (A4)" : "In / Lưu PDF (A4)"}</button>
    <button class="no-print-btn alt" onclick="window.close()">${lang === "EN" ? "Close" : "Đóng"}</button>
  </div>
</div>
<div class="print-sheet">${sheetHtml}</div>
</body></html>`;
}

function wrapCoaPopupWithLangSwitcher(
  coa: any,
  configOverrides?: Partial<QcFormsConfig> | null,
  initialLang: CoaExportLang = "BI",
  signerOverrides?: QcSignerOverrides | null
): string {
  const sheets: Record<CoaExportLang, string> = {
    BI: buildCoaCertificateSheetHtml(prepareCoaCertificateModel(coa, configOverrides, "BI", signerOverrides)),
    VI: buildCoaCertificateSheetHtml(prepareCoaCertificateModel(coa, configOverrides, "VI", signerOverrides)),
    EN: buildCoaCertificateSheetHtml(prepareCoaCertificateModel(coa, configOverrides, "EN", signerOverrides)),
  };
  const safeJson = JSON.stringify(sheets).replace(/</g, "\\u003c");
  return `<!doctype html><html lang="${initialLang === "EN" ? "en" : "vi"}"><head><meta charset="utf-8">${safeOriginBase()}<title>${esc(coa?.code || "COA")} - ${esc(coa?.lot_code || "")}</title><style>${OFFICIAL_SHEET_CSS}</style></head><body>
<div class="no-print">
  <div><b>📜 Phiếu COA ${esc(coa?.code || "")}</b> — Lô <b>${esc(coa?.lot_code || "")}</b></div>
  <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center">
    <button id="btn-BI" class="no-print-btn ${initialLang === "BI" ? "active" : "alt"}" onclick="window.__setCoaLang('BI')">Song ngữ (Mẫu chuẩn)</button>
    <button id="btn-VI" class="no-print-btn ${initialLang === "VI" ? "active" : "alt"}" onclick="window.__setCoaLang('VI')">🇻🇳 Tiếng Việt</button>
    <button id="btn-EN" class="no-print-btn ${initialLang === "EN" ? "active" : "alt"}" onclick="window.__setCoaLang('EN')">🇬🇧 English</button>
    <button class="no-print-btn" onclick="window.print()">🖨️ In / Lưu PDF (A4)</button>
    <button class="no-print-btn alt" onclick="window.close()">Đóng</button>
  </div>
</div>
<div id="coa-sheet" class="print-sheet">${sheets[initialLang]}</div>
<script>
window.__coaSheets = ${safeJson};
window.__setCoaLang = function(lang) {
  var el = document.getElementById('coa-sheet');
  if (el && window.__coaSheets[lang]) el.innerHTML = window.__coaSheets[lang];
  ['BI','VI','EN'].forEach(function(k) {
    var b = document.getElementById('btn-' + k);
    if (b) b.className = 'no-print-btn ' + (k === lang ? 'active' : 'alt');
  });
};
</script>
</body></html>`;
}
interface Result { name: string; unit: string | null; method?: string | null; value_type: string; lower_limit: number | string | null; upper_limit: number | string | null; target: string | null }
const spec = (p: Result) =>
  p.value_type === "NUMERIC"
    ? [p.lower_limit != null ? `≥ ${num(Number(p.lower_limit))}` : "", p.upper_limit != null ? `≤ ${num(Number(p.upper_limit))}` : ""].filter(Boolean).join(", ")
    : p.value_type === "PASS_FAIL"
      ? "Đạt"
      : p.target ?? "";
const value = (r: { value_numeric: number | string | null; observed_numeric?: number | string | null; value_text: string | null }, unit: string | null) =>
  r.value_numeric != null
    ? `${num(Number(r.value_numeric))} ${esc(unit ?? "")}${r.observed_numeric != null ? ` (đo ${num(Number(r.observed_numeric))})` : ""}`
    : r.value_text === "PASS" ? "Đạt" : r.value_text === "FAIL" ? "Không đạt" : esc(r.value_text);
const sig = (s: { signer_name: string; signed_at: string } | null) => (s ? `${esc(s.signer_name)} — ký điện tử ${new Date(s.signed_at).toLocaleString("vi-VN")}` : "");

function page(title: string, header: string | null, body: string, footer: string | null) {
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8">${safeOriginBase()}<title>${esc(title)}</title><style>
@page { size: A4; margin: 14mm 12mm }
body { font: 10pt/1.35 Arial, sans-serif; color: #000; margin: 0; padding: 16px; background: #f1f5f9 }
.print-sheet { max-width: 210mm; margin: 0 auto; background: #fff; padding: 14mm 12mm; box-shadow: 0 4px 16px rgba(0,0,0,0.08); border-radius: 6px }
.no-print { max-width: 210mm; margin: 0 auto 12px; display: flex; justify-content: space-between; align-items: center; background: #fff; padding: 10px 14px; border-radius: 6px; border: 1px solid #cbd5e1; font-family: Arial, sans-serif; font-size: 12px }
.no-print-btn { background: #0284c7; color: #fff; border: none; padding: 7px 14px; border-radius: 6px; font-weight: bold; cursor: pointer; font-size: 12px }
.head { border-bottom: 1.5pt solid #000; padding-bottom: 4pt; margin-bottom: 8pt; font-size: 9pt }
h1 { text-align: center; font-size: 14pt; margin: 6pt 0 2pt } .sub { text-align: center; margin-bottom: 8pt }
table { width: 100%; border-collapse: collapse; margin: 6pt 0 } th, td { border: 0.5pt solid #555; padding: 2pt 4pt; vertical-align: top; text-align: left }
th { background: #eee } .seq { font-family: "Courier New", monospace; word-break: break-all; font-size: 8.5pt } .r { text-align: right }
.meta td { border: none; padding: 1pt 4pt } .sign { margin-top: 10pt } .foot { margin-top: 12pt; font-size: 8.5pt; border-top: 0.5pt solid #555; padding-top: 4pt }
.block { page-break-inside: avoid; margin-bottom: 10pt }
@media print {
  body { background: #fff; padding: 0 }
  .no-print { display: none !important }
  .print-sheet { max-width: none; margin: 0; padding: 0; box-shadow: none; border-radius: 0 }
}
</style></head><body>
<div class="no-print">
  <div><b>📄 ${esc(title)}</b> — Bản in chuẩn A4</div>
  <div style="display:flex;gap:8px">
    <button class="no-print-btn" onclick="window.print()">🖨️ In / Lưu PDF (A4)</button>
    <button class="no-print-btn" style="background:#475569" onclick="window.close()">Đóng</button>
  </div>
</div>
<div class="print-sheet">
  <div class="head">${lines(header)}</div>${body}<div class="foot">${lines(footer)}</div>
</div>
</body></html>`;
}

export function openPrintWindowSync(title = "Đang chuẩn bị bản in..."): Window | null {
  const w = window.open("", "_blank", "width=1020,height=860");
  if (w) {
    w.document.open();
    w.document.write(
      `<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>${esc(title)}</title></head><body style="font-family:Arial,sans-serif;padding:24px;color:#334155">⏳ Đang tải dữ liệu bản in...</body></html>`
    );
    w.document.close();
  }
  return w;
}

function waitForDocumentImagesAndPrint(doc: Document | null | undefined, onPrint: () => void) {
  const imgs = doc ? Array.from(doc.images || []) : [];
  const pending = imgs.filter((img) => !img.complete);
  if (pending.length === 0) {
    setTimeout(onPrint, 180);
    return;
  }
  let fired = false;
  const trigger = () => {
    if (fired) return;
    fired = true;
    onPrint();
  };
  let remaining = pending.length;
  const onDone = () => {
    remaining -= 1;
    if (remaining <= 0) trigger();
  };
  pending.forEach((img) => {
    img.addEventListener("load", onDone, { once: true });
    img.addEventListener("error", onDone, { once: true });
  });
  setTimeout(trigger, 600);
}

export function renderHtmlToPrintWindow(html: string, existingWin?: Window | null) {
  const w = existingWin ?? window.open("", "_blank", "width=1020,height=860");
  if (w) {
    w.document.open();
    w.document.write(html);
    w.document.close();
    waitForDocumentImagesAndPrint(w.document, () => {
      try {
        w.focus();
        w.print();
      } catch {
        // user can also click the Print button inside the window
      }
    });
    return;
  }

  // Fallback if browser blocks popups: hide main app during print and print isolated iframe
  const style = document.createElement("style");
  style.id = "__abt_print_isolation__";
  style.textContent = `@media print { body > *:not(#__abt_print_frame__) { display: none !important; } #__abt_print_frame__ { position: static !important; width: 100% !important; height: auto !important; border: 0 !important; } }`;
  document.head.appendChild(style);

  const frame = document.createElement("iframe");
  frame.id = "__abt_print_frame__";
  frame.style.cssText = "position:fixed;width:1px;height:1px;border:0;right:0;bottom:0;opacity:0";
  document.body.appendChild(frame);
  const doc = frame.contentDocument!;
  doc.open();
  doc.write(html);
  doc.close();
  waitForDocumentImagesAndPrint(doc, () => {
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
  });
  setTimeout(() => {
    frame.remove();
    style.remove();
  }, 60_000);
}

/** Print an arbitrary DOM container (e.g., rendered Label Artwork / VisualLabelCanvas) in an isolated print window. */
export function printElementHtml(el: HTMLElement | null, title = "Bản in Tem Nhãn Sản Phẩm") {
  if (!el) return;
  const win = openPrintWindowSync(title);
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const clone = el.cloneNode(true) as HTMLElement;
  // Resolve relative image URLs so about:blank print popups always render /logo-abt.png cleanly
  clone.querySelectorAll<HTMLImageElement>("img").forEach((img) => {
    if (img.src) img.setAttribute("src", img.src);
  });
  // Clean up interactive selection outlines & dark background grids for crisp label printing
  clone.querySelectorAll<HTMLElement>("*").forEach((node) => {
    if (node.style?.outline && node.style.outline.includes("dashed")) {
      node.style.outline = "none";
    }
    if (node.style?.backgroundImage && node.style.backgroundImage.includes("linear-gradient(to right")) {
      node.style.backgroundImage = "none";
    }
  });
  const baseTag = origin ? `<base href="${esc(origin)}/">` : "";
  const html = `<!doctype html><html lang="vi"><head><meta charset="utf-8">${baseTag}<title>${esc(title)}</title><style>
@page { margin: 8mm }
body { font-family: Arial, Helvetica, sans-serif; margin: 0; padding: 16px; background: #f1f5f9; color: #0f172a }
.no-print { max-width: 980px; margin: 0 auto 14px; display: flex; justify-content: space-between; align-items: center; background: #fff; padding: 10px 14px; border-radius: 6px; border: 1px solid #cbd5e1; font-size: 12px }
.no-print-btn { background: #0284c7; color: #fff; border: none; padding: 7px 14px; border-radius: 6px; font-weight: bold; cursor: pointer; font-size: 12px }
.print-stage { max-width: 980px; margin: 0 auto; background: #fff; padding: 16px; border-radius: 8px; display: flex; flex-wrap: wrap; gap: 16px; justify-content: center; align-items: center }
@media print {
  body { background: #fff; padding: 0 }
  .no-print { display: none !important }
  .print-stage { max-width: none; padding: 0; box-shadow: none }
}
</style></head><body>
<div class="no-print">
  <div><b>🏷️ ${esc(title)}</b> — Bản in thử trực tiếp từ Thiết kế Nhãn</div>
  <div style="display:flex;gap:8px">
    <button class="no-print-btn" onclick="window.print()">🖨️ In Tem Nhãn</button>
    <button class="no-print-btn" style="background:#475569" onclick="window.close()">Đóng</button>
  </div>
</div>
<div class="print-stage">${clone.innerHTML}</div>
</body></html>`;
  renderHtmlToPrintWindow(html, win);
}

/** In Phiếu trả kết quả QC (`BM-QC-TR-01`) từ dữ liệu đã tải sẵn. */
export function printLoadedQcTestReport(
  data: any,
  configOverrides?: Partial<QcFormsConfig> | null,
  signerOverrides?: QcSignerOverrides | null
) {
  if (!data) return;
  const win = openPrintWindowSync(`Phiếu trả kết quả QC ${data?.test?.code ?? ""}`);
  renderHtmlToPrintWindow(buildQcTestReportHtml(data, configOverrides, signerOverrides), win);
}

/** Quality Test Report (`BM-QC-TR-01`) of one reviewed QC test (detailed individual parameters, methods & equipment). */
export async function printTestCoa(
  testId: string,
  configOverrides?: Partial<QcFormsConfig> | null,
  signerOverrides?: QcSignerOverrides | null
) {
  const win = openPrintWindowSync("Đang tải Phiếu trả kết quả QC (BM-QC-TR-01)...");
  try {
    const data = await api<any>(`/api/factory/qms/tests/${testId}/coa`);
    renderHtmlToPrintWindow(buildQcTestReportHtml(data, configOverrides, signerOverrides), win);
  } catch (err) {
    win?.close();
    throw err;
  }
}

/**
 * In Giấy Chứng Nhận Phân Tích (`kit.coa_certificate` — `BM-QC-COA-01`)
 * trong cửa sổ in độc lập chuẩn A4 với thanh chuyển đổi nhanh Song ngữ / Tiếng Việt / Tiếng Anh
 * và đầy đủ chữ ký nhân viên QC/QA.
 */
export function printKitCoaCertificate(
  coa: any,
  configOrTemplate?: Partial<QcFormsConfig> | Record<string, any> | null,
  lang: CoaExportLang = "BI",
  signerOverrides?: QcSignerOverrides | null
) {
  if (!coa) return;
  let configOverrides: Partial<QcFormsConfig> | null = null;
  if (configOrTemplate && typeof configOrTemplate === "object") {
    const obj = configOrTemplate as Record<string, any>;
    if ("company_name_vi" in obj || "qc_report" in obj || "coa" in obj || "staff_signatures" in obj) {
      configOverrides = obj as Partial<QcFormsConfig>;
    } else {
      configOverrides = normalizeQcFormsConfig(obj, null);
    }
  }
  const win = openPrintWindowSync(`Phiếu COA ${coa.code ?? ""} - Lô ${coa.lot_code ?? ""}`);
  const html = wrapCoaPopupWithLangSwitcher(coa, configOverrides, lang, signerOverrides);
  renderHtmlToPrintWindow(html, win);
}

/**
 * COA of an Oligo order following enterprise & ISO 13485 Oligo Synthesis standards:
 * - 1 Consolidated COA for all Primer & Probe sequences in the order ("COA Chung cho tất cả Primer / Probe").
 * - 1 Separate, dedicated COA page per Amplicon sequence ("COA Riêng cho từng Amplicon").
 */
export type OrderCoaMode = "ALL" | "PRIMER_PROBE_ONLY" | "AMPLICONS_ONLY";

export async function printOrderCoa(
  orderId: string,
  mode: OrderCoaMode = "ALL",
  singleAmpliconId?: string
) {
  const win = openPrintWindowSync("Đang chuẩn bị bản in COA Đơn Oligo...");
  let c: any;
  try {
    c = await api<any>(`/api/factory/oligo/orders/${orderId}/coa`);
  } catch (err) {
    win?.close();
    throw err;
  }
  const o = c.order;
  const allSeqs: any[] = Array.isArray(c.sequences) ? c.sequences : [];

  const isAmpliconSeq = (s: any) =>
    Boolean(
      s.is_amplicon ||
        s.product_type === "AMPLICON_LINEAR" ||
        s.product_type === "AMPLICON_PLASMID" ||
        s.oligo_role === "TEMPLATE" ||
        s.oligo_role === "POSITIVE_CONTROL"
    );

  const primerProbeSeqs = allSeqs.filter((s) => !isAmpliconSeq(s));
  const ampliconSeqs = allSeqs
    .filter((s) => isAmpliconSeq(s))
    .filter((s) => !singleAmpliconId || s.id === singleAmpliconId);

  const issueDateStr = new Date().toLocaleDateString("vi-VN");
  const quarantineBanner = c.quarantine_watermark
    ? `<div style="border:2px solid #d97706;background:#fffbeb;color:#b45309;padding:5pt 10pt;margin-bottom:8pt;text-align:center;font-weight:bold;">⛔ BẢN NHÁP / BIỆT TRỮ — CHƯA HOÀN TẤT PHÊ DUYỆT QC ĐẦY ĐỦ</div>`
    : "";
  const orderMetaHtml = `
    ${quarantineBanner}
    <table class="meta" style="width:100%;border:0.5pt solid #94a3b8;background:#f8fafc;margin-bottom:8pt;">
      <tr>
        <td style="width:18%;font-weight:bold;">Mã Đơn Oligo:</td>
        <td style="width:32%;font-weight:bold;color:#0f172a;">
          <div>${esc(o.code)}</div>
          <div style="margin-top:2pt;">${barcode128SvgMarkup(String(o.code ?? ""), 24)}</div>
        </td>
        <td style="width:18%;font-weight:bold;">Đơn nội bộ / PO KD:</td>
        <td style="width:32%;">${esc(o.internal_order_code || "—")} / <b>${esc(o.kd_po_code || "—")}</b></td>
      </tr>
      <tr>
        <td style="font-weight:bold;">Khách hàng / Dự án:</td>
        <td>${esc(o.customer_label || "—")}</td>
        <td style="font-weight:bold;">Hạn giao / Ngày cấp:</td>
        <td>${d(o.due_date) || "—"} (Cấp ngày: ${esc(issueDateStr)})</td>
      </tr>
      ${
        o.notes
          ? `<tr>
              <td style="font-weight:bold;">Ghi chú đơn hàng:</td>
              <td colspan="3">${esc(o.notes)}</td>
            </tr>`
          : ""
      }
    </table>
  `;

  const sections: string[] = [];

  // =========================================================================
  // PHẦN 1: MỘT BẢN COA CHUNG CHO TẤT CẢ PRIMER & PROBE TRONG ĐƠN HÀNG
  // =========================================================================
  if ((mode === "ALL" || mode === "PRIMER_PROBE_ONLY") && !singleAmpliconId && primerProbeSeqs.length > 0) {
    const ppRowsHtml = primerProbeSeqs
      .map((s: any, idx: number) => {
        const roleLabel =
          s.product_type === "PROBE" || (s.modifications && s.modifications.length > 0)
            ? "Probe"
            : "Primer";
        const modsText = Array.isArray(s.modifications) && s.modifications.length > 0 ? s.modifications.join(", ") : "None";
        const yieldText = s.measured
          ? `${num(s.measured.od_total)} OD · ${num(s.measured.nmol)} nmol · ${num(s.measured.ug)} µg (${s.measured.tube_count} ống)`
          : "Chưa đo OD";
        const qcBadge = s.qc ? `ĐẠT (${esc(s.qc.code)})` : "CHƯA QC";

        return `<tr>
          <td style="text-align:center;">${idx + 1}</td>
          <td><b>${esc(s.code)}</b><br><span style="font-size:8pt;color:#334155;">${esc(s.name)}</span></td>
          <td style="text-align:center;">${esc(roleLabel)}</td>
          <td class="seq">${esc(s.normalized_sequence)}</td>
          <td style="text-align:center;">${esc(modsText)}</td>
          <td class="r">${esc(s.base_count)}</td>
          <td class="r">${num(s.mw)}</td>
          <td class="r">${num(s.tm)}</td>
          <td class="r">${num(s.gc_percent)}%</td>
          <td>${esc(s.scale_code)} · ${esc(s.purification)}<br><span style="font-size:8pt;">${
            s.format === "LIQUID" ? "Dung dịch" : "Đông khô"
          }</span></td>
          <td>${yieldText}</td>
          <td style="text-align:center;font-weight:bold;">${qcBadge}</td>
        </tr>`;
      })
      .join("");

    const ppQcResultRows = primerProbeSeqs.flatMap((s: any) =>
      s.qc && Array.isArray(s.qc.results)
        ? s.qc.results.map((r: any) => ({ seqCode: s.code, ...r }))
        : []
    );

    const ppQcTableBody =
      ppQcResultRows.length > 0
        ? ppQcResultRows
            .map(
              (r: any, rIdx: number) => `<tr>
                <td>${rIdx + 1}. [${esc(r.seqCode)}] ${esc(r.name)}</td>
                <td>${esc(r.method || "—")}</td>
                <td>${spec(r)} ${esc(r.unit ?? "")}</td>
                <td>${value(r, r.unit)}</td>
                <td><b>${r.passed == null ? "—" : r.passed ? "Đạt" : "Không đạt"}</b></td>
              </tr>`
            )
            .join("")
        : `<tr><td colspan="5" style="text-align:center;color:#64748b;">Chưa có dữ liệu kiểm nghiệm QC được phê duyệt</td></tr>`;

    const allHaveQc =
      primerProbeSeqs.length > 0 &&
      primerProbeSeqs.every((s: any) => Boolean(s.qc && Array.isArray(s.qc.results) && s.qc.results.length > 0));
    const allPassed =
      allHaveQc &&
      primerProbeSeqs.every((s: any) => s.qc.results.every((r: any) => r.passed === true));
    const ppConclusion =
      allPassed && allHaveQc
        ? "ĐẠT TIÊU CHUẨN CHẤT LƯỢNG (PASSED)"
        : "BẢN XEM TRƯỚC — CHƯA HOÀN TẤT KIỂM NGHIỆM QC";
    const ppReviewerSig = primerProbeSeqs.map((s: any) => s.qc?.signature).find(Boolean) ?? null;

    const primerProbeCoaHtml = `
      <div class="coa-sheet">
        <h1>PHIẾU PHÂN TÍCH CHẤT LƯỢNG SẢN PHẨM (COA)</h1>
        <div class="sub">
          <b>CHỨNG CHỈ PHÂN TÍCH CHẤT LƯỢNG ĐƠN HÀNG — PRIMER &amp; TAQMAN PROBE</b><br>
          Số chứng chỉ: <b>COA-${esc(o.code)}-PP</b> · Tiêu chuẩn áp dụng: ISO 13485:2016 / TCCS-ABT-OLIGO
        </div>
        ${orderMetaHtml}
        <div style="font-weight:bold;margin:6pt 0 3pt;">I. BẢNG THÔNG SỐ LÝ HÓA &amp; KẾT QUẢ KIỂM ĐỊNH PRIMER / PROBE (${primerProbeSeqs.length} TRÌNH TỰ):</div>
        <table>
          <thead>
            <tr>
              <th style="width:4%;text-align:center;">#</th>
              <th style="width:13%;">Mã &amp; Tên Oligo</th>
              <th style="width:6%;text-align:center;">Loại</th>
              <th style="width:24%;">Trình tự (5' → 3')</th>
              <th style="width:8%;text-align:center;">Mod 5'/3'</th>
              <th style="width:4%;text-align:right;">Dài (nt)</th>
              <th style="width:7%;text-align:right;">MW (Da)</th>
              <th style="width:5%;text-align:right;">Tm (°C)</th>
              <th style="width:5%;text-align:right;">%GC</th>
              <th style="width:9%;">Thang / Tinh sạch</th>
              <th style="width:10%;">Lượng thu được</th>
              <th style="width:5%;text-align:center;">QC</th>
            </tr>
          </thead>
          <tbody>
            ${ppRowsHtml}
          </tbody>
        </table>

        <div style="font-weight:bold;margin:8pt 0 3pt;">II. CHỈ TIÊU KIỂM SOÁT CHẤT LƯỢNG NHÓM PRIMER &amp; PROBE:</div>
        <table>
          <thead>
            <tr>
              <th>Chỉ tiêu kiểm tra</th>
              <th>Phương pháp</th>
              <th>Tiêu chuẩn chấp nhận</th>
              <th>Kết quả</th>
              <th>Đánh giá</th>
            </tr>
          </thead>
          <tbody>
            ${ppQcTableBody}
          </tbody>
        </table>

        <p style="margin-top:6pt;"><b>KẾT LUẬN CHUNG (PRIMER &amp; PROBE): ${ppConclusion}.</b></p>
        <table class="meta" style="margin-top:12pt;width:100%;">
          <tr>
            <td style="width:50%;text-align:center;">
              <b>PHÒNG TỔNG HỢP OLIGO</b><br>
              <span style="font-size:8.5pt;color:#475569;">(Đã kiểm tra thông số tổng hợp &amp; tinh sạch)</span><br><br><br>
              <b>Tổ trưởng Tổng hợp Oligo</b>
            </td>
            <td style="width:50%;text-align:center;">
              <b>PHÒNG ĐẢM BẢO &amp; KIỂM SOÁT CHẤT LƯỢNG (QA/QC)</b><br>
              <span style="font-size:8.5pt;color:#475569;">${
                ppReviewerSig ? sig(ppReviewerSig) : "Chưa có chữ ký phê duyệt QC"
              }</span><br><br><br>
              <b>${ppReviewerSig ? esc(ppReviewerSig.signer_name) : "Trưởng bộ phận QA/QC"}</b>
            </td>
          </tr>
        </table>
      </div>
    `;
    sections.push(primerProbeCoaHtml);
  }

  // =========================================================================
  // PHẦN 2: COA RIÊNG BIỆT CHO TỪNG TRÌNH TỰ AMPLICON (MỖI AMPLICON 1 TRANG ĐỘC LẬP)
  // =========================================================================
  if ((mode === "ALL" || mode === "AMPLICONS_ONLY") && ampliconSeqs.length > 0) {
    ampliconSeqs.forEach((amp: any, idx: number) => {
      const needPageBreak = sections.length > 0 || idx > 0;
      const yieldStr = amp.measured
        ? `${num(amp.measured.od_total)} OD260 · ${num(amp.measured.nmol)} nmol · ${num(amp.measured.ug)} µg (${amp.measured.tube_count} ống)`
        : "Chưa đo OD";
      const allHaveQc = Boolean(amp.qc && Array.isArray(amp.qc.results) && amp.qc.results.length > 0);
      const allPassed = allHaveQc && amp.qc.results.every((r: any) => r.passed === true);
      const ampConclusion =
        allPassed && allHaveQc
          ? "ĐẠT TIÊU CHUẨN CHẤT LƯỢNG (PASSED)"
          : "BẢN XEM TRƯỚC — CHƯA HOÀN TẤT KIỂM NGHIỆM QC";
      const qcRows = allHaveQc
        ? amp.qc.results
            .map(
              (r: any, rIdx: number) =>
                `<tr>
                  <td>${rIdx + 1}. ${esc(r.name)}</td>
                  <td>${esc(r.method || "SOP-QC-AMP")}</td>
                  <td>${spec(r)} ${esc(r.unit ?? "")}</td>
                  <td>${value(r, r.unit)}</td>
                  <td><b>${r.passed == null ? "—" : r.passed ? "Đạt" : "Không đạt"}</b></td>
                </tr>`
            )
            .join("")
        : `<tr><td colspan="5" style="text-align:center;color:#64748b;">Chưa có dữ liệu kiểm nghiệm QC được phê duyệt</td></tr>`;

      const singleAmpliconHtml = `
        <div class="coa-sheet" style="${needPageBreak ? "page-break-before: always; padding-top: 4pt;" : ""}">
          <h1>PHIẾU PHÂN TÍCH CHẤT LƯỢNG SẢN PHẨM (COA)</h1>
          <div class="sub">
            <b>CHỨNG CHỈ PHÂN TÍCH CHẤT LƯỢNG AMPLICON / CHỨNG DƯƠNG</b><br>
            Số chứng chỉ: <b>COA-${esc(o.code)}-AMP-${idx + 1} (${esc(amp.code)})</b> · Tiêu chuẩn: ISO 13485:2016
          </div>
          ${orderMetaHtml}

          <div style="font-weight:bold;margin:6pt 0 3pt;">I. THÔNG TIN ĐỊNH DANH &amp; ĐẶC TÍNH PHÂN TỬ CỦA AMPLICON:</div>
          <table>
            <tbody>
              <tr>
                <th style="width:22%;">Mã quản lý Amplicon</th>
                <td style="width:28%;"><b>${esc(amp.code)}</b></td>
                <th style="width:22%;">Tên Amplicon / Đích tác nhân</th>
                <td style="width:28%;"><b>${esc(amp.name)}</b> ${amp.target_pathogen ? `(${esc(amp.target_pathogen)})` : ""}</td>
              </tr>
              <tr>
                <th>Phân loại sản phẩm</th>
                <td>${esc(amp.product_type === "AMPLICON_PLASMID" ? "Plasmid DNA Amplicon" : "Linear DNA Amplicon (Chuỗi chuẩn)")}</td>
                <th>Chiều dài trình tự</th>
                <td><b>${esc(amp.base_count)} bp (nt)</b> · Phân tử: ${esc(amp.molecule_type)}</td>
              </tr>
              <tr>
                <th>Khối lượng phân tử (MW)</th>
                <td>${num(amp.mw)} Da (g/mol)</td>
                <th>Nhiệt độ nóng chảy (Tm) &amp; %GC</th>
                <td>Tm: ${num(amp.tm)} °C · GC: ${num(amp.gc_percent)} %</td>
              </tr>
              <tr>
                <th>Hệ số tắt mol (ε260)</th>
                <td>${num(amp.ext_coeff_260)} L/(mol·cm)</td>
                <th>Quy đổi đơn vị chuẩn</th>
                <td>${num(amp.nmol_per_od)} nmol/OD260 · ${num(amp.ug_per_od)} µg/OD260</td>
              </tr>
              <tr>
                <th>Thang &amp; Tinh sạch</th>
                <td>${esc(amp.scale_code)} · Tinh sạch <b>${esc(amp.purification)}</b> · ${amp.format === "LIQUID" ? "Dung dịch" : "Đông khô"}</td>
                <th>Tổng lượng thu được</th>
                <td><b>${yieldStr}</b></td>
              </tr>
              <tr>
                <th>Trình tự chuẩn (5' → 3')</th>
                <td colspan="3" class="seq">${esc(amp.normalized_sequence)}</td>
              </tr>
            </tbody>
          </table>

          <div style="font-weight:bold;margin:8pt 0 3pt;">II. KẾT QUẢ KIỂM NGHIỆM CHẤT LƯỢNG AMPLICON (${esc(amp.code)}):</div>
          <table>
            <thead>
              <tr>
                <th style="width:28%;">Chỉ tiêu kiểm nghiệm</th>
                <th style="width:22%;">Phương pháp thử</th>
                <th style="width:25%;">Yêu cầu kỹ thuật</th>
                <th style="width:15%;">Kết quả</th>
                <th style="width:10%;">Đánh giá</th>
              </tr>
            </thead>
            <tbody>
              ${qcRows}
            </tbody>
          </table>

          <p style="margin-top:6pt;">
            <b>KẾT LUẬN CHO AMPLICON ${esc(amp.code)} (${esc(amp.name)}): ${ampConclusion}.</b>
          </p>
          <div style="font-size:8.5pt;color:#334155;margin-bottom:8pt;">
            Hướng dẫn bảo quản: Bảo quản ở nhiệt độ -20°C tránh ánh sáng trực tiếp. Ly tâm nhẹ (spin-down) ống trước khi mở nắp pha hoàn nguyên bằng đệm TE (pH 8.0) hoặc nước Nuclease-free.
          </div>

          <table class="meta" style="margin-top:10pt;width:100%;">
            <tr>
              <td style="width:50%;text-align:center;">
                <b>CHUYÊN VIÊN KIỂM NGHIỆM QC</b><br>
                <span style="font-size:8.5pt;color:#475569;">(Kiểm tra độ tinh khiết &amp; hoạt tính Amplicon)</span><br><br><br>
                <b>Bộ phận QC Oligo</b>
              </td>
              <td style="width:50%;text-align:center;">
                <b>TRƯỞNG BỘ PHẬN QA/QC PHÊ DUYỆT</b><br>
                <span style="font-size:8.5pt;color:#475569;">${
                  amp.qc?.signature ? sig(amp.qc.signature) : "Chưa có chữ ký phê duyệt QC"
                }</span><br><br><br>
                <b>${amp.qc?.signature ? esc(amp.qc.signature.signer_name) : "Phòng Đảm Bảo Chất Lượng (QA/QC)"}</b>
              </td>
            </tr>
          </table>
        </div>
      `;
      sections.push(singleAmpliconHtml);
    });
  }

  if (sections.length === 0) {
    win?.close();
    window.alert("Đơn hàng chưa có trình tự phù hợp với chế độ xuất COA đã chọn.");
    return;
  }

  renderHtmlToPrintWindow(page(`COA ${o.code}`, c.header, sections.join("\n"), c.footer), win);
}

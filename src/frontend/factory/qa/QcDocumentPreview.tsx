"use client";

import React, { useEffect, useState } from "react";
import {
  getCoaSheetLabels,
  prepareCoaCertificateModel,
  prepareQcTestReportModel,
  printKitCoaCertificate,
  printLoadedQcTestReport,
  type QcSignerOverrides,
} from "../coa";
import {
  normalizeQcFormsConfig,
  type CoaExportLang,
  type QcFormsConfig,
  type ResolvedQcSignature,
} from "../qcSignatures";
import { Button, inputClass } from "../ui";

interface QcDocumentPreviewProps {
  kind: "QC_REPORT" | "COA";
  data: any;
  formsConfig?: Partial<QcFormsConfig> | null;
  defaultLang?: CoaExportLang;
  onPrintReport?: (signerOverrides: QcSignerOverrides) => void;
}

function SignatureBox({
  titleMain,
  titleSub,
  sig,
  verifiedText,
}: {
  titleMain: string;
  titleSub: string | null;
  sig: ResolvedQcSignature;
  verifiedText: string;
}) {
  return (
    <div className="flex-1 text-center">
      <div className="text-[11px] font-extrabold uppercase text-slate-900">{titleMain}</div>
      {titleSub && <div className="text-[10.5px] text-slate-600">{titleSub}</div>}
      <div className="h-16 flex items-center justify-center my-1">
        {sig.signatureUrl ? (
          <img
            src={sig.signatureUrl}
            alt={`Chữ ký ${sig.displayName}`}
            className="max-h-14 max-w-[175px] object-contain"
          />
        ) : (
          <span className="text-[10px] text-slate-400 italic">(Chưa có ảnh chữ ký)</span>
        )}
      </div>
      <div className="text-[11.5px] font-extrabold text-slate-900">{sig.displayName}</div>
      <div className="text-[10px] font-semibold text-emerald-700 mt-0.5">{verifiedText}</div>
    </div>
  );
}

export function QcDocumentPreview({
  kind,
  data,
  formsConfig,
  defaultLang,
  onPrintReport,
}: QcDocumentPreviewProps) {
  const cfg = normalizeQcFormsConfig(null, formsConfig);
  const resolvedDefaultLang: CoaExportLang = defaultLang ?? cfg.coa.default_lang ?? "BI";

  const [lang, setLang] = useState<CoaExportLang>(resolvedDefaultLang);
  const [analystName, setAnalystName] = useState<string>("");
  const [managerName, setManagerName] = useState<string>("");

  useEffect(() => {
    setLang(resolvedDefaultLang);
  }, [resolvedDefaultLang]);

  if (!data) return null;

  const signerOverrides: QcSignerOverrides = {
    ...(analystName ? { analyst_name: analystName } : {}),
    ...(managerName ? { manager_name: managerName } : {}),
  };

  const staffList = cfg.staff_signatures;

  const handlePrint = () => {
    if (kind === "COA") {
      printKitCoaCertificate(data, cfg, lang, signerOverrides);
    } else if (onPrintReport) {
      onPrintReport(signerOverrides);
    } else {
      printLoadedQcTestReport(data, cfg, signerOverrides);
    }
  };

  const renderToolbar = () => (
    <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-900/60">
      <div className="flex flex-wrap items-center gap-2">
        {kind === "COA" && (
          <div className="inline-flex rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 p-0.5 gap-0.5">
            {(
              [
                { id: "BI", label: "Song ngữ (Mẫu chuẩn)" },
                { id: "VI", label: "🇻🇳 Tiếng Việt" },
                { id: "EN", label: "🇬🇧 English" },
              ] as const
            ).map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setLang(item.id)}
                className={`px-2.5 py-1 rounded-md text-xs font-semibold cursor-pointer transition-colors ${
                  lang === item.id
                    ? "bg-teal-700 text-white shadow-xs"
                    : "text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <label className="flex items-center gap-1.5">
            <span className="font-semibold text-slate-600 dark:text-slate-300 whitespace-nowrap">Người kiểm nghiệm:</span>
            <select
              className={`${inputClass} !py-1 !text-xs w-44`}
              value={analystName}
              onChange={(e) => setAnalystName(e.target.value)}
            >
              <option value="">Tự động theo phiếu QC</option>
              {staffList.map((s) => (
                <option key={s.id} value={s.full_name}>
                  {s.emp_code ? `${s.emp_code} — ` : ""}{s.full_name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1.5">
            <span className="font-semibold text-slate-600 dark:text-slate-300 whitespace-nowrap">Trưởng phòng QC/QA:</span>
            <select
              className={`${inputClass} !py-1 !text-xs w-44`}
              value={managerName}
              onChange={(e) => setManagerName(e.target.value)}
            >
              <option value="">Mặc định ({cfg.default_manager_name})</option>
              {staffList.map((s) => (
                <option key={s.id} value={s.full_name}>
                  {s.emp_code ? `${s.emp_code} — ` : ""}{s.full_name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <Button onClick={handlePrint}>
        {kind === "COA"
          ? `🖨️ In / Xuất PDF COA (${lang === "VI" ? "Tiếng Việt" : lang === "EN" ? "English" : "Song ngữ"})`
          : "🖨️ In / Xuất PDF Phiếu Trả KQ QC (A4)"}
      </Button>
    </div>
  );

  if (kind === "QC_REPORT") {
    const m = prepareQcTestReportModel(data, cfg, signerOverrides);
    return (
      <div className="space-y-3">
        {renderToolbar()}
        <div className="bg-white text-slate-900 border border-slate-300 shadow-sm rounded-lg p-6 md:p-8 max-w-[820px] mx-auto text-[11.5px] leading-snug">
          {/* Header */}
          <div className="flex justify-between items-start gap-4 border-b-2 border-blue-800 pb-3 mb-4">
            <div className="flex-1">
              <div className="text-[13.5px] font-extrabold text-blue-900">{cfg.company_name_vi}</div>
              <div className="text-[11px] font-bold text-slate-600 mt-0.5">{cfg.company_name_en}</div>
              <div className="text-[10.5px] text-slate-600 mt-1">{cfg.address_vi}</div>
              <div className="text-[10.5px] text-slate-600">Điện thoại: {cfg.phone} | Email: {cfg.email}</div>
            </div>
            <div className="text-right text-[11px] text-slate-700 whitespace-nowrap space-y-0.5">
              <div>Mã số phiếu KQ: <b className="text-slate-900">{m.reportCode}</b></div>
              <div>Mã phiếu QC: <b className="text-slate-900">{m.qcTestCode}</b></div>
              <div>Biểu mẫu: {m.formCode}</div>
              <div>Ngày ban hành: {m.issueDate}</div>
            </div>
          </div>

          {/* Title */}
          <div className="text-center mb-4">
            <div className="text-xl font-extrabold text-blue-900 tracking-wide">{cfg.qc_report.title_en}</div>
            <div className="text-sm font-bold text-slate-700 mt-0.5">{cfg.qc_report.title_vi}</div>
            <div className="text-[10.5px] font-semibold text-emerald-700 mt-1">{cfg.iso_badge_vi}</div>
          </div>

          {/* Section I */}
          <div className="text-xs font-extrabold text-blue-900 uppercase mb-1.5">
            I. THÔNG TIN TRUY XUẤT LÔ HÀNG (PRODUCT &amp; BATCH TRACEABILITY)
          </div>
          <table className="w-full border-collapse border border-slate-300 mb-3 text-[11px]">
            <tbody>
              <tr>
                <td className="border border-slate-300 bg-slate-50 px-2 py-1.5 font-semibold w-[22%]">Tên sản phẩm / Product Name:</td>
                <td className="border border-slate-300 px-2 py-1.5 font-bold w-[28%]">{m.productName}</td>
                <td className="border border-slate-300 bg-slate-50 px-2 py-1.5 font-semibold w-[22%]">Số lô / Batch (Lot) No.:</td>
                <td className="border border-slate-300 px-2 py-1.5 font-bold text-blue-800 w-[28%]">{m.lotCode}</td>
              </tr>
              <tr>
                <td className="border border-slate-300 bg-slate-50 px-2 py-1.5 font-semibold">Mã sản phẩm / Catalog No.:</td>
                <td className="border border-slate-300 px-2 py-1.5">{m.catalogNo}</td>
                <td className="border border-slate-300 bg-slate-50 px-2 py-1.5 font-semibold">Lệnh sản xuất / Order No.:</td>
                <td className="border border-slate-300 px-2 py-1.5">{m.orderNo}</td>
              </tr>
              <tr>
                <td className="border border-slate-300 bg-slate-50 px-2 py-1.5 font-semibold">Ngày sản xuất / Mfg. Date:</td>
                <td className="border border-slate-300 px-2 py-1.5">{m.mfgDate}</td>
                <td className="border border-slate-300 bg-slate-50 px-2 py-1.5 font-semibold">Hạn sử dụng / Expiry Date:</td>
                <td className="border border-slate-300 px-2 py-1.5">
                  <b>{m.expiryDate}</b>{m.shelfLifeMonths ? ` (${m.shelfLifeMonths} tháng)` : ""}
                </td>
              </tr>
              <tr>
                <td className="border border-slate-300 bg-slate-50 px-2 py-1.5 font-semibold">Số lượng lô / Batch Size:</td>
                <td className="border border-slate-300 px-2 py-1.5">{m.batchSize}</td>
                <td className="border border-slate-300 bg-slate-50 px-2 py-1.5 font-semibold">Điều kiện bảo quản / Storage:</td>
                <td className="border border-slate-300 px-2 py-1.5">{m.storageCondition}</td>
              </tr>
              <tr>
                <td className="border border-slate-300 bg-slate-50 px-2 py-1.5 font-semibold">Quy cách / Presentation:</td>
                <td className="border border-slate-300 px-2 py-1.5">{m.presentation}</td>
                <td className="border border-slate-300 bg-slate-50 px-2 py-1.5 font-semibold">Tiêu chuẩn / Standard:</td>
                <td className="border border-slate-300 px-2 py-1.5">{m.standardCode}</td>
              </tr>
            </tbody>
          </table>

          {m.oligoRef && (
            <table className="w-full border-collapse border border-slate-300 mb-3 text-[11px]">
              <tbody>
                <tr>
                  <td className="border border-slate-300 bg-slate-50 px-2 py-1 font-semibold w-[22%]">Trình tự 5&apos;→3&apos;:</td>
                  <td colSpan={3} className="border border-slate-300 px-2 py-1 font-mono break-all">
                    {m.oligoRef.normalized_sequence}
                  </td>
                </tr>
                <tr>
                  <td className="border border-slate-300 bg-slate-50 px-2 py-1 font-semibold">Số base / MW:</td>
                  <td className="border border-slate-300 px-2 py-1">{m.oligoRef.base_count} nt · {m.oligoRef.mw} Da</td>
                  <td className="border border-slate-300 bg-slate-50 px-2 py-1 font-semibold">Thang / Tinh sạch:</td>
                  <td className="border border-slate-300 px-2 py-1">{m.oligoRef.scale_code} · {m.oligoRef.purification}</td>
                </tr>
              </tbody>
            </table>
          )}

          {/* Section II */}
          <div className="text-xs font-extrabold text-blue-900 uppercase mb-1.5">
            II. CHỈ TIÊU KIỂM NGHIỆM VÀ KẾT QUẢ THỬ NGHIỆM (ANALYSIS &amp; TEST RESULTS)
          </div>
          <table className="w-full border-collapse border border-slate-300 mb-3 text-[11px]">
            <thead>
              <tr className="bg-indigo-50 text-blue-900 font-bold text-center">
                <th className="border border-slate-300 px-2 py-1.5 w-[6%]">STT<br />No.</th>
                <th className="border border-slate-300 px-2 py-1.5 w-[20%]">Chỉ tiêu kiểm tra<br />Test Parameter</th>
                <th className="border border-slate-300 px-2 py-1.5 w-[27%]">Phương pháp &amp; Thiết bị<br />Method &amp; Equipment</th>
                <th className="border border-slate-300 px-2 py-1.5 w-[22%]">Yêu cầu kỹ thuật<br />Specifications</th>
                <th className="border border-slate-300 px-2 py-1.5 w-[13%]">Kết quả thực tế<br />Actual Result</th>
                <th className="border border-slate-300 px-2 py-1.5 w-[12%]">Kết luận<br />Result</th>
              </tr>
            </thead>
            <tbody>
              {m.rows.length > 0 ? (
                m.rows.map((r) => (
                  <tr key={r.seq}>
                    <td className="border border-slate-300 px-2 py-1.5 text-center">{r.seq}</td>
                    <td className="border border-slate-300 px-2 py-1.5 font-bold">{r.name}</td>
                    <td className="border border-slate-300 px-2 py-1.5">
                      <div><b>Phương pháp:</b> {r.method}</div>
                      {r.equipment && (
                        <div className="text-blue-700 mt-0.5"><b>Thiết bị:</b> {r.equipment}</div>
                      )}
                    </td>
                    <td className="border border-slate-300 px-2 py-1.5">{r.spec}</td>
                    <td className="border border-slate-300 px-2 py-1.5 text-center font-bold">{r.actual}</td>
                    <td className={`border border-slate-300 px-2 py-1.5 text-center font-extrabold whitespace-nowrap ${r.passed === false ? "text-red-700" : "text-emerald-700"}`}>
                      {r.passed === false ? "KHÔNG ĐẠT (FAIL)" : r.passed === true ? "ĐẠT (PASS)" : "—"}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className="border border-slate-300 px-2 py-3 text-center text-slate-500">
                    Chưa có chỉ tiêu kiểm nghiệm trên phiếu QC
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          {/* Section III */}
          <div className="text-xs font-extrabold text-blue-900 uppercase mb-1.5">
            III. KẾT LUẬN VÀ PHÊ DUYỆT (CONCLUSION &amp; APPROVAL)
          </div>
          <div
            className={`p-2.5 rounded border text-[11.5px] mb-4 ${
              m.overallPassed
                ? "bg-emerald-50 border-emerald-300 text-emerald-900"
                : "bg-red-50 border-red-300 text-red-900"
            }`}
          >
            <b>{m.conclusionPrefix}</b> {m.conclusionBody}
          </div>

          {/* Signatures */}
          <div className="flex justify-between gap-6 pt-2">
            <SignatureBox
              titleMain={cfg.analyst_label_vi}
              titleSub={cfg.analyst_label_en}
              sig={m.analyst}
              verifiedText={cfg.analyst_verified_vi}
            />
            <SignatureBox
              titleMain={cfg.manager_label_vi}
              titleSub={cfg.manager_label_en}
              sig={m.manager}
              verifiedText={cfg.manager_verified_vi}
            />
          </div>
          {cfg.footer_note && (
            <div className="mt-4 pt-2 border-t border-slate-200 text-center text-[10px] text-slate-500">
              {cfg.footer_note}
            </div>
          )}
        </div>
      </div>
    );
  }

  // kind === "COA"
  const m = prepareCoaCertificateModel(data, cfg, lang, signerOverrides);
  const lbl = getCoaSheetLabels(m.lang);
  const stripBr = (s: string) => s.split("<br>");

  return (
    <div className="space-y-3">
      {renderToolbar()}
      <div className="bg-white text-slate-900 border border-slate-300 shadow-sm rounded-lg p-6 md:p-8 max-w-[820px] mx-auto text-[11.5px] leading-snug">
        {m.isSuperseded && (
          <div className="border-2 border-red-600 bg-red-50 text-red-700 p-2 mb-3 text-center font-bold text-xs">
            ⚠️ {lang === "EN" ? "SUPERSEDED VERSION — REFERENCE ONLY" : "BẢN ĐÃ THAY THẾ / SUPERSEDED — CHỈ DÙNG TRA CỨU LỊCH SỬ"}
          </div>
        )}

        {/* Header */}
        <div className="flex justify-between items-start gap-4 border-b-2 border-blue-800 pb-3 mb-4">
          <div className="flex-1">
            <div className="text-[13.5px] font-extrabold text-blue-900">{m.companyNamePrimary}</div>
            {m.companyNameSecondary && (
              <div className="text-[11px] font-bold text-slate-600 mt-0.5">{m.companyNameSecondary}</div>
            )}
            <div className="text-[10.5px] text-slate-600 mt-1">{m.addressText}</div>
            <div className="text-[10.5px] text-slate-600">{m.contactText}</div>
          </div>
          <div className="text-right text-[11px] text-slate-700 whitespace-nowrap space-y-0.5">
            <div>{lbl.coaNo} <b className="text-slate-900">{m.coaCode}</b></div>
            <div>{lbl.qcRef} <b className="text-slate-900">{m.qcTestCode}</b></div>
            <div>{lbl.formCode} {m.formCode}</div>
            <div>{lbl.issueDate} {m.issueDate}</div>
          </div>
        </div>

        {/* Title */}
        <div className="text-center mb-4">
          <div className="text-xl font-extrabold text-blue-900 tracking-wide">{m.titleMain}</div>
          {m.titleSub && <div className="text-sm font-bold text-slate-700 mt-0.5">{m.titleSub}</div>}
          <div className="text-[10.5px] font-semibold text-emerald-700 mt-1">{m.isoBadge}</div>
        </div>

        {/* Section I */}
        <div className="text-xs font-extrabold text-blue-900 uppercase mb-1.5">{m.section1Title}</div>
        <table className="w-full border-collapse border border-slate-300 mb-3 text-[11px]">
          <tbody>
            <tr>
              <td className="border border-slate-300 bg-slate-50 px-2 py-1.5 font-semibold w-[22%]">{lbl.product}</td>
              <td className="border border-slate-300 px-2 py-1.5 font-bold w-[28%]">{m.productName}</td>
              <td className="border border-slate-300 bg-slate-50 px-2 py-1.5 font-semibold w-[22%]">{lbl.lot}</td>
              <td className="border border-slate-300 px-2 py-1.5 font-bold text-blue-800 w-[28%]">{m.lotCode}</td>
            </tr>
            <tr>
              <td className="border border-slate-300 bg-slate-50 px-2 py-1.5 font-semibold">{lbl.catalog}</td>
              <td className="border border-slate-300 px-2 py-1.5">{m.catalogNo}</td>
              <td className="border border-slate-300 bg-slate-50 px-2 py-1.5 font-semibold">{lbl.order}</td>
              <td className="border border-slate-300 px-2 py-1.5">{m.orderNo}</td>
            </tr>
            <tr>
              <td className="border border-slate-300 bg-slate-50 px-2 py-1.5 font-semibold">{lbl.mfg}</td>
              <td className="border border-slate-300 px-2 py-1.5">{m.mfgDate}</td>
              <td className="border border-slate-300 bg-slate-50 px-2 py-1.5 font-semibold">{lbl.exp}</td>
              <td className="border border-slate-300 px-2 py-1.5">
                <b>{m.expiryDate}</b>{m.shelfLifeText ? ` ${m.shelfLifeText}` : ""}
              </td>
            </tr>
            <tr>
              <td className="border border-slate-300 bg-slate-50 px-2 py-1.5 font-semibold">{lbl.size}</td>
              <td className="border border-slate-300 px-2 py-1.5">{m.batchSize}</td>
              <td className="border border-slate-300 bg-slate-50 px-2 py-1.5 font-semibold">{lbl.storage}</td>
              <td className="border border-slate-300 px-2 py-1.5">{m.storageCondition}</td>
            </tr>
            <tr>
              <td className="border border-slate-300 bg-slate-50 px-2 py-1.5 font-semibold">{lbl.pres}</td>
              <td className="border border-slate-300 px-2 py-1.5">{m.presentation}</td>
              <td className="border border-slate-300 bg-slate-50 px-2 py-1.5 font-semibold">{lbl.std}</td>
              <td className="border border-slate-300 px-2 py-1.5">{m.standardCode}</td>
            </tr>
          </tbody>
        </table>

        {/* Section II */}
        <div className="text-xs font-extrabold text-blue-900 uppercase mb-1.5">{m.section2Title}</div>
        <table className="w-full border-collapse border border-slate-300 mb-3 text-[11px]">
          <thead>
            <tr className="bg-indigo-50 text-blue-900 font-bold text-center">
              <th className="border border-slate-300 px-2 py-1.5 w-[7%]">
                {stripBr(lbl.colSeq).map((line, i) => <React.Fragment key={i}>{i > 0 && <br />}{line}</React.Fragment>)}
              </th>
              <th className="border border-slate-300 px-2 py-1.5 w-[23%]">
                {stripBr(lbl.colParam).map((line, i) => <React.Fragment key={i}>{i > 0 && <br />}{line}</React.Fragment>)}
              </th>
              <th className="border border-slate-300 px-2 py-1.5 w-[20%]">
                {stripBr(lbl.colMethod).map((line, i) => <React.Fragment key={i}>{i > 0 && <br />}{line}</React.Fragment>)}
              </th>
              <th className={`border border-slate-300 px-2 py-1.5 ${m.includeActualColumn ? "w-[22%]" : "w-[35%]"}`}>
                {stripBr(lbl.colSpec).map((line, i) => <React.Fragment key={i}>{i > 0 && <br />}{line}</React.Fragment>)}
              </th>
              {m.includeActualColumn && (
                <th className="border border-slate-300 px-2 py-1.5 w-[14%]">
                  {stripBr(lbl.colObs).map((line, i) => <React.Fragment key={i}>{i > 0 && <br />}{line}</React.Fragment>)}
                </th>
              )}
              <th className="border border-slate-300 px-2 py-1.5 w-[14%]">
                {stripBr(lbl.colRes).map((line, i) => <React.Fragment key={i}>{i > 0 && <br />}{line}</React.Fragment>)}
              </th>
            </tr>
          </thead>
          <tbody>
            {m.rows.map((r) => (
              <tr key={r.seq}>
                <td className="border border-slate-300 px-2 py-1.5 text-center">{r.seq}</td>
                <td className="border border-slate-300 px-2 py-1.5 font-bold">{r.parameter}</td>
                <td className="border border-slate-300 px-2 py-1.5">{r.method}</td>
                <td className="border border-slate-300 px-2 py-1.5">{r.spec}</td>
                {m.includeActualColumn && (
                  <td className="border border-slate-300 px-2 py-1.5 text-center font-bold">{r.observed}</td>
                )}
                <td className={`border border-slate-300 px-2 py-1.5 text-center font-extrabold whitespace-nowrap ${r.passed ? "text-emerald-700" : "text-red-700"}`}>
                  {r.resultText}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {m.customNotes && (
          <div className="text-[11px] text-slate-700 mb-3">
            <b>{lang === "EN" ? "Remarks:" : "Ghi chú:"}</b> {m.customNotes}
          </div>
        )}

        {/* Section III */}
        <div className="text-xs font-extrabold text-blue-900 uppercase mb-1.5">{m.section3Title}</div>
        <div
          className={`p-2.5 rounded border text-[11.5px] mb-4 ${
            m.overallPassed
              ? "bg-emerald-50 border-emerald-300 text-emerald-900"
              : "bg-red-50 border-red-300 text-red-900"
          }`}
        >
          <b>{m.conclusionPrefix}</b> {m.conclusionBody}
        </div>

        {/* Signatures */}
        <div className="flex justify-between gap-6 pt-2">
          <SignatureBox
            titleMain={m.analystTitleMain}
            titleSub={m.analystTitleSub}
            sig={m.analyst}
            verifiedText={m.analystVerifiedText}
          />
          <SignatureBox
            titleMain={m.managerTitleMain}
            titleSub={m.managerTitleSub}
            sig={m.manager}
            verifiedText={m.managerVerifiedText}
          />
        </div>

        {m.config.footer_note && (
          <div className="mt-4 pt-2 border-t border-slate-200 text-center text-[10px] text-slate-500">
            {m.config.footer_note}
          </div>
        )}
      </div>
    </div>
  );
}

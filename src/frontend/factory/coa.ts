"use client";

import { api } from "./api";
import { barcode128SvgMarkup } from "./barcodeSvg";

const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const d = (v: string | null | undefined) => (v ? v.slice(0, 10).split("-").reverse().join("/") : "");
const num = (v: number | null | undefined) => (v == null ? "" : v.toLocaleString("vi-VN", { maximumFractionDigits: 3 }));
const lines = (s: string | null) => (s ? s.split(/\r?\n/).map(esc).join("<br>") : "");

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
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>${esc(title)}</title><style>
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

export function renderHtmlToPrintWindow(html: string, existingWin?: Window | null) {
  const w = existingWin ?? window.open("", "_blank", "width=1020,height=860");
  if (w) {
    w.document.open();
    w.document.write(html);
    w.document.close();
    setTimeout(() => {
      try {
        w.focus();
        w.print();
      } catch {
        // user can also click the Print button inside the window
      }
    }, 250);
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
  setTimeout(() => {
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
  }, 250);
  setTimeout(() => {
    frame.remove();
    style.remove();
  }, 60_000);
}

/** Print an arbitrary DOM container (e.g., rendered Label Artwork / VisualLabelCanvas) in an isolated print window. */
export function printElementHtml(el: HTMLElement | null, title = "Bản in Tem Nhãn Sản Phẩm") {
  if (!el) return;
  const win = openPrintWindowSync(title);
  const clone = el.cloneNode(true) as HTMLElement;
  // Clean up interactive selection outlines & dark background grids for crisp label printing
  clone.querySelectorAll<HTMLElement>("*").forEach((node) => {
    if (node.style?.outline && node.style.outline.includes("dashed")) {
      node.style.outline = "none";
    }
    if (node.style?.backgroundImage && node.style.backgroundImage.includes("linear-gradient(to right")) {
      node.style.backgroundImage = "none";
    }
  });
  const html = `<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>${esc(title)}</title><style>
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

/** COA of one reviewed QC test (lot or sequence), printed from the reviewed results. */
export async function printTestCoa(testId: string) {
  const win = openPrintWindowSync("Đang tải Phiếu kết quả & COA...");
  try {
    const c = await api<any>(`/api/factory/qms/tests/${testId}/coa`);
    const t = c.test;
    const subject = c.lot
      ? `<tr><td>Sản phẩm</td><td>${esc(c.lot.item_code)} — ${esc(c.lot.item_name)}</td><td>Số lô</td><td>${esc(c.lot.code)}${c.lot.mfr_lot_no ? ` (NSX ${esc(c.lot.mfr_lot_no)})` : ""}</td></tr>
         <tr><td>Ngày sản xuất</td><td>${d(c.lot.mfg_date)}</td><td>Hạn dùng</td><td>${d(c.lot.expiry_date)}</td></tr>`
      : `<tr><td>Đối tượng</td><td colspan="3">${esc(t.subject?.label ?? "")}</td></tr>`;
    const ref = t.subject?.reference;
    const oligo = ref
      ? `<tr><td>Trình tự 5'→3'</td><td colspan="3" class="seq">${esc(ref.normalized_sequence)}</td></tr>
         <tr><td>Số base / MW lý thuyết</td><td>${esc(ref.base_count)} nt · ${num(ref.mw)} Da</td><td>Thang / tinh sạch</td><td>${esc(ref.scale_code)} · ${esc(ref.purification)}</td></tr>
         <tr><td>Lượng thu được</td><td colspan="3">${num(ref.od_total)} OD · ${num(ref.nmol)} nmol · ${num(ref.ug)} µg${ref.tube_count ? ` · ${ref.tube_count} ống` : ""}</td></tr>`
      : "";
    const rows = t.parameters
      .map((p: any) => {
        const r = t.results.find((x: any) => x.parameter_id === p.id);
        return `<tr><td>${esc(p.name)}</td><td>${esc(p.method ?? "")}</td><td>${spec(p)} ${esc(p.unit ?? "")}</td><td>${r ? value(r, p.unit) : ""}</td><td>${r?.passed == null ? "" : r.passed ? "Đạt" : "Không đạt"}</td></tr>`;
      })
      .join("");
    const body = `<h1>PHIẾU KẾT QUẢ PHÂN TÍCH (COA)</h1><div class="sub">Số phiếu ${esc(t.code)} · Tiêu chuẩn ${esc(t.spec_code)} rev ${esc(t.spec_version)}</div>
      <table class="meta">${subject}${oligo}</table>
      <table><tr><th>Chỉ tiêu</th><th>Phương pháp</th><th>Yêu cầu</th><th>Kết quả</th><th>Đánh giá</th></tr>${rows}</table>
      <p><b>Kết luận: ${t.overall_result === "PASS" ? "ĐẠT" : "KHÔNG ĐẠT"}</b></p>
      <div class="sign">Kiểm nghiệm: ${esc(t.analyst_name ?? "")}<br>Duyệt kết quả: ${sig(c.signature) || esc(t.reviewer_name ?? "")}</div>`;
    renderHtmlToPrintWindow(page(`COA ${t.code}`, c.header, body, c.footer), win);
  } catch (err) {
    win?.close();
    throw err;
  }
}

/**
 * In Giấy Chứng Nhận Phân Tích Song Ngữ (Bilingual COA — `kit.coa_certificate`)
 * trong cửa sổ in độc lập chuẩn A4 (không bao giờ in dính giao diện trang web).
 */
export function printKitCoaCertificate(coa: any, template?: any) {
  if (!coa) return;
  const packList: any[] = Array.isArray(coa.packaging_snapshot) ? coa.packaging_snapshot : [];
  const qcList: any[] = Array.isArray(coa.qc_results_snapshot) ? coa.qc_results_snapshot : [];

  const packHtml =
    packList.length > 0
      ? `<div style="font-weight:bold;margin:8pt 0 3pt;">1. QUY CÁCH ĐÓNG GÓI THÀNH PHẦN / KIT COMPONENTS &amp; PACKAGING:</div>
         <table>
           <thead>
             <tr>
               <th>Hộp / Box</th>
               <th>Thành phần / Component</th>
               <th>Quy cách ống / Volume</th>
               <th>Số lượng / Qty</th>
               <th>Bảo quản / Storage</th>
             </tr>
           </thead>
           <tbody>
             ${packList
               .map(
                 (pk: any) => `<tr>
                   <td>Hộp ${esc(pk.box_no)}: ${esc(pk.box_name)}</td>
                   <td><b>${esc(pk.component_name)}</b></td>
                   <td>${esc(pk.fill_qty)} ${esc(pk.fill_uom)}</td>
                   <td>${esc(pk.units_per_kit)} ống/Kit</td>
                   <td>${esc(pk.storage_temp)}</td>
                 </tr>`
               )
               .join("")}
           </tbody>
         </table>`
      : "";

  const qcRowsHtml = qcList
    .map((st: any, idx: number) => {
      const obs =
        st.observed_value ??
        (st.param_values && Object.keys(st.param_values).length > 0
          ? Object.entries(st.param_values)
              .map(([k, v]) => `${k}: ${v}`)
              .join(" · ")
          : "—");
      const evalStatus =
        st.passed === true
          ? "ĐẠT / PASS"
          : st.passed === false
            ? "KHÔNG ĐẠT / FAIL"
            : "CHƯA ĐÁNH GIÁ";
      const evalColor = st.passed === true ? "#047857" : st.passed === false ? "#b91c1c" : "#64748b";
      return `<tr>
        <td style="text-align:center;">${esc(st.seq ?? idx + 1)}</td>
        <td><b>${esc(st.parameter_name ?? `${st.step_code ?? ""} ${st.step_name ?? ""}`)}</b></td>
        <td>${esc(st.method ?? "SOP-QC")}</td>
        <td>${esc(st.spec_limit ?? "Đạt chuẩn / Conforms")}</td>
        <td><b>${esc(obs)}</b></td>
        <td style="font-weight:bold;color:${evalColor};">${evalStatus}</td>
      </tr>`;
    })
    .join("");

  const hasValidQcSnapshot = qcList.length > 0;
  const allSnapshotPassed = hasValidQcSnapshot && qcList.every((st: any) => st.passed === true);
  const finalDispositionText = hasValidQcSnapshot
    ? coa.qc_summary || (allSnapshotPassed ? "ĐẠT TIÊU CHUẨN XUẤT XƯỞNG / PASSED" : "KHÔNG ĐẠT / FAILED")
    : "CHƯA CÓ DỮ LIỆU KIỂM NGHIỆM QC / PENDING QC RESULTS";

  const companyName =
    template?.company_name || "CÔNG TY TNHH GIẢI PHÁP Y SINH ABT — ABT BIOLOGICAL SOLUTIONS CO., LTD";
  const addressLine =
    template?.address_line || "Khối Đảm Bảo & Kiểm Soát Chất Lượng (QA/QC) · Hệ thống Quản lý Chất lượng ISO 13485:2016";
  const docTitle =
    template?.document_title || "GIẤY CHỨNG NHẬN PHÂN TÍCH / CERTIFICATE OF ANALYSIS (COA)";
  const isoSubtitle =
    template?.iso_subtitle || "Do Phòng QA/QC Cấp Phát (ISO 13485:2016)";
  const footerText =
    template?.footer_statement ||
    "Chứng nhận phân tích điện tử được cấp bởi Phòng QA/QC và ánh xạ tự động sang Sản xuất & Kinh doanh (Tuân thủ 21 CFR Part 11 & ISO 13485:2016).";
  const approverTitle =
    template?.approver_title || "PHÒNG QA/QC PHÊ DUYỆT & CẤP COA / APPROVED BY QA/QC";

  const headerText = [companyName, addressLine].filter(Boolean).join("\n");
  const specQtyText =
    Number(coa.tests_per_kit) > 0
      ? `${esc(coa.tests_per_kit)} tests (${esc(coa.good_qty)} ${esc(coa.uom)})`
      : `${esc(coa.good_qty)} ${esc(coa.uom)}`;

  const supersededBanner = coa.is_superseded
    ? `<div style="border:2px solid #dc2626;background:#fef2f2;color:#b91c1c;padding:6pt 10pt;margin-bottom:8pt;text-align:center;font-weight:bold;letter-spacing:0.5px;">⚠️ BẢN ĐÃ THAY THẾ / SUPERSEDED — CHỈ DÙNG TRA CỨU LỊCH SỬ</div>`
    : "";
  const hashNote = coa.sha256_hash
    ? ` · SHA-256: <code style="font-size:8pt">${esc(String(coa.sha256_hash).slice(0, 16))}…</code>`
    : "";

  const body = `
    ${supersededBanner}
    <h1>${esc(docTitle)}</h1>
    <div class="sub">
      Số chứng nhận / Certificate No.: <b>${esc(coa.code)}</b>
      ${coa.revision_no ? ` · Phiên bản / Rev: <b>v${esc(coa.revision_no)}</b>` : ""}
      ${coa.qc_test_code ? ` · Phiếu QC gốc / QC Test Ref: <b>${esc(coa.qc_test_code)}</b>` : ""}
      ${isoSubtitle ? ` · ${esc(isoSubtitle)}` : ""}${hashNote}
    </div>
    <div style="display:flex;justify-content:center;gap:18pt;align-items:center;margin:4pt 0 8pt;">
      <div style="text-align:center;">${barcode128SvgMarkup(String(coa.code ?? ""), 30)}<div style="font-size:7.5pt;font-family:monospace;">${esc(coa.code)}</div></div>
      ${coa.lot_code ? `<div style="text-align:center;">${barcode128SvgMarkup(String(coa.lot_code), 28)}<div style="font-size:7.5pt;font-family:monospace;">LOT ${esc(coa.lot_code)}</div></div>` : ""}
    </div>
    <table class="meta" style="border:0.5pt solid #64748b;background:#f8fafc;margin-bottom:8pt;">
      <tr>
        <td style="width:22%;font-weight:bold;">Tên sản phẩm / Product:</td>
        <td style="width:28%;"><b>${esc(coa.product_name)}</b></td>
        <td style="width:22%;font-weight:bold;">Mã sản phẩm / Catalog (REF):</td>
        <td style="width:28%;"><b>${esc(coa.product_code)}</b></td>
      </tr>
      <tr>
        <td style="font-weight:bold;">Số lô / Lot Number (LOT):</td>
        <td><b style="color:#0369a1;">${esc(coa.lot_code)}</b></td>
        <td style="font-weight:bold;">Quy cách / Specification:</td>
        <td>${specQtyText}${coa.spec_code ? ` · ${esc(coa.spec_code)}` : ""}${coa.actual_ph ? ` · pH: ${esc(coa.actual_ph)}` : ""}</td>
      </tr>
      <tr>
        <td style="font-weight:bold;">Ngày sản xuất / MFG Date:</td>
        <td>${d(coa.mfg_date)}</td>
        <td style="font-weight:bold;">Hạn sử dụng / EXP Date:</td>
        <td><b>${d(coa.expiry_date)}</b></td>
      </tr>
    </table>
    ${packHtml}
    <div style="font-weight:bold;margin:8pt 0 3pt;">${packList.length > 0 ? "2." : "1."} KẾT QUẢ KIỂM NGHIỆM CHẤT LƯỢNG (DO PHÒNG QA/QC THỰC HIỆN) / QC ANALYTICAL RESULTS:</div>
    <table>
      <thead>
        <tr>
          <th style="width:5%;text-align:center;">#</th>
          <th style="width:27%;">Chỉ tiêu kiểm nghiệm / Parameter</th>
          <th style="width:18%;">Phương pháp / Method</th>
          <th style="width:20%;">Mức yêu cầu / Specification</th>
          <th style="width:18%;">Kết quả / Result</th>
          <th style="width:12%;">Đánh giá</th>
        </tr>
      </thead>
      <tbody>
        ${qcRowsHtml || '<tr><td colspan="6" style="text-align:center;color:#64748b;">Chưa có dữ liệu kiểm nghiệm QC được phê duyệt</td></tr>'}
      </tbody>
    </table>
    <p style="margin-top:8pt;"><b>Kết luận xuất xưởng / Final Disposition: ${esc(finalDispositionText)}</b></p>
    ${coa.custom_notes ? `<p style="margin-top:4pt;font-size:9pt;"><b>Ghi chú / Remarks:</b> ${esc(coa.custom_notes)}</p>` : ""}
    <table class="meta" style="margin-top:14pt;width:100%;">
      <tr>
        <td style="width:50%;text-align:center;">
          <b>CHUYÊN VIÊN KIỂM NGHIỆM / QC ANALYST</b><br><br><br>
          <b>${esc(coa.analyst_name || "Phòng Kiểm Nghiệm QC")}</b>
        </td>
        <td style="width:50%;text-align:center;">
          <b>${esc(approverTitle)}</b><br><br><br>
          <b>${esc(coa.issued_by_name || "Trưởng Phòng QA/QC")}</b>
        </td>
      </tr>
    </table>
  `;

  renderHtmlToPrintWindow(page(`COA ${coa.code} - Lô ${coa.lot_code}`, headerText, body, footerText));
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

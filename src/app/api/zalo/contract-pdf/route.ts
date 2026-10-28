import { NextRequest, NextResponse } from "next/server";
import { query } from "@/backend/db/db";
import { canAccessDocument, documentAccessDeniedResponse } from "@/backend/services/documentLinks";
import { escapeDeep, escapeHtml } from "@/backend/services/html";

function numberToVietnameseWords(num: number): string {
  if (!num || isNaN(num) || num <= 0) return "Không đồng";
  const units = ["", "một", "hai", "ba", "bốn", "năm", "sáu", "bảy", "tám", "chín"];
  const tens = ["", "mười", "hai mươi", "ba mươi", "bốn mươi", "năm mươi", "sáu mươi", "bảy mươi", "tám mươi", "chín mươi"];
  
  function readTriple(n: number, readFull: boolean): string {
    const h = Math.floor(n / 100);
    const t = Math.floor((n % 100) / 10);
    const u = n % 10;
    if (h === 0 && t === 0 && u === 0) return "";
    let res = "";
    if (h > 0 || readFull) {
      res += `${units[h]} trăm `;
    }
    if (t > 1) {
      res += `${tens[t]} `;
      if (u === 1) res += "mốt ";
      else if (u === 5) res += "lăm ";
      else if (u > 0) res += `${units[u]} `;
    } else if (t === 1) {
      res += "mười ";
      if (u === 5) res += "lăm ";
      else if (u > 0) res += `${units[u]} `;
    } else if (h > 0 && u > 0) {
      res += `lẻ ${units[u]} `;
    } else if (u > 0) {
      res += `${units[u]} `;
    }
    return res.trim();
  }

  const scales = ["", "nghìn", "triệu", "tỷ", "nghìn tỷ", "triệu tỷ"];
  let n = Math.floor(num);
  const parts: string[] = [];
  let scaleIdx = 0;

  while (n > 0) {
    const triple = n % 1000;
    if (triple > 0) {
      const s = readTriple(triple, n >= 1000);
      if (s) {
        parts.unshift(`${s} ${scales[scaleIdx]}`.trim());
      }
    }
    n = Math.floor(n / 1000);
    scaleIdx++;
  }

  const str = parts.join(" ").replace(/\s+/g, " ").trim();
  return (str.charAt(0).toUpperCase() + str.slice(1) + " đồng chẵn").replace("đồng chẵn đồng chẵn", "đồng chẵn");
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const code = searchParams.get("code") || searchParams.get("contract_code") || "";
    if (!(await canAccessDocument(req, "contract", code))) return documentAccessDeniedResponse();

    if (!code) {
      return new NextResponse("<h1 style='font-family: Arial; text-align: center; margin-top: 50px;'>Thiếu mã hợp đồng cần hiển thị</h1>", {
        status: 400,
        headers: { "Content-Type": "text/html; charset=utf-8" }
      });
    }

    // 1. Search contract by contract_code or ID
    const cRes = await query(
      "SELECT * FROM sales_contracts WHERE contract_code = $1 OR CAST(id AS TEXT) = $1 LIMIT 1",
      [code]
    );

    if (cRes.rows.length === 0) {
      return new NextResponse(`<h1 style='font-family: Arial; text-align: center; margin-top: 50px; color: #dc2626;'>Không tìm thấy hợp đồng: ${escapeHtml(code)}</h1>`, {
        status: 404,
        headers: { "Content-Type": "text/html; charset=utf-8" }
      });
    }

    // Mọi chuỗi từ CSDL được mã hóa HTML trước khi chèn vào trang (chống chèn mã độc)
    const rawC = cRes.rows[0];
    let items = typeof rawC.items === "string" ? JSON.parse(rawC.items || "[]") : (rawC.items || []);
    if (!Array.isArray(items)) items = [];
    items = escapeDeep(items);

    // Parse metadata from notes
    let meta: any = {};
    if (typeof rawC.notes === "string" && (rawC.notes.startsWith("{") || rawC.notes.startsWith("["))) {
      try {
        meta = escapeDeep(JSON.parse(rawC.notes));
      } catch (e) {}
    }
    const c = escapeDeep(rawC);

    // Company configuration (Party A)
    let companyName = "";
    let companyAddress = "";
    let companyPhone = "";
    let companyEmail = "";
    let companyTaxCode = "";
    let companyRep = "";
    let companyRepRole = "Tổng Giám Đốc";
    let companyBank = "";
    let companyAccountNo = "";

    try {
      const configRes = await query("SELECT data FROM app_storage WHERE key = $1", ["sales_company_config"]);
      if (configRes.rows.length > 0) {
        const raw = configRes.rows[0].data;
        const cfg = escapeDeep(typeof raw === "string" ? JSON.parse(raw) : raw);
        if (cfg) {
          if (cfg.companyName) companyName = cfg.companyName.toUpperCase();
          if (cfg.companyAddress) companyAddress = cfg.companyAddress;
          if (cfg.companyPhone) companyPhone = cfg.companyPhone;
          if (cfg.companyEmail) companyEmail = cfg.companyEmail;
          if (cfg.companyTaxCode) companyTaxCode = cfg.companyTaxCode;
          if (cfg.companyRepresentative) companyRep = cfg.companyRepresentative.toUpperCase();
          if (cfg.companyRepresentativeRole) companyRepRole = cfg.companyRepresentativeRole;
          if (cfg.bankAccount) companyAccountNo = cfg.bankAccount;
          if (cfg.bankName) companyBank = cfg.bankName;
        }
      }
    } catch (e) {
      console.error("Failed to load company config for contract-pdf:", e);
    }

    // Thông tin pháp lý của công ty phải lấy từ Cấu hình. Trước đây thiếu cấu hình thì in mã số thuế, địa chỉ
    // (và một số tài khoản ngân hàng không có thật) cố định trong code lên chứng từ gửi khách hàng.
    const missingCompanyFields = ([["Tên công ty", companyName], ["Mã số thuế", companyTaxCode], ["Địa chỉ", companyAddress], ["Người đại diện", companyRep]] as [string, string][]).filter(([, v]) => !String(v || "").trim()).map(([label]) => label);
    if (missingCompanyFields.length > 0) {
      return new NextResponse(
        `<h1>Chưa cấu hình thông tin công ty</h1><p>Thiếu: ${missingCompanyFields.join(", ")}. Quản trị viên vui lòng cập nhật Cấu hình thông tin công ty trước khi xuất chứng từ.</p>`,
        { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } }
      );
    }

    // Party B details
    const partyBName = (meta.party_b_name || c.customer_name || "Quý Khách Hàng").toUpperCase();
    const partyBAddress = meta.party_b_address || "Theo đăng ký kinh doanh và thỏa thuận";
    const partyBPhone = meta.party_b_phone || ".............................................";
    const partyBTaxCode = meta.party_b_tax_code || ".............................................";
    const partyBRep = meta.party_b_representative || "Đại diện Quý Đơn Vị";
    const partyBRole = meta.party_b_role || "Đại diện hợp pháp";
    const deliveryTerms = meta.delivery_terms || "Trong vòng 07 ngày làm việc kể từ ngày hợp đồng có hiệu lực.";
    const paymentTerms = meta.payment_terms || "Chuyển khoản trong vòng 30 ngày kể từ ngày nhận đủ hóa đơn GTGT và biên bản bàn giao hàng hóa.";
    const quoteRef = meta.quote_code ? `Căn cứ theo Báo giá số: ${meta.quote_code}` : "";

    // Financial calculations
    const subtotal = Number(meta.subtotal) || items.reduce((s: number, it: any) => s + (Number(it.total) || (Number(it.quantity || it.qty || 1) * Number(it.price || it.unitPrice || 0))), 0);
    const discountRate = Number(meta.discount_rate) || 0;
    const discountAmount = Number(meta.discount_amount) || Math.round((subtotal * discountRate) / 100);
    const afterDiscount = subtotal - discountAmount;
    const taxRate = Number(meta.tax_rate) || 8;
    const taxAmount = Math.round((afterDiscount * taxRate) / 100);
    const totalAmount = Number(c.total_value) || (afterDiscount + taxAmount);

    const subtotalFmt = new Intl.NumberFormat("vi-VN").format(subtotal);
    const discountFmt = new Intl.NumberFormat("vi-VN").format(discountAmount);
    const vatFmt = new Intl.NumberFormat("vi-VN").format(taxAmount);
    const totalFmt = new Intl.NumberFormat("vi-VN").format(totalAmount);
    const totalInWords = numberToVietnameseWords(totalAmount);

    const signDate = c.sign_date ? new Date(c.sign_date) : new Date();
    const day = signDate.getDate().toString().padStart(2, "0");
    const month = (signDate.getMonth() + 1).toString().padStart(2, "0");
    const year = signDate.getFullYear();

    const rowsHtml = items.map((it: any, idx: number) => {
      const pName = it.productName || it.product_name || it.name || "Sản phẩm / Sinh phẩm xét nghiệm";
      const pCode = it.productCode || it.product_code || it.sku || it.code || "-";
      const pUnit = it.unit || "Hộp";
      const pQty = Number(it.quantity ?? it.qty ?? 1) || 1;
      const pPrice = Number(it.price ?? it.unitPrice ?? it.unit_price ?? 0) || 0;
      const pTotal = Number(it.total ?? it.amount ?? (pQty * pPrice)) || (pQty * pPrice);
      return `
      <tr>
        <td style="text-align: center; border: 1px solid #334155; padding: 7px 6px;">${idx + 1}</td>
        <td style="text-align: center; font-weight: bold; border: 1px solid #334155; padding: 7px 6px; font-family: monospace;">${pCode}</td>
        <td style="border: 1px solid #334155; padding: 7px 8px; font-weight: bold; color: #0f172a;">${pName}</td>
        <td style="text-align: center; border: 1px solid #334155; padding: 7px 6px;">${pUnit}</td>
        <td style="text-align: center; border: 1px solid #334155; padding: 7px 6px; font-weight: bold;">${pQty}</td>
        <td style="text-align: right; border: 1px solid #334155; padding: 7px 8px;">${new Intl.NumberFormat("vi-VN").format(pPrice)} đ</td>
        <td style="text-align: right; border: 1px solid #334155; padding: 7px 8px; font-weight: bold; color: #1e3a8a;">${new Intl.NumberFormat("vi-VN").format(pTotal)} đ</td>
      </tr>
      `;
    }).join("");

    const html = `
<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <title>Hợp Đồng Mua Bán - ${c.contract_code}</title>
  <style>
    @page {
      size: A4;
      margin: 16mm 14mm 16mm 14mm;
    }
    *, *:before, *:after { box-sizing: border-box; }
    body {
      font-family: "Times New Roman", Times, serif;
      font-size: 13pt;
      line-height: 1.5;
      color: #0f172a;
      background: #ffffff;
      margin: 0;
      padding: 20px 40px;
    }
    .no-print {
      display: flex;
      gap: 12px;
      margin-bottom: 25px;
      padding-bottom: 15px;
      border-bottom: 1px solid #e2e8f0;
    }
    .print-btn {
      padding: 10px 22px;
      background: #1e40af;
      color: #ffffff;
      border: none;
      border-radius: 6px;
      font-weight: bold;
      font-family: Arial, sans-serif;
      font-size: 13px;
      cursor: pointer;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    .header-national {
      text-align: center;
      margin-bottom: 25px;
    }
    .national-title {
      font-size: 12pt;
      font-weight: bold;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .motto {
      font-size: 13pt;
      font-weight: bold;
      text-decoration: underline;
      margin-top: 2px;
    }
    .contract-title {
      font-size: 16pt;
      font-weight: bold;
      text-transform: uppercase;
      color: #000;
      text-align: center;
      margin-top: 30px;
    }
    .contract-meta {
      text-align: center;
      font-style: italic;
      font-size: 11pt;
      margin-top: 4px;
      margin-bottom: 22px;
      color: #334155;
    }
    .legal-basis {
      font-style: italic;
      font-size: 11pt;
      margin-bottom: 18px;
      text-align: justify;
      color: #334155;
      line-height: 1.45;
    }
    .party-title {
      font-weight: bold;
      text-transform: uppercase;
      font-size: 12.5pt;
      color: #1e3a8a;
      margin-top: 14px;
      margin-bottom: 5px;
      border-bottom: 1px solid #cbd5e1;
      padding-bottom: 3px;
    }
    .party-row {
      display: flex;
      margin-bottom: 4px;
      font-size: 12pt;
    }
    .party-lbl {
      width: 145px;
      font-weight: bold;
      flex-shrink: 0;
    }
    .party-val {
      flex: 1;
    }
    .article-title {
      font-weight: bold;
      text-transform: uppercase;
      font-size: 12.5pt;
      color: #0f172a;
      margin-top: 18px;
      margin-bottom: 6px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 12px 0;
      font-size: 11.5pt;
    }
    th {
      background-color: #f1f5f9;
      color: #0f172a;
      border: 1px solid #334155;
      padding: 8px 6px;
      text-align: center;
      font-weight: bold;
    }
    .totals-box {
      width: 380px;
      margin-left: auto;
      margin-top: 8px;
      margin-bottom: 16px;
      font-size: 12pt;
    }
    .totals-row {
      display: flex;
      justify-content: space-between;
      padding: 3px 0;
      border-bottom: 1px dashed #cbd5e1;
    }
    .grand-total {
      font-weight: bold;
      font-size: 13.5pt;
      color: #1e3a8a;
      border-bottom: 2px solid #1e3a8a;
      padding: 6px 0;
    }
    .words-box {
      font-style: italic;
      font-weight: bold;
      margin-bottom: 16px;
      text-align: right;
      color: #1e3a8a;
      font-size: 11.5pt;
    }
    .signatures {
      margin-top: 40px;
      display: flex;
      justify-content: space-between;
      page-break-inside: avoid;
      font-size: 12pt;
    }
    .sig-block {
      width: 45%;
      text-align: center;
    }
    .sig-stamp {
      margin-top: 60px;
      color: #1e40af;
      font-weight: bold;
      font-style: italic;
    }
    @media print {
      body { padding: 0; margin: 0; }
      .no-print { display: none !important; }
    }
  </style>
</head>
<body>

  <div class="no-print">
    <button class="print-btn" onclick="window.print()">🖨 In Hợp Đồng / Lưu Bản PDF</button>
  </div>

  <div class="header-national">
    <div class="national-title">CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM</div>
    <div class="motto">Độc lập - Tự do - Hạnh phúc</div>
    <div class="contract-title">HỢP ĐỒNG MUA BÁN HÀNG HÓA &amp; SINH PHẨM Y TẾ</div>
    <div class="contract-meta">Số: <strong>${c.contract_code}</strong> / HĐMB-TBRS</div>
  </div>

  <div class="legal-basis">
    - Căn cứ Bộ Luật Dân sự số 91/2015/QH13 được Quốc hội nước CHXHCN Việt Nam thông qua ngày 24/11/2015;<br>
    - Căn cứ Luật Thương mại số 36/2005/QH11 được Quốc hội nước CHXHCN Việt Nam thông qua ngày 14/06/2005;<br>
    ${quoteRef ? `- ${quoteRef};<br>` : ""}
    - Căn cứ vào nhu cầu của Bên Mua và khả năng cung cấp hàng hóa của Bên Bán.
  </div>

  <p>Hôm nay, ngày ${day} tháng ${month} năm ${year}, tại văn phòng Công ty TNHH Khoa học TBR, chúng tôi gồm có:</p>

  <!-- BÊN A -->
  <div class="party-title">BÊN BÁN (BÊN A): ${companyName}</div>
  <div class="party-row"><span class="party-lbl">Địa chỉ trụ sở:</span><span class="party-val">${companyAddress}</span></div>
  <div class="party-row"><span class="party-lbl">Điện thoại:</span><span class="party-val">${companyPhone} | Email: ${companyEmail}</span></div>
  <div class="party-row"><span class="party-lbl">Mã số thuế:</span><span class="party-val"><strong>${companyTaxCode}</strong></span></div>
  ${companyAccountNo ? `<div class="party-row"><span class="party-lbl">Tài khoản ngân hàng:</span><span class="party-val">Số TK: <strong>${companyAccountNo}</strong>${companyBank ? ` tại ${companyBank}` : ""}</span></div>` : ""}
  <div class="party-row"><span class="party-lbl">Người đại diện:</span><span class="party-val"><strong>${companyRep}</strong> &mdash; Chức vụ: ${companyRepRole}</span></div>

  <!-- BÊN B -->
  <div class="party-title">BÊN MUA (BÊN B): ${partyBName}</div>
  <div class="party-row"><span class="party-lbl">Địa chỉ:</span><span class="party-val">${partyBAddress}</span></div>
  <div class="party-row"><span class="party-lbl">Điện thoại:</span><span class="party-val">${partyBPhone}</span></div>
  <div class="party-row"><span class="party-lbl">Mã số thuế:</span><span class="party-val"><strong>${partyBTaxCode}</strong></span></div>
  <div class="party-row"><span class="party-lbl">Người đại diện:</span><span class="party-val"><strong>${partyBRep}</strong> &mdash; Chức vụ: ${partyBRole}</span></div>

  <p style="margin-top: 15px;">Hai bên thống nhất ký kết Hợp đồng mua bán hàng hóa với các điều khoản và cam kết cụ thể như sau:</p>

  <!-- ĐIỀU 1 -->
  <div class="article-title">ĐIỀU 1: HÀNG HÓA VÀ GIÁ TRỊ HỢP ĐỒNG</div>
  <p>1.1. Bên A đồng ý bán và Bên B đồng ý mua danh mục thiết bị, sinh phẩm y tế xét nghiệm với số lượng và đơn giá quy định như sau:</p>

  <table>
    <thead>
      <tr>
        <th style="width: 35px;">STT</th>
        <th style="width: 110px;">Mã SKU</th>
        <th>Tên Hàng Hóa / Sinh Phẩm</th>
        <th style="width: 60px;">ĐVT</th>
        <th style="width: 60px;">SL</th>
        <th style="width: 125px;">Đơn Giá (VNĐ)</th>
        <th style="width: 135px;">Thành Tiền (VNĐ)</th>
      </tr>
    </thead>
    <tbody>
      ${rowsHtml}
    </tbody>
  </table>

  <div class="totals-box">
    <div class="totals-row"><span>Cộng tiền hàng:</span><span>${subtotalFmt} đ</span></div>
    ${discountAmount > 0 ? `<div class="totals-row"><span>Chiết khấu (${discountRate}%):</span><span style="color: #dc2626;">-${discountFmt} đ</span></div>` : ""}
    <div class="totals-row"><span>Thuế VAT (${taxRate}%):</span><span>+${vatFmt} đ</span></div>
    <div class="totals-row grand-total"><span>TỔNG CỘNG THANH TOÁN:</span><span>${totalFmt} đ</span></div>
  </div>

  <div class="words-box">Bằng chữ: ${totalInWords}.</div>

  <!-- ĐIỀU 2 -->
  <div class="article-title">ĐIỀU 2: TIÊU CHUẨN CHẤT LƯỢNG &amp; NGUỒN GỐC XUẤT XỨ</div>
  <p>
    2.1. Hàng hóa cung cấp mới 100%, chưa qua sử dụng, có đầy đủ Giấy chứng nhận xuất xưởng (CO/CQ), Giấy chứng nhận tiêu chuẩn ISO 13485:2016.<br>
    2.2. Hạn sử dụng của sản phẩm và sinh phẩm xét nghiệm đảm bảo theo quy định chuẩn FEFO khi bàn giao tại cơ sở của Bên B.<br>
    2.3. Hàng hóa được bảo quản theo đúng tiêu chuẩn kỹ thuật nhiệt độ bảo quản của nhà sản xuất trong suốt quá trình vận chuyển.
  </p>

  <!-- ĐIỀU 3 -->
  <div class="article-title">ĐIỀU 3: THỜI GIAN, ĐỊA ĐIỂM VÀ PHƯƠNG THỨC GIAO HÀNG</div>
  <p>
    3.1. <strong>Thời gian giao hàng:</strong> ${deliveryTerms}<br>
    3.2. <strong>Địa điểm giao hàng:</strong> Tại địa chỉ của Bên B: ${partyBAddress}.<br>
    3.3. <strong>Phương thức giao hàng:</strong> Bên A vận chuyển và bàn giao trực tiếp hàng hóa kèm theo Phiếu giao hàng, Biên bản bàn giao và Hóa đơn GTGT điện tử.
  </p>

  <!-- ĐIỀU 4 -->
  <div class="article-title">ĐIỀU 4: PHƯƠNG THỨC VÀ ĐIỀU KIỆN THANH TOÁN</div>
  <p>
    4.1. <strong>Đồng tiền thanh toán:</strong> Việt Nam Đồng (VNĐ).<br>
    4.2. <strong>Hình thức thanh toán:</strong> Chuyển khoản qua tài khoản ngân hàng của Bên A.<br>
    4.3. <strong>Điều kiện thanh toán:</strong> ${paymentTerms}
  </p>

  <!-- ĐIỀU 5 -->
  <div class="article-title">ĐIỀU 5: TRÁCH NHIỆM VÀ QUYỀN HẠN CỦA CÁC BÊN</div>
  <p>
    5.1. <strong>Trách nhiệm Bên A:</strong> Cung cấp hàng hóa đúng chủng loại, chất lượng và thời hạn cam kết; cung cấp đầy đủ tài liệu IFU hướng dẫn và hóa đơn GTGT hợp lệ.<br>
    5.2. <strong>Trách nhiệm Bên B:</strong> Bố trí nhân sự nhận hàng, kiểm tra số lượng tình trạng niêm phong và thực hiện nghĩa vụ thanh toán đúng hạn quy định tại Điều 4.
  </p>

  <!-- ĐIỀU 6 -->
  <div class="article-title">ĐIỀU 6: ĐIỀU KHOẢN CHUNG &amp; HIỆU LỰC HỢP ĐỒNG</div>
  <p>
    6.1. Hợp đồng này có hiệu lực kể từ ngày ký và có giá trị trong vòng 01 (một) năm hoặc cho đến khi hai bên hoàn thành toàn bộ nghĩa vụ giao nhận và thanh toán.<br>
    6.2. Hợp đồng được lập thành 04 (bốn) bản có giá trị pháp lý như nhau, Bên A giữ 02 bản, Bên B giữ 02 bản để cùng thực hiện.
  </p>

  <!-- CHỮ KÝ -->
  <div class="signatures">
    <div class="sig-block">
      <strong>ĐẠI DIỆN BÊN MUA (BÊN B)</strong><br>
      <span style="font-size: 11pt; font-style: italic; color: #64748b;">(Ký, ghi rõ họ tên và đóng dấu)</span>
      <div style="margin-top: 70px;">
        <strong>${partyBRep}</strong><br>
        <span>${partyBRole}</span>
      </div>
    </div>
    <div class="sig-block">
      <strong>ĐẠI DIỆN BÊN BÁN (BÊN A)</strong><br>
      <span style="font-size: 11pt; font-style: italic; color: #64748b;">(Đã ký điện tử &amp; xác thực hệ thống)</span>
      <div class="sig-stamp" style="color: ${['ACTIVE', 'APPROVED', 'SIGNED', 'COMPLETED'].includes(String(c.status || '').toUpperCase()) ? '#1e40af' : '#b45309'};">
        ${['ACTIVE', 'APPROVED', 'SIGNED', 'COMPLETED'].includes(String(c.status || '').toUpperCase())
          ? `[ ĐÃ XÁC THỰC BỞI ${companyRep} ]`
          : '[ DỰ THẢO — CHỜ PHÊ DUYỆT ]'}<br>
        <span style="font-size: 10pt; font-weight: normal; color: #64748b;">Hệ Thống Quản Lý TBRs Portal</span>
      </div>
      <div style="margin-top: 20px;">
        <strong>${companyRep}</strong><br>
        <span>${companyRepRole}</span>
      </div>
    </div>
  </div>

</body>
</html>
    `;

    return new NextResponse(html, {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" }
    });
  } catch (error: any) {
    return new NextResponse(`<h1 style='color: red;'>Lỗi kết xuất hợp đồng: ${escapeHtml(error.message)}</h1>`, { status: 500 });
  }
}

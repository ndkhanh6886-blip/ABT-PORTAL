import { NextRequest, NextResponse } from "next/server";
import { query } from "@/backend/db/db";
import { canAccessDocument, documentAccessDeniedResponse } from "@/backend/services/documentLinks";
import { escapeDeep, escapeHtml } from "@/backend/services/html";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const code = searchParams.get("code") || "";
    if (!(await canAccessDocument(req, "quotation", code))) return documentAccessDeniedResponse();

    const quoteRes = await query("SELECT * FROM sales_quotations WHERE quote_code = $1", [code]);
    if (quoteRes.rows.length === 0) {
      return new NextResponse("<h1>Không tìm thấy báo giá</h1>", {
        status: 404,
        headers: { "Content-Type": "text/html; charset=utf-8" }
      });
    }

    // Mọi chuỗi từ CSDL được mã hóa HTML trước khi chèn vào trang (chống chèn mã độc qua tên khách hàng / hàng hóa)
    const rawQ = quoteRes.rows[0];
    const parsedItems = typeof rawQ.items === "string" ? JSON.parse(rawQ.items || "[]") : (rawQ.items || []);
    const items: any[] = escapeDeep(Array.isArray(parsedItems) ? parsedItems : []);
    const q = escapeDeep(rawQ);

    const subtotalFmt = new Intl.NumberFormat("vi-VN").format(parseFloat(q.subtotal || 0));
    const discountFmt = new Intl.NumberFormat("vi-VN").format(parseFloat(q.discount_amount || 0));
    const vatFmt = new Intl.NumberFormat("vi-VN").format(parseFloat(q.tax_amount || 0));
    const totalFmt = new Intl.NumberFormat("vi-VN").format(parseFloat(q.total_amount || 0));

    // Dynamic company configuration from app_storage
    let companyName = "Công ty TNHH Khoa học TBR";
    let companyAddress = "51 Đường số 26, Phường An Lạc, TP. HCM";
    let companyPhone = "028 3872 9999";
    let companyEmail = "info@tbrscientific.com";
    let companyTaxCode = "0314892019";
    let companyRep = "BAN GIÁM ĐỐC TBRs";

    try {
      const configRes = await query("SELECT data FROM app_storage WHERE key = $1", ["sales_company_config"]);
      if (configRes.rows.length > 0) {
        const raw = configRes.rows[0].data;
        const cfg = escapeDeep(typeof raw === "string" ? JSON.parse(raw) : raw);
        if (cfg) {
          if (cfg.companyName) companyName = cfg.companyName;
          if (cfg.companyAddress) companyAddress = cfg.companyAddress;
          if (cfg.companyPhone) companyPhone = cfg.companyPhone;
          if (cfg.companyEmail) companyEmail = cfg.companyEmail;
          if (cfg.companyTaxCode) companyTaxCode = cfg.companyTaxCode;
          if (cfg.companyRepresentative) companyRep = cfg.companyRepresentative;
        }
      }
    } catch (e) {
      console.error("Failed to load company config for quotation-pdf:", e);
    }

    const rowsHtml = items.map((it: any, idx: number) => {
      const pName = it.productName || it.product_name || it.name || "Sản phẩm";
      const pCode = it.productCode || it.product_code || it.sku || it.code || "-";
      const pUnit = it.unit || "Hộp";
      const pQty = Number(it.quantity ?? it.qty ?? 1) || 1;
      const pPrice = Number(it.price ?? it.unitPrice ?? it.unit_price ?? 0) || 0;
      const pTotal = Number(it.total ?? it.amount ?? (pQty * pPrice)) || (pQty * pPrice);
      return `
      <tr>
        <td style="text-align: center; border: 1px solid #cbd5e1; padding: 10px;">${idx + 1}</td>
        <td style="border: 1px solid #cbd5e1; padding: 10px; font-weight: bold; color: #1e293b;">${pName}<br/><span style="font-size: 11px; color: #64748b; font-family: monospace;">Mã SKU: ${pCode}</span></td>
        <td style="text-align: center; border: 1px solid #cbd5e1; padding: 10px;">${pUnit}</td>
        <td style="text-align: center; border: 1px solid #cbd5e1; padding: 10px; font-weight: bold;">${pQty}</td>
        <td style="text-align: right; border: 1px solid #cbd5e1; padding: 10px;">${new Intl.NumberFormat("vi-VN").format(pPrice)} đ</td>
        <td style="text-align: right; border: 1px solid #cbd5e1; padding: 10px; font-weight: bold; color: #2563eb;">${new Intl.NumberFormat("vi-VN").format(pTotal)} đ</td>
      </tr>
      `;
    }).join("");

    const html = `
<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <title>Báo Giá ${q.quote_code} - ${companyName}</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 40px; color: #1e293b; background: #fff; line-height: 1.5; }
    .header { display: flex; justify-content: space-between; border-bottom: 2px solid #2563eb; padding-bottom: 20px; }
    .company-title { font-size: 18px; font-weight: bold; color: #1e3a8a; text-transform: uppercase; }
    .company-info { font-size: 12px; color: #475569; margin-top: 5px; }
    .quote-title { text-align: center; font-size: 22px; font-weight: 900; color: #1e293b; margin: 30px 0 10px 0; text-transform: uppercase; }
    .quote-meta { text-align: center; font-size: 12px; color: #64748b; margin-bottom: 25px; }
    .info-grid { display: flex; justify-content: space-between; margin-bottom: 25px; background: #f8fafc; border: 1px solid #e2e8f0; padding: 15px; border-radius: 8px; font-size: 13px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 25px; font-size: 13px; }
    th { background: #f1f5f9; color: #334155; border: 1px solid #cbd5e1; padding: 10px; text-transform: uppercase; font-size: 11px; }
    .totals { width: 350px; margin-left: auto; margin-bottom: 30px; font-size: 13px; }
    .totals div { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px dashed #cbd5e1; }
    .totals .grand-total { font-weight: 900; font-size: 16px; color: #1e3a8a; border-bottom: 2px solid #1e3a8a; }
    .signatures { display: flex; justify-content: space-between; margin-top: 50px; text-align: center; font-size: 13px; }
    .stamp { margin-top: 60px; font-style: italic; color: #1e40af; font-weight: bold; }
    @media print {
      body { margin: 0; }
      .no-print { display: none; }
    }
  </style>
</head>
<body>
  <div class="no-print" style="margin-bottom: 20px; display: flex; gap: 10px;">
    <button onclick="window.print()" style="padding: 10px 20px; background: #2563eb; color: white; border: none; border-radius: 6px; font-weight: bold; cursor: pointer;">🖨 In Báo Giá / Lưu PDF</button>
  </div>

  <div class="header">
    <div>
      <div class="company-title">${companyName}</div>
      <div class="company-info">
        Địa chỉ: ${companyAddress}<br/>
        ${companyPhone ? `Điện thoại: ${companyPhone} ` : ""}${companyEmail ? `| Email: ${companyEmail}` : ""}<br/>
        ${companyTaxCode ? `Mã Số Thuế: ${companyTaxCode}` : ""}
      </div>
    </div>
    <div style="text-align: right;">
      <span style="display: inline-block; padding: 6px 12px; background: #dbeafe; color: #1e40af; font-weight: bold; border-radius: 20px; font-size: 12px;">
        ${['APPROVED', 'SENT'].includes(String(q.status || '').toUpperCase()) ? 'ĐÃ DUYỆT CHÍNH THỨC' : String(q.status || '').toUpperCase() === 'REJECTED' ? 'ĐÃ TỪ CHỐI PHÊ DUYỆT' : 'CHỜ DUYỆT CHIẾT KHẤU'}
      </span>
    </div>
  </div>

  <div class="quote-title">BẢNG BÁO GIÁ THIẾT BỊ & SINH PHẨM Y TẾ</div>
  <div class="quote-meta">Số báo giá: <strong>${q.quote_code}</strong> | Ngày phát hành: ${new Date(q.date || Date.now()).toLocaleDateString('vi-VN')}</div>

  <div class="info-grid">
    <div>
      <strong>KÍNH GỬI QUÝ KHÁCH HÀNG:</strong><br/>
      Đơn vị: <strong>${q.customer_name || 'Quý Khách Hàng / Quý Bệnh Viện'}</strong><br/>
      Đại diện: Đại diện Quý Khách hàng
    </div>
    <div style="text-align: right;">
      <strong>ĐẠI DIỆN KINH DOANH:</strong><br/>
      NVKD: <strong>${q.sales_rep_name || 'Đại Diện Kinh Doanh'}</strong><br/>
      Phòng: Kinh Doanh
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th style="width: 40px;">STT</th>
        <th>Tên Hàng Hóa / Quy Cách</th>
        <th style="width: 70px;">ĐVT</th>
        <th style="width: 70px;">Số Lượng</th>
        <th style="width: 130px; text-align: right;">Đơn Giá (VNĐ)</th>
        <th style="width: 140px; text-align: right;">Thành Tiền (VNĐ)</th>
      </tr>
    </thead>
    <tbody>
      ${rowsHtml}
    </tbody>
  </table>

  <div class="totals">
    <div><span>Cộng tiền hàng:</span> <span>${subtotalFmt} đ</span></div>
    ${q.discount_amount > 0 ? `<div><span>Chiết khấu (${q.discount_rate}%):</span> <span style="color: #dc2626;">-${discountFmt} đ</span></div>` : ''}
    <div><span>Thuế VAT (${q.tax_rate || 8}%):</span> <span>${vatFmt} đ</span></div>
    <div class="grand-total"><span>TỔNG CỘNG:</span> <span>${totalFmt} đ</span></div>
  </div>

  <div style="font-size: 12px; color: #475569; border-top: 1px solid #e2e8f0; padding-top: 15px;">
    <strong>ĐIỀU KHOẢN VÀ HIỆU LỰC:</strong><br/>
    • Báo giá có hiệu lực trong vòng 30 ngày kể từ ngày ban hành.<br/>
    • Đơn giá đã bao gồm chi phí vận chuyển giao hàng tận nơi theo hợp đồng.<br/>
    • Bảo hành chính hãng đối với thiết bị, đầy đủ chứng chỉ CO/CQ và Hóa đơn GTGT.
  </div>

  <div class="signatures">
    <div>
      <strong>ĐẠI DIỆN KHÁCH HÀNG</strong><br/>
      <span style="font-size: 11px; color: #64748b;">(Ký và ghi rõ họ tên)</span>
    </div>
    <div>
      <strong>ĐẠI DIỆN ${companyName.toUpperCase()}</strong><br/>
      <span style="font-size: 11px; color: #64748b;">(Đã ký điện tử &amp; xác thực hệ thống)</span>
      <div class="stamp" style="color: ${['APPROVED', 'SENT'].includes(String(q.status || '').toUpperCase()) ? '#1e40af' : String(q.status || '').toUpperCase() === 'REJECTED' ? '#dc2626' : '#b45309'};">
        ${['APPROVED', 'SENT'].includes(String(q.status || '').toUpperCase())
          ? `[ ĐÃ PHÊ DUYỆT BỞI ${companyRep.toUpperCase()} ]`
          : String(q.status || '').toUpperCase() === 'REJECTED'
          ? '[ ĐÃ TỪ CHỐI PHÊ DUYỆT ]'
          : '[ BẢN DỰ THẢO — CHỜ PHÊ DUYỆT ]'}<br/>
        <span style="font-size: 10px; font-weight: normal; color: #64748b;">Xác thực hệ thống Portal</span>
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
    return new NextResponse(`Lỗi kết xuất báo giá: ${escapeHtml(error.message)}`, { status: 500 });
  }
}

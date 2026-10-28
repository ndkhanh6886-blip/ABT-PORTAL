import ExcelJS from "exceljs";

interface QuotationExportOptions {
    quote: any;
    allSalesProducts?: any[];
    biolabProducts?: any[];
    salesPersonnel?: any[];
    salesPersonnelContacts?: Record<string, any>;
    companyConfig?: any;
    formatSupplierShortName: (name: string) => string;
    readVietnameseCurrency?: (amount: number) => string;
    stripVietnameseHonorifics?: (name: string) => string;
}

function internalReadVietnameseCurrency(amount: number): string {
    if (!amount || isNaN(amount) || amount === 0) return "Không đồng chẵn";
    const digits = ["không", "một", "hai", "ba", "bốn", "năm", "sáu", "bảy", "tám", "chín"];
    const units = ["", "nghìn", "triệu", "tỷ", "nghìn tỷ", "triệu tỷ"];

    function readTriple(n: number, showZeroHundred: boolean): string {
        const h = Math.floor(n / 100);
        const t = Math.floor((n % 100) / 10);
        const u = n % 10;
        let res = "";

        if (h > 0 || showZeroHundred) {
            res += digits[h] + " trăm ";
        }

        if (t > 1) {
            res += digits[t] + " mươi ";
            if (u === 1) res += "mốt ";
            else if (u === 5) res += "lăm ";
            else if (u > 0) res += digits[u] + " ";
        } else if (t === 1) {
            res += "mười ";
            if (u === 5) res += "lăm ";
            else if (u > 0) res += digits[u] + " ";
        } else if (u > 0) {
            if (h > 0 || showZeroHundred) res += "lẻ ";
            res += digits[u] + " ";
        }

        return res.trim();
    }

    const strNum = Math.round(Math.abs(amount)).toString();
    const groups: number[] = [];
    for (let i = strNum.length; i > 0; i -= 3) {
        groups.push(parseInt(strNum.substring(Math.max(0, i - 3), i), 10));
    }

    let result = "";
    for (let i = groups.length - 1; i >= 0; i--) {
        const val = groups[i];
        if (val > 0) {
            const tripleStr = readTriple(val, i < groups.length - 1);
            result += tripleStr + " " + units[i] + " ";
        }
    }

    result = result.trim() + " đồng chẵn";
    return result;
}

export async function exportCustomerQuotationToExcel({
    quote,
    allSalesProducts = [],
    biolabProducts = [],
    salesPersonnel = [],
    salesPersonnelContacts = {},
    companyConfig = {},
    formatSupplierShortName,
    readVietnameseCurrency,
    stripVietnameseHonorifics = (s) => s
}: QuotationExportOptions) {
    if (!quote) return;

    const repObj = salesPersonnel.find(p => p.employee_id === quote.salesRepId);
    const repFullName = quote.salesRepName || repObj?.full_name || "Nhân viên kinh doanh";
    const cleanRepName = stripVietnameseHonorifics(repFullName);
    const repPhone = quote.salesRepPhone || salesPersonnelContacts[quote.salesRepId]?.phone || companyConfig.phone || "0987 875 934";
    const repEmail = quote.salesRepEmail || salesPersonnelContacts[quote.salesRepId]?.email || repObj?.email || companyConfig.email || "sales@tbrscientific.com";

    const compName = companyConfig.companyName || "Công ty TNHH Khoa học TBR";
    const compAddress = companyConfig.companyAddress || "Xưởng 5.04, Nhà xưởng cao tầng, Lô L2, đường Long Hậu - Hiệp Phước, KCN Long Hậu, Xã Cần Giuộc, Tỉnh Tây Ninh, Việt Nam";
    const compPhone = companyConfig.companyPhone || "028.667.03268 - 0343.797.727";
    const compEmail = companyConfig.companyEmail || "sales01@tbrscientific.com";
    const compTaxCode = companyConfig.companyTaxCode || "1102031182";
    const compWebsite = companyConfig.companyWebsite || "www.tbrscientific.com";

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "TBR Portal Enterprise";
    workbook.lastModifiedBy = cleanRepName;
    workbook.created = new Date();
    workbook.modified = new Date();

    const sheet = workbook.addWorksheet("Báo Giá Khách Hàng", {
        views: [{ showGridLines: true }],
        pageSetup: {
            paperSize: 9, // A4
            orientation: "landscape",
            fitToPage: true,
            fitToWidth: 1,
            fitToHeight: 0,
            margins: {
                left: 0.5,
                right: 0.5,
                top: 0.6,
                bottom: 0.6,
                header: 0.3,
                footer: 0.3
            }
        }
    });

    // Financial & Tax analysis across quotation items & totals
    let itemsSum = 0;
    (quote.items || []).forEach((it: any) => {
        const qty = Number(it.quantity !== undefined ? it.quantity : (it.qty !== undefined ? it.qty : 1)) || 1;
        const price = Number(it.price !== undefined ? it.price : (it.unitPrice !== undefined ? it.unitPrice : 0)) || 0;
        const total = Number(it.total !== undefined ? it.total : (it.amount !== undefined ? it.amount : qty * price)) || (qty * price);
        itemsSum += total;
    });

    const hasItems = Array.isArray(quote.items) && quote.items.length > 0;

    const rawSubtotalStored = Number(quote.totalBeforeVat !== undefined ? quote.totalBeforeVat : (quote.subtotal !== undefined ? quote.subtotal : 0));
    const rawDiscountStored = Number(quote.totalDiscount !== undefined ? quote.totalDiscount : (quote.discount_amount !== undefined ? quote.discount_amount : 0)) || 0;
    const rawVatStored = Number(quote.totalVat !== undefined ? quote.totalVat : (quote.tax_amount !== undefined ? quote.tax_amount : 0)) || 0;
    const rawTotalStored = Number(quote.totalAmount !== undefined ? quote.totalAmount : (quote.total_amount !== undefined ? quote.total_amount : 0));
    const taxRateVal = Number(quote.taxRate !== undefined ? quote.taxRate : (quote.tax_rate !== undefined ? quote.tax_rate : 8)) || 8;

    const isItemsPricePreVat = hasItems && Boolean(
        quote.isPricePreVat === true ||
        quote.price_includes_vat === false ||
        (rawVatStored > 0 && Math.abs(itemsSum - rawSubtotalStored) <= 50 && rawTotalStored > itemsSum + 50)
    );

    // VAT Breakdown calculation across all items
    const vatRateMap = new Map<number, { rate: number; taxableAmount: number; vatAmount: number; count: number }>();
    let lineItemsPreVatSum = 0;
    let lineItemsVatSum = 0;
    let lineItemsDiscSum = 0;

    (quote.items || []).forEach((it: any) => {
        const itQty = Number(it.quantity !== undefined ? it.quantity : (it.qty !== undefined ? it.qty : 1)) || 0;
        const itPrice = Number(it.price !== undefined ? it.price : (it.unitPrice !== undefined ? it.unitPrice : 0)) || 0;
        const itDiscRate = Number(it.discountRate !== undefined ? it.discountRate : (it.discountPercent !== undefined ? it.discountPercent : 0)) || 0;

        const rawRate = it.vatRate !== undefined ? it.vatRate :
            (it.vat_rate !== undefined ? it.vat_rate :
            (it.taxRate !== undefined ? it.taxRate :
            (it.tax_rate !== undefined ? it.tax_rate :
            (quote.taxRate !== undefined ? quote.taxRate :
            (quote.tax_rate !== undefined ? quote.tax_rate : 8)))));
        const itemVatRate = !isNaN(Number(rawRate)) && Number(rawRate) >= 0 ? Number(rawRate) : 8;

        const lineSubtotal = itQty * itPrice;
        let itemTaxable = 0;
        let itemVat = 0;
        let itemDisc = 0;

        if (isItemsPricePreVat) {
            itemDisc = Math.round(lineSubtotal * (itDiscRate / 100));
            itemTaxable = lineSubtotal - itemDisc;
            itemVat = itemVatRate > 0 ? Math.round(itemTaxable * (itemVatRate / 100)) : 0;
        } else {
            const linePreVat = itemVatRate > 0 ? Math.round(lineSubtotal / (1 + itemVatRate / 100)) : lineSubtotal;
            const itemFinal = lineSubtotal - Math.round(lineSubtotal * (itDiscRate / 100));
            itemTaxable = itemVatRate > 0 ? Math.round(itemFinal / (1 + (itemVatRate / 100))) : itemFinal;
            itemVat = itemFinal - itemTaxable;
            itemDisc = Math.max(0, linePreVat - itemTaxable);
        }

        lineItemsPreVatSum += itemTaxable;
        lineItemsVatSum += itemVat;
        lineItemsDiscSum += itemDisc;

        const bucket = vatRateMap.get(itemVatRate) || { rate: itemVatRate, taxableAmount: 0, vatAmount: 0, count: 0 };
        bucket.taxableAmount += itemTaxable;
        bucket.vatAmount += itemVat;
        bucket.count += 1;
        vatRateMap.set(itemVatRate, bucket);
    });

    const activeVatBuckets = Array.from(vatRateMap.values())
        .filter(b => b.rate > 0 && b.vatAmount > 0)
        .sort((a, b) => a.rate - b.rate);
    const hasMultipleVatRates = activeVatBuckets.length > 1 || vatRateMap.size > 1;
    const totalComputedVat = activeVatBuckets.reduce((sum, b) => sum + b.vatAmount, 0);

    let finalTotalAmountVal: number;
    let rawSubtotal: number;
    let rawDiscount: number = rawDiscountStored || lineItemsDiscSum;
    let effectiveTotalVat: number;

    if (hasItems) {
        if (isItemsPricePreVat) {
            rawSubtotal = itemsSum;
            effectiveTotalVat = totalComputedVat;
            finalTotalAmountVal = rawSubtotal - rawDiscount + effectiveTotalVat;
        } else {
            effectiveTotalVat = totalComputedVat;
            if (rawTotalStored > 0 && Math.abs(rawTotalStored - itemsSum) <= 50) {
                finalTotalAmountVal = rawTotalStored;
            } else {
                finalTotalAmountVal = itemsSum - (rawDiscount > 0 ? Math.round(rawDiscount * (1 + (taxRateVal / 100))) : 0);
            }
            rawSubtotal = finalTotalAmountVal - effectiveTotalVat;
        }
    } else {
        rawSubtotal = rawSubtotalStored || itemsSum;
        effectiveTotalVat = rawVatStored;
        finalTotalAmountVal = rawTotalStored || (rawVatStored > 0 ? (rawSubtotal - rawDiscount + rawVatStored) : rawSubtotal);
    }
    const rawVat = effectiveTotalVat;

    // Column definitions
    sheet.columns = [
        { key: "stt", width: 7 },       // A: STT
        { key: "code", width: 17 },     // B: Mã SP
        { key: "name", width: 44 },     // C: Tên SP / Hàng hóa
        { key: "mfg", width: 16 },      // D: Hãng SX
        { key: "spec", width: 18 },     // E: Quy cách
        { key: "qty", width: 10 },      // F: SL
        { key: "price", width: 18 },    // G: Đơn giá
        { key: "total", width: 22 },    // H: Thành tiền
        { key: "notes", width: 26 },    // I: Ghi chú
    ];

    const thinBorder: Partial<ExcelJS.Borders> = {
        top: { style: "thin", color: { argb: "FFCBD5E1" } },
        bottom: { style: "thin", color: { argb: "FFCBD5E1" } },
        left: { style: "thin", color: { argb: "FFCBD5E1" } },
        right: { style: "thin", color: { argb: "FFCBD5E1" } },
    };

    const headerFill: ExcelJS.FillPattern = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF1E3A8A" } // Brand Navy Blue
    };

    // ==========================================
    // 1. COMPANY HEADER (Rows 1-4) + LOGO
    // ==========================================
    let hasLogoImage = false;
    if (typeof window !== "undefined") {
        try {
            const logoUrl = companyConfig.companyLogo || "/logo-tbrs.png";
            const resp = await fetch(logoUrl);
            if (resp.ok) {
                const arrBuf = await resp.arrayBuffer();
                const imgId = workbook.addImage({
                    buffer: arrBuf,
                    extension: "png",
                });
                sheet.addImage(imgId, {
                    tl: { col: 0.08, row: 0.1 } as any,
                    ext: { width: 56, height: 56 }
                });
                hasLogoImage = true;
            }
        } catch (err) {
            console.warn("Could not load company logo for Excel export:", err);
        }
    }

    const headerStartCol = hasLogoImage ? "B" : "A";
    sheet.mergeCells(`${headerStartCol}1:F1`);
    const cellA1 = sheet.getCell(`${headerStartCol}1`);
    cellA1.value = compName.toUpperCase();
    cellA1.font = { name: "Segoe UI", size: 13, bold: true, color: { argb: "FF1E3A8A" } };
    cellA1.alignment = { vertical: "middle", horizontal: "left" };
    sheet.getRow(1).height = 24;

    sheet.mergeCells(`${headerStartCol}2:F2`);
    const cellA2 = sheet.getCell(`${headerStartCol}2`);
    cellA2.value = `Địa chỉ: ${compAddress}`;
    cellA2.font = { name: "Segoe UI", size: 9.5, color: { argb: "FF475569" } };
    cellA2.alignment = { vertical: "middle", horizontal: "left" };
    sheet.getRow(2).height = 18;

    sheet.mergeCells(`${headerStartCol}3:F3`);
    const cellA3 = sheet.getCell(`${headerStartCol}3`);
    cellA3.value = `Hotline / Tel: ${compPhone}  •  Email: ${compEmail}`;
    cellA3.font = { name: "Segoe UI", size: 9.5, color: { argb: "FF475569" } };
    cellA3.alignment = { vertical: "middle", horizontal: "left" };
    sheet.getRow(3).height = 18;

    sheet.mergeCells(`${headerStartCol}4:F4`);
    const cellA4 = sheet.getCell(`${headerStartCol}4`);
    cellA4.value = `Mã số thuế: ${compTaxCode}  •  Website: ${compWebsite}`;
    cellA4.font = { name: "Segoe UI", size: 9.5, color: { argb: "FF475569" } };
    cellA4.alignment = { vertical: "middle", horizontal: "left" };
    sheet.getRow(4).height = 18;

    // Quote Meta Info (Right side: G1:I4)
    sheet.mergeCells("G1:I1");
    const cellG1 = sheet.getCell("G1");
    cellG1.value = `MÃ BÁO GIÁ: ${quote.id || "QUO"}`;
    cellG1.font = { name: "Segoe UI", size: 11, bold: true, color: { argb: "FF1E3A8A" } };
    cellG1.alignment = { vertical: "middle", horizontal: "right" };

    sheet.mergeCells("G2:I2");
    const cellG2 = sheet.getCell("G2");
    cellG2.value = `Ngày lập: ${quote.date || new Date().toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}`;
    cellG2.font = { name: "Segoe UI", size: 9.5, color: { argb: "FF334155" } };
    cellG2.alignment = { vertical: "middle", horizontal: "right" };

    sheet.mergeCells("G3:I3");
    const cellG3 = sheet.getCell("G3");
    cellG3.value = `Hiệu lực: ${quote.validityDays ? quote.validityDays + " ngày" : "30 ngày"}`;
    cellG3.font = { name: "Segoe UI", size: 9.5, color: { argb: "FF334155" } };
    cellG3.alignment = { vertical: "middle", horizontal: "right" };

    sheet.mergeCells("G4:I4");
    const cellG4 = sheet.getCell("G4");
    cellG4.value = `Phụ trách: ${cleanRepName}`;
    cellG4.font = { name: "Segoe UI", size: 9.5, bold: true, color: { argb: "FF0F172A" } };
    cellG4.alignment = { vertical: "middle", horizontal: "right" };

    // Divider bar
    sheet.getRow(5).height = 8;
    for (let c = 1; c <= 9; c++) {
        sheet.getRow(5).getCell(c).border = {
            bottom: { style: "medium", color: { argb: "FF1E3A8A" } }
        };
    }

    // ==========================================
    // 2. DOCUMENT TITLE (Row 6)
    // ==========================================
    sheet.mergeCells("A6:I6");
    const cellTitle = sheet.getCell("A6");
    cellTitle.value = "BẢNG BÁO GIÁ SẢN PHẨM & DỊCH VỤ";
    cellTitle.font = { name: "Segoe UI", size: 16, bold: true, color: { argb: "FF1E3A8A" } };
    cellTitle.alignment = { vertical: "middle", horizontal: "center" };
    sheet.getRow(6).height = 34;

    // Subtitle note
    sheet.mergeCells("A7:I7");
    const cellSub = sheet.getCell("A7");
    cellSub.value = rawVat > 0
        ? (isItemsPricePreVat
            ? "(Đơn giá chưa bao gồm thuế Giá Trị Gia Tăng - VAT)"
            : "(Đơn giá đã bao gồm thuế Giá Trị Gia Tăng - VAT)")
        : "";
    cellSub.font = { name: "Segoe UI", size: 9.5, italic: true, color: { argb: "FF64748B" } };
    cellSub.alignment = { vertical: "middle", horizontal: "center" };
    sheet.getRow(7).height = 18;

    // ==========================================
    // 3. CLIENT & SALES REP INFO BOX (Rows 8-10)
    // ==========================================
    const clientBoxBg: ExcelJS.FillPattern = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFF8FAFC" }
    };

    sheet.mergeCells("A9:E9");
    const cellCust = sheet.getCell("A9");
    cellCust.value = `Kính gửi: ${quote.customerName || "Quý Khách hàng"}`;
    cellCust.font = { name: "Segoe UI", size: 10.5, bold: true, color: { argb: "FF0F172A" } };
    cellCust.alignment = { vertical: "middle", horizontal: "left" };

    sheet.mergeCells("F9:I9");
    const cellRep = sheet.getCell("F9");
    cellRep.value = `NVKD phụ trách: ${cleanRepName} - ${repPhone}`;
    cellRep.font = { name: "Segoe UI", size: 10, bold: true, color: { argb: "FF1E3A8A" } };
    cellRep.alignment = { vertical: "middle", horizontal: "right" };
    sheet.getRow(9).height = 22;

    const contactStr = [quote.contactPerson, quote.contactPhone, quote.contactEmail].filter(Boolean).join(" • ");
    sheet.mergeCells("A10:E10");
    const cellContact = sheet.getCell("A10");
    cellContact.value = contactStr ? `Người liên hệ: ${contactStr}` : `Địa chỉ KH: ${quote.customerAddress || "Theo hợp đồng/đơn hàng"}`;
    cellContact.font = { name: "Segoe UI", size: 9.5, color: { argb: "FF475569" } };
    cellContact.alignment = { vertical: "middle", horizontal: "left" };

    sheet.mergeCells("F10:I10");
    const cellRepEmail = sheet.getCell("F10");
    cellRepEmail.value = `Email NVKD: ${repEmail}`;
    cellRepEmail.font = { name: "Segoe UI", size: 9.5, color: { argb: "FF475569" } };
    cellRepEmail.alignment = { vertical: "middle", horizontal: "right" };
    sheet.getRow(10).height = 20;

    // Apply soft border to customer block
    for (let r = 9; r <= 10; r++) {
        for (let c = 1; c <= 9; c++) {
            const cell = sheet.getRow(r).getCell(c);
            cell.fill = clientBoxBg;
        }
    }

    sheet.getRow(11).height = 8; // Spacer

    // ==========================================
    // 4. TABLE HEADER (Row 12)
    // ==========================================
    const tableHeaderRow = sheet.getRow(12);
    tableHeaderRow.height = 30;
    const headers = [
        "STT",
        "Mã sản phẩm",
        "Tên sản phẩm / Hàng hóa",
        "Hãng SX",
        "Quy cách",
        "Số lượng",
        rawVat > 0
            ? (isItemsPricePreVat ? "Đơn giá (chưa VAT)" : "Đơn giá (đã gồm VAT)")
            : "Đơn giá (VNĐ)",
        rawVat > 0
            ? (isItemsPricePreVat ? "Thành tiền (chưa VAT)" : "Thành tiền (đã gồm VAT)")
            : "Thành tiền (VNĐ)",
        "Ghi chú"
    ];

    headers.forEach((h, idx) => {
        const cell = tableHeaderRow.getCell(idx + 1);
        cell.value = h;
        cell.font = { name: "Segoe UI", size: 10, bold: true, color: { argb: "FFFFFFFF" } };
        cell.fill = headerFill;
        cell.alignment = {
            vertical: "middle",
            horizontal: idx === 2 ? "left" : (idx >= 6 && idx <= 7 ? "right" : "center"),
            wrapText: true
        };
        cell.border = thinBorder;
    });

    // ==========================================
    // 5. TABLE BODY (Row 13+)
    // ==========================================
    let currentRowIdx = 13;
    let grandTotal = 0;

    (quote.items || []).forEach((it: any, itemIdx: number) => {
        const itCode = it.productCode || it.product_code || it.sku || it.code || "";
        const prod = allSalesProducts.find(p => p.code === itCode) || biolabProducts.find(p => p.code === itCode);
        const displayCode = it.parentCode || it.parent_code || (prod as any)?.parent_code || (prod as any)?.parent_item_code || itCode || "—";
        const itName = it.productName || it.product_name || it.name || prod?.name || itCode || "Sản phẩm";
        const spec = it.specification || prod?.specification || it.spec || "—";
        const mfg = formatSupplierShortName(it.manufacturer || (prod as any)?.manufacturer || (prod as any)?.brand || "");
        const rawNote = it.notes || it.note || "";
        const note = (rawNote === prod?.notes || rawNote === "Imported from Excel") ? "" : rawNote;
        
        const qty = Number(it.quantity !== undefined ? it.quantity : (it.qty !== undefined ? it.qty : 1)) || 1;
        const price = Number(it.price !== undefined ? it.price : (it.unitPrice !== undefined ? it.unitPrice : 0)) || 0;
        const total = Number(it.total !== undefined ? it.total : (it.amount !== undefined ? it.amount : qty * price)) || (qty * price);
        grandTotal += total;

        const row = sheet.getRow(currentRowIdx);
        row.height = 26;

        // Striping
        const rowBg: ExcelJS.FillPattern = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: itemIdx % 2 === 0 ? "FFFFFFFF" : "FFF8FAFC" }
        };

        // STT
        const cStt = row.getCell(1);
        cStt.value = itemIdx + 1;
        cStt.alignment = { vertical: "middle", horizontal: "center" };
        cStt.font = { name: "Segoe UI", size: 10, bold: true, color: { argb: "FF334155" } };

        // Mã SP
        const cCode = row.getCell(2);
        cCode.value = displayCode;
        cCode.alignment = { vertical: "middle", horizontal: "center" };
        cCode.font = { name: "Consolas", size: 10, bold: true, color: { argb: "FF1E3A8A" } };

        // Tên SP
        const cName = row.getCell(3);
        cName.value = itName;
        cName.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
        cName.font = { name: "Segoe UI", size: 10, bold: true, color: { argb: "FF0F172A" } };

        // Hãng SX (Tên viết tắt)
        const cMfg = row.getCell(4);
        cMfg.value = mfg;
        cMfg.alignment = { vertical: "middle", horizontal: "center" };
        cMfg.font = { name: "Segoe UI", size: 10, bold: true, color: { argb: "FF1E40AF" } };

        // Quy cách
        const cSpec = row.getCell(5);
        cSpec.value = spec;
        cSpec.alignment = { vertical: "middle", horizontal: "center" };
        cSpec.font = { name: "Segoe UI", size: 9.5, color: { argb: "FF475569" } };

        // SL
        const cQty = row.getCell(6);
        cQty.value = qty;
        cQty.numFmt = "#,##0";
        cQty.alignment = { vertical: "middle", horizontal: "center" };
        cQty.font = { name: "Segoe UI", size: 10, bold: true, color: { argb: "FF0F172A" } };

        // Đơn giá
        const cPrice = row.getCell(7);
        cPrice.value = price;
        cPrice.numFmt = "#,##0";
        cPrice.alignment = { vertical: "middle", horizontal: "right" };
        cPrice.font = { name: "Segoe UI", size: 10, color: { argb: "FF0F172A" } };

        // Thành tiền
        const cTotal = row.getCell(8);
        cTotal.value = total;
        cTotal.numFmt = "#,##0";
        cTotal.alignment = { vertical: "middle", horizontal: "right" };
        cTotal.font = { name: "Segoe UI", size: 10, bold: true, color: { argb: "FF1E3A8A" } };

        // Ghi chú
        const rawRate = it.vatRate !== undefined ? it.vatRate :
            (it.vat_rate !== undefined ? it.vat_rate :
            (it.taxRate !== undefined ? it.taxRate :
            (it.tax_rate !== undefined ? it.tax_rate :
            (quote.taxRate !== undefined ? quote.taxRate :
            (quote.tax_rate !== undefined ? quote.tax_rate : 8)))));
        const itemVatRate = !isNaN(Number(rawRate)) && Number(rawRate) >= 0 ? Number(rawRate) : 8;
        const vatBadge = hasMultipleVatRates ? `VAT ${itemVatRate}%` : "";
        const displayNote = note ? (note.toLowerCase().includes("vat") ? note : `${note}${vatBadge ? ` (${vatBadge})` : ""}`) : vatBadge;

        const cNote = row.getCell(9);
        cNote.value = displayNote;
        cNote.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
        cNote.font = { name: "Segoe UI", size: 9.5, italic: true, color: { argb: "FF64748B" } };

        for (let c = 1; c <= 9; c++) {
            const cell = row.getCell(c);
            cell.border = thinBorder;
            cell.fill = rowBg;
        }

        currentRowIdx++;

        // Configurations / Options
        const validConfigs = (it.configurations || []).filter((c: any) => c.isIncluded !== false);
        if (validConfigs.length > 0) {
            validConfigs.forEach((cfg: any, cIdx: number) => {
                const cfgRow = sheet.getRow(currentRowIdx);
                cfgRow.height = 22;

                const cfgBg: ExcelJS.FillPattern = {
                    type: "pattern",
                    pattern: "solid",
                    fgColor: { argb: "FFF1F5F9" }
                };

                // STT
                const cSubStt = cfgRow.getCell(1);
                cSubStt.value = `${itemIdx + 1}.${cIdx + 1}`;
                cSubStt.alignment = { vertical: "middle", horizontal: "center" };
                cSubStt.font = { name: "Segoe UI", size: 9, color: { argb: "FF64748B" } };

                // Model / Code
                const cSubCode = cfgRow.getCell(2);
                cSubCode.value = cfg.model || "";
                cSubCode.alignment = { vertical: "middle", horizontal: "center" };
                cSubCode.font = { name: "Consolas", size: 9, color: { argb: "FF64748B" } };

                // Tên cấu hình
                const cSubName = cfgRow.getCell(3);
                cSubName.value = `    ↳ [Cấu hình] ${cfg.name}`;
                cSubName.alignment = { vertical: "middle", horizontal: "left" };
                cSubName.font = { name: "Segoe UI", size: 9.5, italic: true, color: { argb: "FF334155" } };

                // Hãng / Xuất xứ
                const cSubMfg = cfgRow.getCell(4);
                cSubMfg.value = formatSupplierShortName(cfg.origin || mfg);
                cSubMfg.alignment = { vertical: "middle", horizontal: "center" };
                cSubMfg.font = { name: "Segoe UI", size: 9, color: { argb: "FF475569" } };

                // ĐVT
                const cSubUnit = cfgRow.getCell(5);
                cSubUnit.value = cfg.unit || "Bộ";
                cSubUnit.alignment = { vertical: "middle", horizontal: "center" };
                cSubUnit.font = { name: "Segoe UI", size: 9, color: { argb: "FF64748B" } };

                // SL
                const cSubQty = cfgRow.getCell(6);
                cSubQty.value = cfg.quantity || 1;
                cSubQty.numFmt = "#,##0";
                cSubQty.alignment = { vertical: "middle", horizontal: "center" };
                cSubQty.font = { name: "Segoe UI", size: 9, color: { argb: "FF64748B" } };

                // Đơn giá
                const cSubPrice = cfgRow.getCell(7);
                cSubPrice.value = "Đã bao gồm";
                cSubPrice.alignment = { vertical: "middle", horizontal: "center" };
                cSubPrice.font = { name: "Segoe UI", size: 9, italic: true, color: { argb: "FF64748B" } };

                // Thành tiền
                const cSubTotal = cfgRow.getCell(8);
                cSubTotal.value = "Đã bao gồm";
                cSubTotal.alignment = { vertical: "middle", horizontal: "center" };
                cSubTotal.font = { name: "Segoe UI", size: 9, italic: true, color: { argb: "FF64748B" } };

                // Ghi chú
                const cSubNote = cfgRow.getCell(9);
                cSubNote.value = cfg.notes || (cfg.isStandard ? "Tiêu chuẩn theo máy" : "Tùy chọn kèm theo");
                cSubNote.alignment = { vertical: "middle", horizontal: "left" };
                cSubNote.font = { name: "Segoe UI", size: 9, italic: true, color: { argb: "FF94A3B8" } };

                for (let c = 1; c <= 9; c++) {
                    const cell = cfgRow.getCell(c);
                    cell.border = thinBorder;
                    cell.fill = cfgBg;
                }

                currentRowIdx++;
            });
        }
    });

    // ==========================================
    // 6. TOTAL AMOUNT & FINANCIAL BREAKDOWN
    // ==========================================
    if (rawDiscount > 0 || effectiveTotalVat > 0) {
        // Row: Cộng tiền hàng (chưa VAT)
        sheet.mergeCells(`A${currentRowIdx}:G${currentRowIdx}`);
        const cSubLabel = sheet.getCell(`A${currentRowIdx}`);
        cSubLabel.value = "Cộng tiền hàng (chưa VAT):";
        cSubLabel.font = { name: "Segoe UI", size: 10, color: { argb: "FF475569" } };
        cSubLabel.alignment = { vertical: "middle", horizontal: "right" };

        const cSubVal = sheet.getCell(`H${currentRowIdx}`);
        cSubVal.value = rawSubtotal;
        cSubVal.numFmt = "#,##0";
        cSubVal.font = { name: "Segoe UI", size: 10, color: { argb: "FF475569" } };
        cSubVal.alignment = { vertical: "middle", horizontal: "right" };
        sheet.getRow(currentRowIdx).height = 24;

        for (let c = 1; c <= 9; c++) {
            const cell = sheet.getRow(currentRowIdx).getCell(c);
            cell.border = thinBorder;
        }
        currentRowIdx++;

        // Row: Chiết khấu (nếu có)
        if (rawDiscount > 0) {
            sheet.mergeCells(`A${currentRowIdx}:G${currentRowIdx}`);
            const cDiscLabel = sheet.getCell(`A${currentRowIdx}`);
            cDiscLabel.value = `Chiết khấu (${quote.discountRate || quote.discount_rate || 0}%):`;
            cDiscLabel.font = { name: "Segoe UI", size: 10, color: { argb: "FFDC2626" } };
            cDiscLabel.alignment = { vertical: "middle", horizontal: "right" };

            const cDiscVal = sheet.getCell(`H${currentRowIdx}`);
            cDiscVal.value = -rawDiscount;
            cDiscVal.numFmt = "#,##0";
            cDiscVal.font = { name: "Segoe UI", size: 10, bold: true, color: { argb: "FFDC2626" } };
            cDiscVal.alignment = { vertical: "middle", horizontal: "right" };
            sheet.getRow(currentRowIdx).height = 24;

            for (let c = 1; c <= 9; c++) {
                const cell = sheet.getRow(currentRowIdx).getCell(c);
                cell.border = thinBorder;
            }
            currentRowIdx++;
        }

        // Row: Thuế VAT (hỗ trợ nhiều mức thuế suất 5%, 8%, 10%...)
        if (effectiveTotalVat > 0) {
            if (activeVatBuckets.length > 1) {
                // Từng dòng thuế suất tương ứng
                for (const b of activeVatBuckets) {
                    sheet.mergeCells(`A${currentRowIdx}:G${currentRowIdx}`);
                    const cVatLabel = sheet.getCell(`A${currentRowIdx}`);
                    cVatLabel.value = `Thuế VAT (${b.rate}%):`;
                    cVatLabel.font = { name: "Segoe UI", size: 10, color: { argb: "FF475569" } };
                    cVatLabel.alignment = { vertical: "middle", horizontal: "right" };

                    const cVatVal = sheet.getCell(`H${currentRowIdx}`);
                    cVatVal.value = b.vatAmount;
                    cVatVal.numFmt = "#,##0";
                    cVatVal.font = { name: "Segoe UI", size: 10, color: { argb: "FF475569" } };
                    cVatVal.alignment = { vertical: "middle", horizontal: "right" };
                    sheet.getRow(currentRowIdx).height = 24;

                    for (let c = 1; c <= 9; c++) {
                        const cell = sheet.getRow(currentRowIdx).getCell(c);
                        cell.border = thinBorder;
                    }
                    currentRowIdx++;
                }

                // Dòng tổng tiền thuế VAT khi có nhiều mức thuế
                sheet.mergeCells(`A${currentRowIdx}:G${currentRowIdx}`);
                const cTotalVatLabel = sheet.getCell(`A${currentRowIdx}`);
                cTotalVatLabel.value = "Tổng tiền thuế VAT:";
                cTotalVatLabel.font = { name: "Segoe UI", size: 10, bold: true, color: { argb: "FF475569" } };
                cTotalVatLabel.alignment = { vertical: "middle", horizontal: "right" };

                const cTotalVatVal = sheet.getCell(`H${currentRowIdx}`);
                cTotalVatVal.value = effectiveTotalVat;
                cTotalVatVal.numFmt = "#,##0";
                cTotalVatVal.font = { name: "Segoe UI", size: 10, bold: true, color: { argb: "FF475569" } };
                cTotalVatVal.alignment = { vertical: "middle", horizontal: "right" };
                sheet.getRow(currentRowIdx).height = 24;

                for (let c = 1; c <= 9; c++) {
                    const cell = sheet.getRow(currentRowIdx).getCell(c);
                    cell.border = thinBorder;
                }
                currentRowIdx++;
            } else {
                const singleRate = activeVatBuckets.length === 1 ? activeVatBuckets[0].rate : taxRateVal;
                sheet.mergeCells(`A${currentRowIdx}:G${currentRowIdx}`);
                const cVatLabel = sheet.getCell(`A${currentRowIdx}`);
                cVatLabel.value = `Thuế VAT (${singleRate}%):`;
                cVatLabel.font = { name: "Segoe UI", size: 10, color: { argb: "FF475569" } };
                cVatLabel.alignment = { vertical: "middle", horizontal: "right" };

                const cVatVal = sheet.getCell(`H${currentRowIdx}`);
                cVatVal.value = effectiveTotalVat;
                cVatVal.numFmt = "#,##0";
                cVatVal.font = { name: "Segoe UI", size: 10, color: { argb: "FF475569" } };
                cVatVal.alignment = { vertical: "middle", horizontal: "right" };
                sheet.getRow(currentRowIdx).height = 24;

                for (let c = 1; c <= 9; c++) {
                    const cell = sheet.getRow(currentRowIdx).getCell(c);
                    cell.border = thinBorder;
                }
                currentRowIdx++;
            }
        }
    }

    // Row: TỔNG CỘNG THANH TOÁN (ĐÃ BAO GỒM VAT)
    sheet.mergeCells(`A${currentRowIdx}:G${currentRowIdx}`);
    const cellTotalLabel = sheet.getCell(`A${currentRowIdx}`);
    cellTotalLabel.value = "TỔNG CỘNG THANH TOÁN (ĐÃ BAO GỒM VAT):";
    cellTotalLabel.font = { name: "Segoe UI", size: 10.5, bold: true, color: { argb: "FF1E3A8A" } };
    cellTotalLabel.alignment = { vertical: "middle", horizontal: "right" };

    const cellTotalVal = sheet.getCell(`H${currentRowIdx}`);
    cellTotalVal.value = finalTotalAmountVal;
    cellTotalVal.numFmt = "#,##0";
    cellTotalVal.font = { name: "Segoe UI", size: 12, bold: true, color: { argb: "FF1E3A8A" } };
    cellTotalVal.alignment = { vertical: "middle", horizontal: "right" };

    const totalRow = sheet.getRow(currentRowIdx);
    totalRow.height = 30;

    const totalFill: ExcelJS.FillPattern = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFF1F5F9" }
    };

    for (let c = 1; c <= 9; c++) {
        const cell = totalRow.getCell(c);
        cell.fill = totalFill;
        cell.border = {
            top: { style: "medium", color: { argb: "FF1E3A8A" } },
            bottom: { style: "double", color: { argb: "FF1E3A8A" } },
            left: c === 1 ? { style: "thin", color: { argb: "FFCBD5E1" } } : undefined,
            right: c === 9 ? { style: "thin", color: { argb: "FFCBD5E1" } } : undefined,
        };
    }

    currentRowIdx++;

    // Amount in words
    sheet.mergeCells(`A${currentRowIdx}:I${currentRowIdx}`);
    const cellWords = sheet.getCell(`A${currentRowIdx}`);
    const wordsFn = readVietnameseCurrency || internalReadVietnameseCurrency;
    const wordsText = wordsFn(finalTotalAmountVal);
    cellWords.value = `Số tiền bằng chữ: ${wordsText ? wordsText.charAt(0).toUpperCase() + wordsText.slice(1) : ""}.`;
    cellWords.font = { name: "Segoe UI", size: 10, italic: true, bold: true, color: { argb: "FF0F172A" } };
    cellWords.alignment = { vertical: "middle", horizontal: "left" };
    sheet.getRow(currentRowIdx).height = 24;

    currentRowIdx += 2; // Spacing

    // ==========================================
    // 7. TERMS & CONDITIONS
    // ==========================================
    sheet.mergeCells(`A${currentRowIdx}:I${currentRowIdx}`);
    const cellTermsTitle = sheet.getCell(`A${currentRowIdx}`);
    cellTermsTitle.value = "ĐIỀU KHOẢN THƯƠNG MẠI & DỊCH VỤ:";
    cellTermsTitle.font = { name: "Segoe UI", size: 10.5, bold: true, color: { argb: "FF1E3A8A" } };
    cellTermsTitle.alignment = { vertical: "middle", horizontal: "left" };
    sheet.getRow(currentRowIdx).height = 22;
    currentRowIdx++;

    const defaultValidity = "Báo giá có hiệu lực trong vòng 30 ngày kể từ ngày ban hành.";
    const defaultDelivery = "Giao hàng tận nơi trong vòng 3-5 ngày làm việc kể từ khi xác nhận đơn hàng/hợp đồng.";
    const defaultPayment = "Thanh toán 100% bằng chuyển khoản trong vòng 15-30 ngày kể từ ngày nhận đủ hàng hóa và hóa đơn GTGT.";
    const defaultNote = isItemsPricePreVat
        ? "Đơn giá chưa bao gồm thuế Giá Trị Gia Tăng (VAT). Chi phí vận chuyển, hướng dẫn sử dụng theo thỏa thuận."
        : "Đơn giá đã bao gồm thuế Giá Trị Gia Tăng (VAT) và chi phí vận chuyển, hướng dẫn sử dụng tại cơ sở.";

    const resolvedValidity = quote.validityTerms !== undefined && quote.validityTerms !== null ? String(quote.validityTerms).trim() : defaultValidity;
    const resolvedDelivery = quote.deliveryTerms !== undefined && quote.deliveryTerms !== null ? String(quote.deliveryTerms).trim() : defaultDelivery;
    const resolvedPayment = quote.paymentTerms !== undefined && quote.paymentTerms !== null ? String(quote.paymentTerms).trim() : defaultPayment;
    const resolvedNote = quote.noteTerms !== undefined && quote.noteTerms !== null ? String(quote.noteTerms).trim() : defaultNote;

    const rawTermEntries: string[] = [];
    if (resolvedValidity) rawTermEntries.push(`Hiệu lực báo giá: ${resolvedValidity}`);
    if (resolvedDelivery) rawTermEntries.push(`Thời gian & địa điểm giao hàng: ${resolvedDelivery}`);
    if (resolvedPayment) rawTermEntries.push(`Phương thức thanh toán: ${resolvedPayment}`);
    if (resolvedNote) rawTermEntries.push(`Ghi chú & cam kết: ${resolvedNote}`);
    const terms: string[] = rawTermEntries.map((entry, idx) => `${idx + 1}. ${entry}`);

    terms.forEach((t) => {
        sheet.mergeCells(`A${currentRowIdx}:I${currentRowIdx}`);
        const cTerm = sheet.getCell(`A${currentRowIdx}`);
        cTerm.value = t;
        cTerm.font = { name: "Segoe UI", size: 9.5, color: { argb: "FF334155" } };
        cTerm.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
        sheet.getRow(currentRowIdx).height = t.length > 115 ? 34 : 20;
        currentRowIdx++;
    });

    currentRowIdx++; // Spacing

    // ==========================================
    // 8. SIGNATURE BLOCK
    // ==========================================
    sheet.mergeCells(`A${currentRowIdx}:I${currentRowIdx}`);
    const cellThanks = sheet.getCell(`A${currentRowIdx}`);
    cellThanks.value = "Trân trọng cảm ơn sự tin tưởng và hợp tác của Quý khách hàng!";
    cellThanks.font = { name: "Segoe UI", size: 10, italic: true, bold: true, color: { argb: "FF1E3A8A" } };
    cellThanks.alignment = { vertical: "middle", horizontal: "center" };
    sheet.getRow(currentRowIdx).height = 22;
    currentRowIdx += 2;

    // 2-column signature
    sheet.mergeCells(`B${currentRowIdx}:D${currentRowIdx}`);
    const cellSignClient = sheet.getCell(`B${currentRowIdx}`);
    cellSignClient.value = "ĐẠI DIỆN KHÁCH HÀNG";
    cellSignClient.font = { name: "Segoe UI", size: 10.5, bold: true, color: { argb: "FF0F172A" } };
    cellSignClient.alignment = { vertical: "middle", horizontal: "center" };

    sheet.mergeCells(`G${currentRowIdx}:H${currentRowIdx}`);
    const cellSignComp = sheet.getCell(`G${currentRowIdx}`);
    cellSignComp.value = "ĐẠI DIỆN CÔNG TY BÁO GIÁ";
    cellSignComp.font = { name: "Segoe UI", size: 10.5, bold: true, color: { argb: "FF1E3A8A" } };
    cellSignComp.alignment = { vertical: "middle", horizontal: "center" };
    sheet.getRow(currentRowIdx).height = 22;
    currentRowIdx++;

    sheet.mergeCells(`B${currentRowIdx}:D${currentRowIdx}`);
    const cellSignClientNote = sheet.getCell(`B${currentRowIdx}`);
    cellSignClientNote.value = "(Ký, ghi rõ họ tên và đóng dấu)";
    cellSignClientNote.font = { name: "Segoe UI", size: 9, italic: true, color: { argb: "FF64748B" } };
    cellSignClientNote.alignment = { vertical: "middle", horizontal: "center" };

    sheet.mergeCells(`G${currentRowIdx}:H${currentRowIdx}`);
    const cellSignCompNote = sheet.getCell(`G${currentRowIdx}`);
    cellSignCompNote.value = "(Người lập báo giá / NVKD)";
    cellSignCompNote.font = { name: "Segoe UI", size: 9, italic: true, color: { argb: "FF64748B" } };
    cellSignCompNote.alignment = { vertical: "middle", horizontal: "center" };
    sheet.getRow(currentRowIdx).height = 18;

    currentRowIdx += 4; // Space for signature / seal

    sheet.mergeCells(`G${currentRowIdx}:H${currentRowIdx}`);
    const cellRepSignName = sheet.getCell(`G${currentRowIdx}`);
    cellRepSignName.value = cleanRepName;
    cellRepSignName.font = { name: "Segoe UI", size: 10.5, bold: true, color: { argb: "FF0F172A" } };
    cellRepSignName.alignment = { vertical: "middle", horizontal: "center" };
    sheet.getRow(currentRowIdx).height = 22;

    // Generate buffer & trigger download in browser
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const cleanCustName = (quote.customerName || "Khach_hang").replace(/[^a-zA-Z0-9_\u00C0-\u1EF9]/g, "_").slice(0, 30);
    a.download = `Bao_gia_${quote.id || "Quote"}_${cleanCustName}.xlsx`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
    }, 1000);
}

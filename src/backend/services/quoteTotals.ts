/**
 * Tổng tiền báo giá tính từ các dòng hàng — cùng công thức với màn hình báo giá (computeQuoteItemFinances):
 * - Giá báo khách là giá SAU VAT: thành tiền dòng = SL × giá sau VAT.
 * - Thành tiền trước VAT = thành tiền dòng / (1 + VAT%), làm tròn theo từng dòng.
 * - Chiết khấu dòng chỉ để nội bộ nắm (tính trên giá trước VAT), KHÔNG trừ vào tổng báo khách.
 */
export interface QuoteTotals {
  total: number;       // tổng sau VAT (báo khách) = total_amount
  subtotal: number;    // tổng trước VAT = subtotal
  tax: number;         // tiền VAT = tax_amount
  discount: number;    // chiết khấu nội bộ = discount_amount
}

export function quoteTotalsFromItems(items: any[], defaultVat = 8): QuoteTotals {
  let total = 0;
  let subtotal = 0;
  let discount = 0;
  for (const it of Array.isArray(items) ? items : []) {
    const q = Number(it?.quantity ?? it?.qty ?? 0) || 0;
    const p = Number(it?.price ?? it?.unitPrice ?? it?.unit_price ?? 0) || 0;
    const rawVat = it?.vatRate ?? it?.vat_rate ?? it?.taxRate ?? it?.tax_rate;
    const vat = rawVat !== undefined && rawVat !== null && rawVat !== "" && !isNaN(Number(rawVat)) ? Number(rawVat) : defaultVat;
    const lineTotal = q * p;
    const lineBefore = vat > 0 ? Math.round(lineTotal / (1 + vat / 100)) : lineTotal;
    const dr = Number(it?.discountRate ?? it?.discount_rate ?? it?.discountPercent ?? 0) || 0;
    total += lineTotal;
    subtotal += lineBefore;
    discount += Math.round(lineBefore * (dr / 100));
  }
  total = Math.round(total);
  return { total, subtotal, tax: total - subtotal, discount };
}

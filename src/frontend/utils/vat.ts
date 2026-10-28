/** Thuế suất GTGT mặc định khi một dòng hàng chưa khai báo thuế suất */
export const DEFAULT_VAT_RATE = 8;

const lineVat = (it: any): number => {
  const raw = it?.vatRate ?? it?.vat_rate ?? it?.vat;
  const n = Number(raw);
  return raw !== undefined && raw !== null && raw !== "" && Number.isFinite(n) && n >= 0 ? n : DEFAULT_VAT_RATE;
};

/**
 * Tiền trước thuế của một chứng từ có tổng đã gồm VAT.
 * Tính theo thuế suất của TỪNG dòng hàng (5%, 8%, 10%...) rồi phân bổ theo tổng thực tế (đã trừ chiết khấu);
 * chỉ khi không có dòng hàng mới dùng thuế suất mặc định.
 */
export function preVatAmount(totalAfterVat: number, items?: any[]): number {
  const total = Number(totalAfterVat) || 0;
  const lines = Array.isArray(items) ? items.filter(it => it && it.status !== "CANCELLED") : [];
  let gross = 0;
  let net = 0;
  for (const it of lines) {
    const qty = Number(it.quantity ?? it.qty ?? 0) || 0;
    const price = Number(it.unitPrice ?? it.price ?? it.unit_price ?? 0) || 0;
    const lineGross = Number(it.totalPrice ?? it.total_price) || qty * price;
    gross += lineGross;
    net += lineGross / (1 + lineVat(it) / 100);
  }
  if (gross > 0) return Math.round(total * (net / gross));
  return Math.round(total / (1 + DEFAULT_VAT_RATE / 100));
}

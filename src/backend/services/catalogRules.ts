import { isDetailedOligoSkuCode } from "@/shared/oligoCatalog";

/** 7 mã Oligo/đặt riêng tự tạo trước đây — đã thay thế bằng danh mục 130 mã Oligo chi tiết. */
export const LEGACY_DEMO_OLIGO_CODES = [
  "OLIGO-PRIMER",
  "OLIGO-PROBE",
  "OLIGO-BASE",
  "OLIGO-MOD",
  "OLIGO-PUR",
  "OLIGO-SVC",
  "CUSTOM-ORDER",
] as const;

const LEGACY_DEMO_OLIGO_SET = new Set<string>(LEGACY_DEMO_OLIGO_CODES);

export function isLegacyDemoOligoCode(code?: string | null): boolean {
  if (!code) return false;
  return LEGACY_DEMO_OLIGO_SET.has(String(code).trim().toUpperCase());
}

/**
 * Kiểm tra mặt hàng thuộc danh mục Oligo đặt tổng hợp theo trình tự (Make-to-Order):
 * giữ nguyên giá bán trong Kinh doanh nhưng không sinh tồn kho ảo hay cảnh báo thiếu tồn ở Kho.
 */
export function isOligoMtoProduct(item?: {
  code?: string | null;
  product_code?: string | null;
  name?: string | null;
  product_name?: string | null;
  category?: string | null;
} | null): boolean {
  if (!item) return false;
  const cUp = String(item.code ?? item.product_code ?? "").trim().toUpperCase();
  if (isDetailedOligoSkuCode(cUp) || cUp.startsWith("OLIGO-")) {
    return true;
  }
  const catLow = normalizeVnCategoryText(item.category ?? "").toLowerCase();
  return catLow === "oligo";
}

/** Trạng thái sản phẩm chưa mở bán thương mại chính thức (không cảnh báo thiếu giá). */
export function isNonPricedPipelineStatus(statusText?: string | null): boolean {
  if (!statusText) return false;
  return /coming soon|đang chuyển giao|đang nghiên cứu/i.test(String(statusText));
}

/** Chuẩn hóa chính tả tiếng Việt cho tên phân loại (đồng nhất oá/óa, uý/úy, Kít/Kit, NFC). */
export function normalizeVnCategoryText(raw?: string | null): string {
  if (!raw) return "";
  let s = String(raw).normalize("NFC").trim();
  const repls: Array<[string, string]> = [
    ["Hoá", "Hóa"], ["hoá", "hóa"], ["HOÁ", "HÓA"],
    ["oá", "óa"], ["oà", "òa"], ["oả", "ỏa"], ["oã", "õa"], ["oạ", "ọa"],
    ["OÁ", "ÓA"], ["OÀ", "ÒA"], ["OẢ", "ỎA"], ["OÃ", "ÕA"], ["OẠ", "ỌA"],
    ["uý", "úy"], ["uỳ", "ùy"], ["uỷ", "ủy"], ["uỹ", "ũy"], ["uỵ", "ụy"],
    ["UÝ", "ÚY"], ["UỲ", "ÙY"], ["UỶ", "ỦY"], ["UỸ", "ŨY"], ["UỴ", "ỤY"],
    ["Kít ", "Kit "], ["kít ", "kit "],
  ];
  for (const [a, b] of repls) {
    s = s.split(a).join(b);
  }
  return s.replace(/\s+/g, " ");
}

/**
 * Kiểm tra mặt hàng có phải là Dịch vụ (sửa chữa, bảo trì, hiệu chuẩn, lắp đặt...) hay không.
 * Mặt hàng dịch vụ chỉ phát sinh khi có dịch vụ/sửa chữa, KHÔNG có số lượng tồn kho trong kho.
 */
export function isServiceProduct(item?: {
  code?: string | null;
  product_code?: string | null;
  name?: string | null;
  product_name?: string | null;
  category?: string | null;
  unit?: string | null;
} | null): boolean {
  if (!item) return false;
  const cUp = String(item.code ?? item.product_code ?? "").trim().toUpperCase();
  const nLow = normalizeVnCategoryText(item.name ?? item.product_name ?? "").toLowerCase();
  const catLow = normalizeVnCategoryText(item.category ?? "").toLowerCase();
  if (cUp === "DVSC" || cUp.startsWith("DV-") || cUp.startsWith("DV_") || cUp.startsWith("SVC-") || cUp === "OLIGO-SVC") {
    return true;
  }
  if (catLow.includes("dịch vụ")) {
    return true;
  }
  if (
    nLow.startsWith("dịch vụ") ||
    nLow.startsWith("sửa chữa") ||
    nLow.startsWith("phí dịch vụ") ||
    nLow.startsWith("phí sửa chữa") ||
    nLow.startsWith("phí bảo trì") ||
    nLow.startsWith("phí hiệu chuẩn") ||
    nLow.includes("dịch vụ sửa chữa") ||
    nLow.includes("dịch vụ bảo trì") ||
    nLow.includes("dịch vụ bảo dưỡng") ||
    nLow.includes("dịch vụ hiệu chuẩn") ||
    nLow.includes("dịch vụ kiểm định")
  ) {
    return true;
  }
  return false;
}

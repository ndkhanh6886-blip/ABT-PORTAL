/**
 * Dạng đóng gói của kit có phụ kiện (vd kit PCR): cùng một mã hàng, cùng giá, có 2 dạng:
 *  - "PREALIQUOT": chia sẵn vào tube PCR, KHÔNG kèm phụ kiện. Số lô có ký hiệu ".C" (vd 200635.C324800.IC).
 *  - "WITH_ACCESSORIES": không chia sẵn, kèm phụ kiện theo định mức (BOM). Số lô không có ".C".
 * Chỉ áp dụng cho mã hàng có khai báo phụ kiện; mã không có phụ kiện không phân dạng.
 */
export type PackagingForm = "PREALIQUOT" | "WITH_ACCESSORIES";

export const PACKAGING_LABEL: Record<PackagingForm, string> = {
  PREALIQUOT: "Chia sẵn tube",
  WITH_ACCESSORIES: "Kèm phụ kiện",
};

/** Dạng đóng gói suy ra từ số lô (".C" = chia sẵn tube). Lô trống: không xác định. */
export function packagingFormOfLot(lot: any): PackagingForm | null {
  const s = String(lot ?? "").trim().toUpperCase();
  if (!s) return null;
  return /\.C/.test(s) ? "PREALIQUOT" : "WITH_ACCESSORIES";
}

export function normalizePackagingForm(v: any): PackagingForm | null {
  const s = String(v ?? "").trim().toUpperCase();
  return s === "PREALIQUOT" || s === "WITH_ACCESSORIES" ? (s as PackagingForm) : null;
}

/** Thẻ ghi trong ô Ghi chú của dòng SO, vd "[Dạng: Chia sẵn tube]". */
export const packagingNoteTag = (f: PackagingForm) => `[Dạng: ${PACKAGING_LABEL[f]}]`;

/** Đặt / bỏ thẻ dạng đóng gói ở đầu ghi chú, giữ nguyên phần ghi chú người dùng gõ. */
export function withPackagingNote(notes: any, f: PackagingForm | null): string {
  const rest = String(notes ?? "").replace(/^\s*\[Dạng:[^\]]*\]\s*/u, "");
  return f ? `${packagingNoteTag(f)}${rest ? " " + rest : ""}` : rest;
}

/**
 * "Phong tỏa liên hoàn" khóa lô (ON_HOLD), tạm giữ lệnh sản xuất đang dùng lô và mở Sai lệch CRITICAL + NCR:
 * gỡ ra cần QA duyệt và đóng NCR / sai lệch. Vì vậy bắt người bấm nhập lý do thật (không dùng câu mặc định)
 * — để trống hoặc bấm Hủy thì không làm gì.
 */
export const CASCADE_REASON_MIN = 10;

export function askCascadeQuarantineReason(
  lotCode: string,
  ask: (message: string) => string | null = (m) => window.prompt(m),
  warn: (message: string) => void = (m) => window.alert(m)
): string | null {
  const answer = ask(
    `⚠️ PHONG TỎA LIÊN HOÀN lô ${lotCode}\n\n` +
      `Thao tác này sẽ:\n` +
      `• Khóa lô ${lotCode} và mọi lô thành phẩm/bán thành phẩm làm từ lô này (ON_HOLD) — không xuất/nhập kho, không giải phóng được;\n` +
      `• Tạm giữ lệnh sản xuất đang dùng các lô này;\n` +
      `• Mở Sai lệch mức CRITICAL + NCR. Muốn gỡ phải qua QA (và BGĐ nếu chấp nhận đặc cách), ghi nguyên nhân gốc, CAPA rồi đóng NCR.\n\n` +
      `Chỉ dùng khi có nghi ngờ chất lượng thật. Nếu chỉ muốn XEM phả hệ, bấm Hủy và dùng nút "Truy xuất ngay".\n\n` +
      `Nhập lý do phong tỏa (ít nhất ${CASCADE_REASON_MIN} ký tự):`
  );
  const reason = (answer ?? "").trim();
  if (answer === null) return null; // bấm Hủy
  if (reason.length < CASCADE_REASON_MIN) {
    warn(`Chưa phong tỏa: lý do phải có ít nhất ${CASCADE_REASON_MIN} ký tự.`);
    return null;
  }
  return reason;
}

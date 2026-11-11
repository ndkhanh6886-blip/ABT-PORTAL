/**
 * Đơn "phục hồi tự động từ thông báo trình duyệt" (cơ chế đã gỡ bỏ): đơn được dựng lại từ nội dung thông báo, thông báo
 * không có ngày nghỉ nên ngày nghỉ bị gán bằng NGÀY DỰNG LẠI (vd cả 6 đơn DXNP thành nghỉ 11/11, "Đang nghỉ hôm nay"),
 * loại nghỉ / số ngày / người bàn giao là giá trị điền cứng.
 * Các đơn này được giữ lại (mã đơn, người xin, thời điểm gửi là thật) nhưng xóa ngày nghỉ giả, đánh dấu cần bổ sung
 * và không tính vào bảng chấm công cho tới khi người xin nghỉ / người duyệt nhập lại đúng ngày.
 */
export const RECOVERED_MARK = "(Phục hồi tự động từ thông báo trình duyệt)";
export const NEEDS_DATES_NOTE = "⚠ Đơn phục hồi từ thông báo, THIẾU NGÀY NGHỈ thật — người xin nghỉ cần bổ sung ngày nghỉ.";

export function isRecoveredProposal(p: any): boolean {
  if (!p || typeof p !== "object") return false;
  return String(p.id || "").startsWith("prop-rec-") || String(p.summaryReason || "").includes(RECOVERED_MARK);
}

/** Đơn nghỉ phục hồi còn chưa được bổ sung ngày nghỉ thật. */
export function needsLeaveDates(p: any): boolean {
  return Boolean(p?.needsLeaveDates) && !String(p?.formValues?.fromDate || "").trim();
}

/**
 * Xóa ngày nghỉ giả của đơn nghỉ phục hồi (chỉ làm một lần: đơn đã được bổ sung ngày — có fromDate và đã bỏ cờ —
 * thì giữ nguyên). Đơn không phải đơn phục hồi: trả về y nguyên.
 */
export function sanitizeRecoveredProposal<T extends Record<string, any>>(p: T): T {
  if (!isRecoveredProposal(p)) return p;
  const isLeave = String(p.proposalCode || "").toUpperCase().startsWith("DXNP") || p.templateId === "tmpl_leave_request";
  if (!isLeave) return p;
  if (p.leaveDatesSanitized) return p; // đã xử lý (kể cả khi người dùng đã nhập lại ngày)
  const fv = { ...(p.formValues || {}) };
  fv.fromDate = "";
  fv.toDate = "";
  fv.totalDays = "";
  const reason = String(p.summaryReason || "");
  return {
    ...p,
    formValues: fv,
    neededByDate: "",
    needsLeaveDates: true,
    leaveDatesSanitized: true,
    summaryReason: reason.includes(NEEDS_DATES_NOTE) ? reason : `${NEEDS_DATES_NOTE} ${reason}`.trim(),
  };
}

export function sanitizeProposalList<T extends Record<string, any>>(list: any): T[] {
  return Array.isArray(list) ? list.map((p) => sanitizeRecoveredProposal(p)) : [];
}

/**
 * Đơn nghỉ theo "các ngày cụ thể" (vd thứ 6, thứ 7 hằng tuần trùng lịch học) thay vì một khoảng liên tục.
 * Lưu trong formValues của đơn: leaveMode = "DATES", leaveDates = JSON [{ date: "YYYY-MM-DD", session: "FULL"|"AM"|"PM" }].
 * fromDate / toDate vẫn được ghi (ngày đầu / cuối) để các màn hình cũ hiển thị được; totalDays = tổng các ngày.
 * Đơn cũ (không có leaveMode) vẫn là khoảng liên tục như trước.
 */
export type LeaveSession = "FULL" | "AM" | "PM";
export interface LeaveDay { date: string; session: LeaveSession }

export const SESSION_DAYS: Record<LeaveSession, number> = { FULL: 1, AM: 0.5, PM: 0.5 };
export const SESSION_LABEL: Record<LeaveSession, string> = { FULL: "Cả ngày", AM: "Sáng", PM: "Chiều" };
/** 0 = Chủ nhật … 6 = Thứ 7 (như Date.getUTCDay) */
export const WEEKDAY_LABELS = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];
const MAX_DAYS = 400;

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const toUTC = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
const fromUTC = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function isDatesMode(fv: any): boolean {
  return String(fv?.leaveMode || "") === "DATES";
}

/** Chuẩn hóa: bỏ ngày sai, gộp ngày trùng (giữ buổi sau cùng), sắp xếp tăng dần. */
export function normalizeLeaveDays(days: any): LeaveDay[] {
  const map = new Map<string, LeaveSession>();
  for (const d of Array.isArray(days) ? days : []) {
    const date = String(d?.date || "").slice(0, 10);
    if (!ISO.test(date) || Number.isNaN(toUTC(date))) continue;
    const s = String(d?.session || "FULL").toUpperCase();
    map.set(date, (s === "AM" || s === "PM" ? s : "FULL") as LeaveSession);
  }
  return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0])).map(([date, session]) => ({ date, session }));
}

/** Danh sách ngày nghỉ của đơn kiểu "các ngày cụ thể"; đơn khoảng liên tục: null. */
export function parseLeaveDays(fv: any): LeaveDay[] | null {
  if (!isDatesMode(fv)) return null;
  let raw: any = fv?.leaveDates;
  if (typeof raw === "string") {
    try { raw = JSON.parse(raw); } catch { raw = []; }
  }
  return normalizeLeaveDays(raw);
}

export const serializeLeaveDays = (days: LeaveDay[]) => JSON.stringify(normalizeLeaveDays(days));

/** Các ngày trong [from, to] rơi vào các thứ đã chọn. */
export function expandWeekdays(from: string, to: string, weekdays: number[], session: LeaveSession = "FULL"): LeaveDay[] {
  if (!ISO.test(from) || !ISO.test(to) || to < from || weekdays.length === 0) return [];
  const want = new Set(weekdays);
  const out: LeaveDay[] = [];
  for (let ms = toUTC(from), end = toUTC(to); ms <= end && out.length < MAX_DAYS; ms += 86400000) {
    if (want.has(new Date(ms).getUTCDay())) out.push({ date: fromUTC(ms), session });
  }
  return out;
}

/** Tổng số ngày nghỉ (buổi = 0,5); `month` = "YYYY-MM" thì chỉ tính các ngày trong tháng đó. */
export function sumLeaveDays(days: LeaveDay[], month?: string): number {
  return days.reduce((s, d) => (month && !d.date.startsWith(month) ? s : s + SESSION_DAYS[d.session]), 0);
}

export const isOnLeaveOn = (days: LeaveDay[], iso: string) => days.some((d) => d.date === iso);

/** Vd "T6 13/11 · T7 14/11 (chiều) · …" (rút gọn nếu dài). */
export function formatLeaveDays(days: LeaveDay[], max = 12): string {
  const parts = days.map((d) => {
    const wd = WEEKDAY_LABELS[new Date(toUTC(d.date)).getUTCDay()];
    return `${wd} ${d.date.slice(8, 10)}/${d.date.slice(5, 7)}${d.session === "FULL" ? "" : ` (${SESSION_LABEL[d.session].toLowerCase()})`}`;
  });
  return parts.length > max ? `${parts.slice(0, max).join(" · ")} · … (+${parts.length - max} ngày)` : parts.join(" · ");
}

export const weekdayOf = (iso: string) => (ISO.test(iso) ? new Date(toUTC(iso)).getUTCDay() : -1);

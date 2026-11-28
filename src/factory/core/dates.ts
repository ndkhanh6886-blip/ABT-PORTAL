/** Business date (YYYY-MM-DD) in Asia/Ho_Chi_Minh. Expiry and period rules use this, never the server's UTC date. */
export function vnToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** Adds days to a YYYY-MM-DD date, staying in calendar days. */
export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Cộng số tháng dương lịch vào ngày `YYYY-MM-DD` (VD: NSX `2026-11-25` + `24` tháng = HSD `2028-11-25`,
 * không bị lệch thành `2028-11-14` như khi tính 1 tháng = 30 ngày). Nếu ngày gốc là cuối tháng (VD 31/01 + 1 tháng)
 * thì tự động giữ ở ngày cuối cùng của tháng đích (28/02 hoặc 29/02).
 */
export function addMonths(isoDate: string, months: number): string {
  const clean = String(isoDate || "").slice(0, 10);
  const m = clean.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return clean;
  const year = Number(m[1]);
  const month = Number(m[2]); // 1..12
  const day = Number(m[3]);
  const totalMonths = year * 12 + (month - 1) + Math.round(months);
  const targetYear = Math.floor(totalMonths / 12);
  const targetMonth0 = ((totalMonths % 12) + 12) % 12; // 0..11
  const lastDayOfTargetMonth = new Date(Date.UTC(targetYear, targetMonth0 + 1, 0)).getUTCDate();
  const clampedDay = Math.min(day, lastDayOfTargetMonth);
  const yStr = String(targetYear).padStart(4, "0");
  const mStr = String(targetMonth0 + 1).padStart(2, "0");
  const dStr = String(clampedDay).padStart(2, "0");
  return `${yStr}-${mStr}-${dStr}`;
}

/**
 * Quy đổi `shelf_life_months` hoặc `shelf_life_days` (VD: 365/360 -> 12 tháng, 730/720 -> 24 tháng, 180 -> 6 tháng)
 * sang số tháng dương lịch; trả về `null` nếu hạn dùng ngắn tính theo ngày (< 28 ngày).
 */
export function resolveShelfLifeMonths(opts?: {
  shelfLifeMonths?: number | null;
  shelfLifeDays?: number | null;
}): number | null {
  const rawMonths = Number(opts?.shelfLifeMonths ?? 0);
  if (Number.isFinite(rawMonths) && rawMonths > 0) {
    return Math.round(rawMonths);
  }
  const rawDays = Number(opts?.shelfLifeDays ?? 0);
  if (!Number.isFinite(rawDays) || rawDays <= 0) return null;
  if (rawDays < 28) return null;
  if (rawDays % 30 === 0) return Math.max(1, Math.round(rawDays / 30));
  const approxMonths = Math.max(1, Math.round(rawDays / 30.4375));
  if (Math.abs(rawDays - approxMonths * 30.4375) <= 6 || Math.abs(rawDays - approxMonths * 30) <= 6) {
    return approxMonths;
  }
  return null;
}

/**
 * Tính Hạn sử dụng (HSD) của Thành phẩm / Bán thành phẩm từ Ngày sản xuất (NSX):
 * - Ưu tiên cộng theo tháng dương lịch (`addMonths`, VD: 25/11/2026 + 24 tháng = 25/11/2028).
 * - Chỉ cộng theo ngày (`addDays`) đối với các chế phẩm ngắn ngày (< 28 ngày).
 */
export function computeShelfLifeExpiry(
  mfgDate: string,
  opts?: { shelfLifeMonths?: number | null; shelfLifeDays?: number | null; defaultMonths?: number }
): string {
  const months = resolveShelfLifeMonths(opts);
  if (months && months > 0) {
    return addMonths(mfgDate, months);
  }
  const rawDays = Number(opts?.shelfLifeDays ?? 0);
  if (Number.isFinite(rawDays) && rawDays > 0) {
    return addDays(mfgDate, Math.round(rawDays));
  }
  return addMonths(mfgDate, opts?.defaultMonths ?? 12);
}

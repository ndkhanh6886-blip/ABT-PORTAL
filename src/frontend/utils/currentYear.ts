/**
 * Năm hiện tại theo giờ Việt Nam. Kế hoạch / đánh giá tuần trước đây viết cứng năm 2026,
 * nên từ 01/01/2027 lọc sai tuần (tuần 1/2027 trùng số tuần với tuần 1/2026).
 */
export function currentYearVN(): number {
  try {
    return Number(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric" }).format(new Date()));
  } catch {
    return new Date().getFullYear();
  }
}

export const CURRENT_YEAR_VN = currentYearVN();

/** Kế hoạch thuộc đúng tuần của năm hiện tại (kế hoạch cũ chưa lưu năm được coi là của năm hiện tại). */
export function isPlanInWeek(plan: any, week: number | string, year: number = CURRENT_YEAR_VN): boolean {
  if (!plan) return false;
  const w = plan.week_number ?? plan.week;
  if (Number(w) !== Number(week)) return false;
  return !plan.year || Number(plan.year) === Number(year);
}

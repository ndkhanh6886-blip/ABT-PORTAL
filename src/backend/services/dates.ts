/**
 * Calendar dates in Vietnam time (Asia/Ho_Chi_Minh, UTC+7).
 * `new Date().toISOString().slice(0, 10)` is the UTC date: between 00:00 and 07:00 in Vietnam it is
 * still "yesterday", so orders, deliveries and invoices created early in the morning got the previous
 * day (and payment-term / overdue calculations shifted). Shared by server and browser code.
 */
const VN_TIME_ZONE = "Asia/Ho_Chi_Minh";

const dateFormatter = new Intl.DateTimeFormat("en-CA", { timeZone: VN_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" });
const timeFormatter = new Intl.DateTimeFormat("en-GB", { timeZone: VN_TIME_ZONE, hour: "2-digit", minute: "2-digit", hour12: false });

/** "YYYY-MM-DD" of the given instant in Vietnam time. */
export function toVNDateString(date: Date | number | string = new Date()): string {
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return "";
  return dateFormatter.format(d);
}

/** Today's date in Vietnam ("YYYY-MM-DD"). */
export function todayVN(): string {
  return toVNDateString(new Date());
}

/** "YYYY-MM-DD HH:mm" in Vietnam time (for activity logs). */
export function nowVNDateTime(): string {
  const d = new Date();
  return `${dateFormatter.format(d)} ${timeFormatter.format(d)}`;
}

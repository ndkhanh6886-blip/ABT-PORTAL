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

/**
 * Convert an Excel cell value (Excel serial number like 46063, Date object, "DD/MM/YYYY",
 * "DD.MM.YYYY", "DD-MM-YYYY", "MM/YYYY", "YYYY/MM/DD", or ISO "YYYY-MM-DD") into a valid
 * ISO date string "YYYY-MM-DD". Returns `fallback` when empty or unparseable.
 */
export function normalizeExcelDateToISO(val: unknown, fallback = ""): string {
  if (val === null || val === undefined) return fallback;
  if (val instanceof Date) {
    if (isNaN(val.getTime())) return fallback;
    return toVNDateString(val) || fallback;
  }
  const s = String(val).trim();
  if (!s) return fallback;
  const low = s.toLowerCase();
  if (["n/a", "na", "none", "null", "undefined", "-", "—", "không", "khong", "kxd"].includes(low)) {
    return fallback;
  }

  const clampAndFormat = (year: number, month: number, day: number): string => {
    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return fallback;
    if (year < 1900 || year > 2200) return fallback;
    if (month < 1 || month > 12) return fallback;
    const maxDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const validDay = Math.min(Math.max(1, Math.trunc(day)), maxDay);
    return `${String(year).padStart(4, "0")}-${String(Math.trunc(month)).padStart(2, "0")}-${String(validDay).padStart(2, "0")}`;
  };

  // 1. Excel serial date number (e.g. 46063 -> 2026-02-10; covers years ~1927..2119)
  if (/^\d{4,5}(?:\.\d+)?$/.test(s)) {
    const serial = Number(s);
    if (serial >= 10000 && serial <= 80000) {
      const utcDays = Math.floor(serial - 25569);
      const d = new Date(utcDays * 86400 * 1000);
      if (!isNaN(d.getTime())) {
        return d.toISOString().slice(0, 10);
      }
    }
  }

  // 2. ISO or YYYY/MM/DD or YYYY.MM.DD (with optional time suffix)
  const isoMatch = s.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})(?:[T\s].*)?$/);
  if (isoMatch) {
    const y = Number(isoMatch[1]);
    let m = Number(isoMatch[2]);
    let d = Number(isoMatch[3]);
    if (m > 12 && d >= 1 && d <= 12) {
      [m, d] = [d, m];
    }
    return clampAndFormat(y, m, d);
  }

  // 3. DD/MM/YYYY, DD.MM.YYYY, DD-MM-YYYY (or MM/DD/YYYY if second part > 12)
  const dmyMatch = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})(?:[T\s].*)?$/);
  if (dmyMatch) {
    const p1 = Number(dmyMatch[1]);
    const p2 = Number(dmyMatch[2]);
    const yRaw = Number(dmyMatch[3]);
    const y = yRaw < 100 ? (yRaw >= 70 ? 1900 + yRaw : 2000 + yRaw) : yRaw;
    let d = p1;
    let m = p2;
    if (m > 12 && d >= 1 && d <= 12) {
      [d, m] = [p2, p1];
    }
    return clampAndFormat(y, m, d);
  }

  // 4. MM/YYYY, MM-YYYY, MM.YYYY (common expiry format -> last day of month)
  const myMatch = s.match(/^(\d{1,2})[./-](\d{4})$/);
  if (myMatch) {
    const m = Number(myMatch[1]);
    const y = Number(myMatch[2]);
    if (m >= 1 && m <= 12) {
      const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
      return clampAndFormat(y, m, lastDay);
    }
  }

  // 5. YYYY/MM or YYYY-MM (-> last day of month)
  const ymMatch = s.match(/^(\d{4})[./-](\d{1,2})$/);
  if (ymMatch) {
    const y = Number(ymMatch[1]);
    const m = Number(ymMatch[2]);
    if (m >= 1 && m <= 12) {
      const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
      return clampAndFormat(y, m, lastDay);
    }
  }

  return fallback;
}

const DATE_HEADER_PATTERNS = [
  "ngày",
  "ngay",
  "date",
  "hạn sử dụng",
  "han su dung",
  "hạn dùng",
  "han dung",
  "hạn giao",
  "han giao",
  "exp",
  "mfg",
  "hsd",
  "nsx",
];

/**
 * Normalize date-like columns in an Excel row object (from `XLSX.utils.sheet_to_json`) so that
 * Excel serial numbers (e.g. `46063`) and non-ISO dates (`31/10/2026`) become `"YYYY-MM-DD"`
 * in both the UI preview table and the payload sent to the backend.
 */
export function normalizeExcelRowDates<T extends Record<string, any>>(row: T): T {
  if (!row || typeof row !== "object") return row;
  const out: Record<string, any> = { ...row };
  for (const key of Object.keys(out)) {
    const val = out[key];
    if (val === null || val === undefined || val === "") continue;
    const kLow = key.toLowerCase().normalize("NFC");
    if (kLow.includes("thời hạn nợ") || kLow.includes("số ngày") || kLow.includes("so ngay") || kLow.includes("term_days")) {
      continue;
    }
    const isDateCol = DATE_HEADER_PATTERNS.some((p) => kLow.includes(p));
    if (isDateCol) {
      const iso = normalizeExcelDateToISO(val, "");
      if (iso) {
        out[key] = iso;
      }
    }
  }
  return out as T;
}

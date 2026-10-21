import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount: number | string | undefined | null): string {
  if (amount === undefined || amount === null || isNaN(Number(amount))) return "0 VNĐ";
  return new Intl.NumberFormat("vi-VN").format(Number(amount)) + " VNĐ";
}

/**
 * Phân tích an toàn mọi chuỗi thời gian hoặc timestamp sang đối tượng Date chuẩn
 */
export function parseDateSafe(input?: string | Date | number | null): Date | null {
  if (!input) return null;
  if (input instanceof Date) return isNaN(input.getTime()) ? null : input;
  if (typeof input === "number") {
    const d = new Date(input);
    return isNaN(d.getTime()) ? null : d;
  }
  let str = String(input).trim();
  if (!str) return null;

  let d = new Date(str);
  if (!isNaN(d.getTime())) return d;

  // Hỗ trợ định dạng khoảng trắng phân tách ngày & giờ (ví dụ: PostgreSQL 'YYYY-MM-DD HH:mm:ss')
  if (str.includes(" ")) {
    str = str.replace(" ", "T");
    d = new Date(str);
    if (!isNaN(d.getTime())) return d;
  }

  return null;
}

/**
 * Định dạng ngày theo múi giờ Việt Nam (UTC+7 / Asia/Ho_Chi_Minh)
 * Chuẩn: DD/MM/YYYY
 */
export function formatDate(dateString?: string | Date | number | null): string {
  if (!dateString) return "-";
  const d = parseDateSafe(dateString);
  if (!d) return String(dateString);
  try {
    return d.toLocaleDateString("vi-VN", {
      timeZone: "Asia/Ho_Chi_Minh",
      day: "2-digit",
      month: "2-digit",
      year: "numeric"
    });
  } catch {
    return String(dateString);
  }
}

/**
 * Định dạng giờ theo múi giờ Việt Nam (UTC+7 / Asia/Ho_Chi_Minh)
 * Chuẩn: HH:mm (24 giờ, ví dụ: "19:55", "08:30")
 */
export function formatVietnamTime(dateInput?: string | Date | number | null): string {
  const d = parseDateSafe(dateInput);
  if (!d) return "";
  try {
    return d.toLocaleTimeString("vi-VN", {
      timeZone: "Asia/Ho_Chi_Minh",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    });
  } catch {
    return "";
  }
}

/**
 * Định dạng ngày theo múi giờ Việt Nam (UTC+7 / Asia/Ho_Chi_Minh)
 * Chuẩn: DD/MM/YYYY
 */
export function formatVietnamDate(dateInput?: string | Date | number | null): string {
  const d = parseDateSafe(dateInput);
  if (!d) return "";
  try {
    return d.toLocaleDateString("vi-VN", {
      timeZone: "Asia/Ho_Chi_Minh",
      day: "2-digit",
      month: "2-digit",
      year: "numeric"
    });
  } catch {
    return "";
  }
}

/**
 * Định dạng đầy đủ Giờ & Ngày theo múi giờ Việt Nam (UTC+7 / Asia/Ho_Chi_Minh)
 * Ví dụ: "19:55:38 • 07/10/2026" hoặc "19:55 • 07/10/2026"
 */
export function formatVietnamDateTime(
  dateInput?: string | Date | number | null,
  includeSeconds: boolean = true
): string {
  const d = parseDateSafe(dateInput);
  if (!d) return "";
  try {
    const time = d.toLocaleTimeString("vi-VN", {
      timeZone: "Asia/Ho_Chi_Minh",
      hour: "2-digit",
      minute: "2-digit",
      ...(includeSeconds ? { second: "2-digit" } : {}),
      hour12: false
    });
    const date = d.toLocaleDateString("vi-VN", {
      timeZone: "Asia/Ho_Chi_Minh",
      day: "2-digit",
      month: "2-digit",
      year: "numeric"
    });
    return `${time} • ${date}`;
  } catch {
    return "";
  }
}

/**
 * Nhãn ngày trực quan theo múi giờ Việt Nam (Dùng cho dải phân cách ngày / Date divider trong Chat)
 * Ví dụ: "Hôm nay, 07/10/2026", "Hôm qua, 06/10/2026", "Thứ Bảy, 03/10/2026"
 */
export function getVietnamDateLabel(dateInput?: string | Date | number | null): string {
  const d = parseDateSafe(dateInput);
  if (!d) return "";
  try {
    const dateStr = d.toLocaleDateString("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }); // YYYY-MM-DD
    const nowStr = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Ho_Chi_Minh" });
    
    const today = new Date(nowStr + "T00:00:00");
    const targetDate = new Date(dateStr + "T00:00:00");
    const diffDays = Math.round((today.getTime() - targetDate.getTime()) / (1000 * 60 * 60 * 24));
    
    const dateFormatted = d.toLocaleDateString("vi-VN", {
      timeZone: "Asia/Ho_Chi_Minh",
      day: "2-digit",
      month: "2-digit",
      year: "numeric"
    });

    if (diffDays === 0) return `Hôm nay, ${dateFormatted}`;
    if (diffDays === 1) return `Hôm qua, ${dateFormatted}`;
    
    const weekday = d.toLocaleDateString("vi-VN", {
      timeZone: "Asia/Ho_Chi_Minh",
      weekday: "long"
    });
    return `${weekday}, ${dateFormatted}`;
  } catch {
    return "";
  }
}

/**
 * Lấy chuỗi ngày YYYY-MM-DD hiện tại chuẩn theo múi giờ Việt Nam
 */
export function getVietnamTodayDate(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Ho_Chi_Minh" });
}

export function getPhaseTranslation(phase: string): string {
  const translations: Record<string, string> = {
    "Scoping": "Khảo sát sơ bộ",
    "Development": "Phát triển",
    "Testing": "Thử nghiệm",
    "Launch": "Bàn giao",
    "Completed": "Đã hoàn thành",
  };
  return translations[phase] || phase;
}

export function getGateTranslation(gateName: string): string {
  if (!gateName) return "";
  return gateName
    .replace(/Scoping/g, "Khảo sát sơ bộ")
    .replace(/Development/g, "Phát triển")
    .replace(/Testing/g, "Thử nghiệm")
    .replace(/Launch/g, "Bàn giao")
    .replace(/Completed/g, "Hoàn thành & Đóng dự án");
}

export async function triggerWebhook(eventName: string, payload: any) {
  if (typeof window === "undefined") return;
  try {
    const storedWh = localStorage.getItem("active_webhooks");
    if (!storedWh) return;
    const webhooks = JSON.parse(storedWh);
    const matchedWhs = webhooks.filter((wh: any) => wh.event === eventName && wh.status === "Active");
    for (const wh of matchedWhs) {
      try {
        await fetch(wh.url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            event: eventName,
            timestamp: new Date().toISOString(),
            data: payload
          }),
          mode: "no-cors"
        });
      } catch (err) {}
    }
  } catch (e) {}
}

export function hasPermission(role: string | undefined, action: 'view' | 'edit' | 'delete' | 'approve'): boolean {
  if (!role) return true;
  const normRole = role.normalize("NFC").trim().toLowerCase();
  const directors = ["director", "giám đốc", "giam doc", "deputy director", "phó giám đốc", "pho giam doc", "vice_director", "admin"];
  const heads = ["head", "trưởng phòng", "manager", "quản lý"];
  if (directors.some(r => normRole.includes(r))) return true;
  if (heads.some(r => normRole.includes(r))) return true;
  return action === "view" || action === "edit";
}
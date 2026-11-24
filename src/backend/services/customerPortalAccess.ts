import crypto from "crypto";
import { query } from "@/backend/db/db";
import { hashPassword } from "@/backend/services/passwords";

/**
 * Mã truy cập Cổng khách hàng: mỗi khách một mã ngẫu nhiên 8 ký tự do NVKD / Quản trị tạo trong hồ sơ khách và gửi cho
 * khách. Đăng nhập cổng = Mã khách hàng + Mã truy cập. Trước đây chỉ cần Mã khách hàng + Số điện thoại — hai thông tin
 * thường in sẵn trên chứng từ, người ngoài biết là xem được đơn hàng / giá trị đơn của khách.
 * Chỉ lưu bản băm của mã; mã gốc chỉ hiện một lần lúc tạo.
 */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // bỏ 0/O, 1/I dễ nhầm
let columnsEnsured = false;

export async function ensurePortalAccessColumns(): Promise<void> {
  if (columnsEnsured) return;
  await query(`
    ALTER TABLE sales_customers
      ADD COLUMN IF NOT EXISTS portal_access_hash TEXT,
      ADD COLUMN IF NOT EXISTS portal_access_set_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS portal_access_set_by TEXT
  `);
  columnsEnsured = true;
}

/** "K7QM3XPA" -> chỉ giữ chữ / số, viết hoa (khách gõ "k7qm-3xpa" vẫn đúng). */
export function normalizePortalAccessCode(v: unknown): string {
  return String(v || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function generatePortalAccessCode(): string {
  const bytes = crypto.randomBytes(8);
  return Array.from(bytes, b => ALPHABET[b % ALPHABET.length]).join("");
}

/** Định dạng hiển thị XXXX-XXXX */
export function formatPortalAccessCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/** Tạo (hoặc tạo lại) mã truy cập cho khách; trả về mã gốc để hiển thị một lần, null nếu không tìm thấy khách. */
export async function issuePortalAccessCode(customerCode: string, issuedBy: string): Promise<{ code: string; name: string } | null> {
  await ensurePortalAccessColumns();
  const code = generatePortalAccessCode();
  const res = await query(
    `UPDATE sales_customers
        SET portal_access_hash = $2, portal_access_set_at = CURRENT_TIMESTAMP, portal_access_set_by = $3
      WHERE LOWER(TRIM(customer_code)) = LOWER(TRIM($1))
      RETURNING name`,
    [customerCode, hashPassword(code), issuedBy]
  );
  if (res.rows.length === 0) return null;
  return { code: formatPortalAccessCode(code), name: res.rows[0].name };
}

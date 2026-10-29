import { query } from "@/backend/db/db";

/**
 * Tên đăng nhập riêng ghi trong file nhập liệu (cột "Tên đăng nhập") khi khác Mã nhân viên.
 * Tài khoản vẫn dùng Mã nhân viên làm username (chat, Zalo, phân quyền dựa vào đó); login_name chỉ là tên đăng nhập thêm.
 * Trả về cảnh báo khi tên đã thuộc về tài khoản khác (không gán), null nếu ổn.
 */
export async function setImportedLoginName(username: string, loginName: string): Promise<string | null> {
  const name = String(loginName || "").trim();
  if (!name || name.toLowerCase() === String(username).toLowerCase()) return null;
  const clash = await query(
    `SELECT username FROM users
      WHERE username <> $2 AND (LOWER(username) = LOWER($1) OR LOWER(COALESCE(login_name, '')) = LOWER($1) OR LOWER(COALESCE(email, '')) = LOWER($1))
      LIMIT 1`,
    [name, username]
  );
  if (clash.rows.length > 0) {
    return `Tên đăng nhập "${name}" của ${username} đã thuộc về tài khoản ${clash.rows[0].username}: không gán, hãy đăng nhập bằng mã ${username}.`;
  }
  await query("UPDATE users SET login_name = $1 WHERE username = $2", [name, username]);
  return null;
}

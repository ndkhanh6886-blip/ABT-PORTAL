import { query, withTransaction } from "@/backend/db/db";
import { initZaloDatabase } from "@/backend/db/zaloDb";
import crypto from "crypto";
import { signedDocumentUrl } from "@/backend/services/documentLinks";
import { todayVN } from "@/backend/services/dates";
import { isAdminUser } from "@/backend/services/authz";
import { hasPermission } from "@/backend/services/permissions";

export interface ZaloMessageResponse {
  recipientId: string;
  messageType: "TEXT" | "CARD" | "FILE" | "APPROVAL_REQUEST";
  text: string;
  buttons?: Array<{ label: string; action: string; payload: string }>;
  fileUrl?: string;
  quoteData?: any;
}

const BASE_APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://tbr-portal.vn";

const QUOTE_CODE_REGEX = /BG-(?:TBR|VIA)-[A-Za-z0-9-]+|BG[0-9]{2}-[A-Za-z0-9-]+|BG-[0-9-]+/i;

async function hasQuotationApprovalAuthority(senderBinding: any, senderId: string, directorZaloId: string): Promise<boolean> {
  if (
    senderBinding?.role === "DIRECTOR" ||
    senderBinding?.user_type === "DIRECTOR" ||
    senderBinding?.department === "Ban Giám Đốc" ||
    (directorZaloId && senderId === directorZaloId)
  ) {
    return true;
  }
  const empId = String(senderBinding?.employee_id || "").trim();
  if (!empId) return false;
  try {
    const uRes = await query(
      `SELECT id, username, role, department, full_name, permissions FROM users
        WHERE username = $1
           OR username = REPLACE(REPLACE($1, 'NV-TBR-', 'TBR'), 'NV-VIA-', 'VIA')
        LIMIT 1`,
      [empId]
    );
    const u = uRes.rows[0];
    if (!u) return false;
    return isAdminUser(u) || hasPermission(u, "sales.approve_discount");
  } catch {
    return false;
  }
}

async function resolveSingleQuotationCode(inputCode: string): Promise<{ exactCode?: string; candidates?: string[] }> {
  const res = await query(
    `SELECT quote_code, status FROM sales_quotations
      WHERE UPPER(quote_code) = UPPER($1) OR quote_code ILIKE $2
      ORDER BY id DESC LIMIT 5`,
    [inputCode, `%${inputCode}%`]
  );
  if (res.rows.length === 0) return {};
  const exact = res.rows.find((r: any) => String(r.quote_code || "").toUpperCase() === inputCode.toUpperCase());
  if (exact) return { exactCode: exact.quote_code };
  if (res.rows.length === 1) return { exactCode: res.rows[0].quote_code };
  return { candidates: res.rows.map((r: any) => r.quote_code) };
}

/**
 * Core Processing Engine for Inbound Zalo Messages
 */
export async function processZaloInboundMessage(params: {
  senderId: string;
  senderName?: string;
  text: string;
  /** Portal simulator only (admin, server-side): act as this employee's binding */
  simulateEmployeeId?: string;
}): Promise<ZaloMessageResponse> {
  await initZaloDatabase();

  const { senderId, senderName = "Người dùng Zalo", text } = params;
  const rawText = (text || "").trim();
  const lowerText = rawText.toLowerCase();

  // 1. Sender binding: ONLY by the Zalo user id that was linked with a one-time code from the portal.
  // (Matching by phone number / employee code / name let anyone take over a colleague's or a director's
  // binding just by typing their employee code, then approve quotations through the bot.)
  let senderBinding: any = null;
  try {
    const bindRes = params.simulateEmployeeId
      ? await query("SELECT * FROM zalo_user_bindings WHERE employee_id = $1 LIMIT 1", [params.simulateEmployeeId])
      : await query("SELECT * FROM zalo_user_bindings WHERE zalo_user_id = $1 LIMIT 1", [senderId]);
    if (bindRes.rows.length > 0) senderBinding = bindRes.rows[0];
  } catch (err) {
    console.warn("Binding lookup error:", err);
  }

  // 1B. LINKING: the message contains a one-time code "LK-XXXXXX" created by the employee in TBRs Portal
  if (!senderBinding) {
    try {
      const codeMatch = rawText.toUpperCase().match(/LK-[A-F0-9]{6}/);
      if (codeMatch) {
        const codeHash = crypto.createHash("sha256").update(codeMatch[0]).digest("hex");
        const matchRes = await query(
          "SELECT * FROM zalo_user_bindings WHERE link_code_hash = $1 AND link_code_expires > NOW() LIMIT 1",
          [codeHash]
        );
        if (matchRes.rows.length > 0) {
          senderBinding = matchRes.rows[0];
          // One Zalo account <-> one employee: release this Zalo id from any other record first
          await query("UPDATE zalo_user_bindings SET zalo_user_id = NULL, connection_status = 'PENDING_ZALO' WHERE zalo_user_id = $1 AND id <> $2", [senderId, senderBinding.id]);
          await query(
            `UPDATE zalo_user_bindings
             SET zalo_user_id = $1,
                 connection_status = 'CONNECTED',
                 is_active = TRUE,
                 link_code_hash = NULL,
                 link_code_expires = NULL,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = $2`,
            [senderId, senderBinding.id]
          );
          senderBinding.zalo_user_id = senderId;
          senderBinding.connection_status = "CONNECTED";
          senderBinding.is_active = true;

          await query(
            `INSERT INTO zalo_message_logs (zalo_user_id, sender_name, direction, message_type, content, status)
             VALUES ($1, $2, 'INBOUND', 'TEXT', $3, 'CONNECTED')`,
            [senderId, senderBinding.display_name, "[Mã liên kết Zalo]"]
          ).catch(() => {});

          return {
            recipientId: senderId,
            messageType: "TEXT",
            text:
`🎉 XÁC THỰC THÀNH CÔNG!
Chào mừng ${senderBinding.display_name} [${senderBinding.employee_id}] (${senderBinding.department} - ${senderBinding.position || 'Nhân sự'})!

✅ Tài khoản Zalo của bạn đã được LIÊN KẾT CHÍNH THỨC với Trung tâm Điều hành Công ty TNHH Khoa học TBR.

Từ bây giờ, bạn có thể thực hiện trực tiếp trên Zalo:
1. 📋 Soạn báo giá tự động: Gõ ví dụ "Báo giá BV Chợ Rẫy: 10 kit HBV, ck 5%"
2. 📦 Tra cứu tồn kho FEFO: Gõ "Tồn kho KIT-HBV-100"
3. 🔒 Giữ chỗ hàng hóa 48h: Gõ "Giữ chỗ 10 KIT-HBV-100 BV Bạch Mai"
4. 📊 Nộp báo cáo nhanh Daily

Gõ "menu" hoặc "help" bất kỳ lúc nào để xem danh sách lệnh hỗ trợ.`
          };
        }
      }
    } catch (autoBindErr) {
      console.warn("Zalo link code error:", autoBindErr);
    }

    // IF STILL NOT MATCHED: Log unlinked message and guide the user
    try {
      await query(
        `INSERT INTO zalo_message_logs (zalo_user_id, sender_name, direction, message_type, content, status)
         VALUES ($1, $2, 'INBOUND', 'TEXT', $3, 'UNLINKED')`,
        [senderId, senderName || "Người dùng Zalo", rawText]
      );
    } catch (e) {}

    return {
      recipientId: senderId,
      messageType: "TEXT",
      text: 
`👋 Xin chào! Hệ thống nhận diện tin nhắn từ tài khoản Zalo của bạn tới trang Zalo OA Công ty TNHH Khoa học TBR.

⚠️ Hiện tại tài khoản Zalo này CHƯA ĐƯỢC LIÊN KẾT với hồ sơ nhân sự trên hệ thống TBRs Portal.

👉 ĐỂ LIÊN KẾT TÀI KHOẢN (dành cho nhân viên TBRs):
1. Đăng nhập TBRs Portal → bấm vào tên của bạn → "Bảo mật tài khoản" → "Tạo mã liên kết Zalo".
2. Nhắn mã vừa nhận (dạng LK-XXXXXX, hiệu lực 30 phút) vào khung chat này.

Vì lý do bảo mật, hệ thống không liên kết theo số điện thoại hay mã nhân viên.`
    };
  }

  // If personnel has NO phone number or is marked NO_PHONE:
  if (!senderBinding.phone_number || senderBinding.connection_status === "NO_PHONE") {
    const empName = senderBinding.display_name || senderName;
    const empCode = senderBinding.employee_id ? ` [${senderBinding.employee_id}]` : "";

    return {
      recipientId: senderId,
      messageType: "TEXT",
      text: 
`⚠️ THÔNG BÁO: KHÔNG KẾT NỐI HỆ THỐNG ZALO

Nhân sự: ${empName}${empCode}
Trạng thái: ❌ KHÔNG KẾT NỐI (Chưa có số điện thoại Zalo trong hồ sơ)

Hồ sơ nhân sự của bạn trên TBRs Portal hiện đang để trống thông tin số điện thoại, do đó hệ thống chưa thể kích hoạt tính năng điều hành, kiểm tra kho và nhận lệnh qua Zalo.

👉 HƯỚNG DẪN KÍCH HOẠT:
Vui lòng liên hệ Quản trị viên hệ thống để cập nhật số điện thoại chính thức vào danh mục nhân sự.`
    };
  }

  // 2. Fetch Zalo Configuration (Approval Threshold, Director ID, etc.)
  let config = {
    director_discount_threshold: 10.0,
    director_zalo_id: "zalo_dir_bld_01",
    oa_name: "Công ty TNHH Khoa học TBR"
  };
  try {
    const cfgRes = await query("SELECT * FROM zalo_config LIMIT 1");
    if (cfgRes.rows.length > 0) {
      config = {
        ...config,
        director_discount_threshold: parseFloat(cfgRes.rows[0].director_discount_threshold) || 10.0,
        director_zalo_id: cfgRes.rows[0].director_zalo_id || "zalo_dir_bld_01",
        oa_name: cfgRes.rows[0].oa_name || "Công ty TNHH Khoa học TBR"
      };
    }
  } catch (err) {
    console.warn("Config lookup error:", err);
  }

  // Log inbound message for connected user
  try {
    await query(
      `INSERT INTO zalo_message_logs (zalo_user_id, sender_name, direction, message_type, content, status)
       VALUES ($1, $2, 'INBOUND', 'TEXT', $3, 'CONNECTED')`,
      [senderId, senderBinding?.display_name || senderName, rawText]
    );
  } catch (err) {}

  // ==============================================================
  // INTENT 1: BAN GIÁM ĐỐC PHÊ DUYỆT BÁO GIÁ CHIẾT KHẤU LỚN
  // Cú pháp: "Duyệt BG-TBR-XXXX" hoặc bấm nút phê duyệt
  // ==============================================================
  if (
    lowerText.startsWith("duyệt ") ||
    lowerText.startsWith("duyet ") ||
    lowerText.startsWith("approve ") ||
    lowerText.includes("đồng ý duyệt") ||
    lowerText.includes("dong y duyet")
  ) {
    const quoteCodeMatch = rawText.match(QUOTE_CODE_REGEX);
    const quoteCode = quoteCodeMatch ? quoteCodeMatch[0].toUpperCase() : null;

    if (!quoteCode) {
      return {
        recipientId: senderId,
        messageType: "TEXT",
        text: "⚠️ Vui lòng chỉ định rõ mã báo giá cần phê duyệt. Ví dụ: 'Duyệt BG-TBR-2609-089'"
      };
    }

    // Check Director / Manager permissions (including users table permissions)
    const isDirectorOrManager = await hasQuotationApprovalAuthority(senderBinding, senderId, config.director_zalo_id);

    if (!isDirectorOrManager) {
      return {
        recipientId: senderId,
        messageType: "TEXT",
        text: `⛔ BẠN KHÔNG CÓ THẨM QUYỀN DUYỆT: Quyền phê duyệt mức chiết khấu lớn thuộc thẩm quyền của Ban Giám Đốc (Ngưỡng quy định: ≥ ${config.director_discount_threshold}%).`
      };
    }

    try {
      const resolved = await resolveSingleQuotationCode(quoteCode);
      if (!resolved.exactCode) {
        if (resolved.candidates && resolved.candidates.length > 1) {
          return {
            recipientId: senderId,
            messageType: "TEXT",
            text: `⚠️ Có nhiều báo giá khớp một phần với "${quoteCode}":\n${resolved.candidates.map(c => `• ${c}`).join("\n")}\n\nVui lòng gõ chính xác đầy đủ mã báo giá cần duyệt.`
          };
        }
        return {
          recipientId: senderId,
          messageType: "TEXT",
          text: `⚠️ Không tìm thấy báo giá có mã "${quoteCode}" trong cơ sở dữ liệu.`
        };
      }

      const updateRes = await query(
        `UPDATE sales_quotations 
         SET status = 'APPROVED' 
         WHERE quote_code = $1
         RETURNING *`,
        [resolved.exactCode]
      );

      if (updateRes.rows.length === 0) {
        return {
          recipientId: senderId,
          messageType: "TEXT",
          text: `⚠️ Không tìm thấy báo giá có mã "${quoteCode}" trong cơ sở dữ liệu.`
        };
      }

      const q = updateRes.rows[0];
      const totalFmt = new Intl.NumberFormat("vi-VN").format(parseFloat(q.total_amount || 0));

      const approvalNotice = 
`✅ BAN GIÁM ĐỐC ĐÃ PHÊ DUYỆT BÁO GIÁ THÀNH CÔNG!

📋 Mã Báo Giá: ${q.quote_code}
🏥 Khách Hàng: ${q.customer_name}
👤 NVKD Phụ Trách: ${q.sales_rep_name || "Nhân viên kinh doanh"}
💰 Tổng Tiền Duyệt: ${totalFmt} VNĐ (Đã trừ chiết khấu ${q.discount_rate}%)
📅 Thời Điểm Duyệt: ${new Date().toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}
✍ Người Phê Duyệt: ${senderBinding?.display_name || "Nguyễn Văn Hưng (Tổng Giám Đốc)"}

Trạng thái báo giá đã được cập nhật sang [ĐÃ PHÊ DUYỆT]. NVKD có thể gửi file PDF chính thức đến khách hàng.`;

      return {
        recipientId: senderId,
        messageType: "TEXT",
        text: approvalNotice,
        quoteData: q
      };
    } catch (e: any) {
      return {
        recipientId: senderId,
        messageType: "TEXT",
        text: `Lỗi khi cập nhật phê duyệt: ${e.message}`
      };
    }
  }

  // ==============================================================
  // INTENT 2: BAN GIÁM ĐỐC TỪ CHỐI BÁO GIÁ CHIẾT KHẤU LỚN
  // Cú pháp: "Từ chối BG-TBR-XXXX [Lý do]"
  // ==============================================================
  if (lowerText.startsWith("từ chối ") || lowerText.startsWith("tu choi ") || lowerText.startsWith("reject ")) {
    const quoteCodeMatch = rawText.match(QUOTE_CODE_REGEX);
    const quoteCode = quoteCodeMatch ? quoteCodeMatch[0].toUpperCase() : null;

    if (!quoteCode) {
      return {
        recipientId: senderId,
        messageType: "TEXT",
        text: "⚠️ Vui lòng chỉ định mã báo giá cần từ chối. Ví dụ: 'Từ chối BG-TBR-2609-089 Chiết khấu quá cao'"
      };
    }

    const isDirectorOrManager = await hasQuotationApprovalAuthority(senderBinding, senderId, config.director_zalo_id);
    if (!isDirectorOrManager) {
      return {
        recipientId: senderId,
        messageType: "TEXT",
        text: `⛔ BẠN KHÔNG CÓ THẨM QUYỀN TỪ CHỐI BÁO GIÁ: Quyền phê duyệt / từ chối báo giá chiết khấu thuộc thẩm quyền của Ban Giám Đốc.`
      };
    }

    try {
      const resolved = await resolveSingleQuotationCode(quoteCode);
      if (!resolved.exactCode) {
        if (resolved.candidates && resolved.candidates.length > 1) {
          return {
            recipientId: senderId,
            messageType: "TEXT",
            text: `⚠️ Có nhiều báo giá khớp một phần với "${quoteCode}":\n${resolved.candidates.map(c => `• ${c}`).join("\n")}\n\nVui lòng gõ chính xác đầy đủ mã báo giá cần từ chối.`
          };
        }
        return {
          recipientId: senderId,
          messageType: "TEXT",
          text: `⚠️ Không tìm thấy báo giá có mã "${quoteCode}" trong cơ sở dữ liệu.`
        };
      }

      await query(
        `UPDATE sales_quotations SET status = 'REJECTED' WHERE quote_code = $1`,
        [resolved.exactCode]
      );
      return {
        recipientId: senderId,
        messageType: "TEXT",
        text: `❌ ĐÃ TỪ CHỐI BÁO GIÁ ${resolved.exactCode}: Hệ thống đã gửi thông báo đến NVKD phụ trách yêu cầu điều chỉnh lại mức chiết khấu.`
      };
    } catch (e: any) {
      return {
        recipientId: senderId,
        messageType: "TEXT",
        text: `Lỗi: ${e.message}`
      };
    }
  }

  // ==============================================================
  // INTENT: SOẠN & GỬI HỢP ĐỒNG TỪ MÃ BÁO GIÁ
  // Cú pháp: "Hợp đồng [Mã BG]" hoặc "Soạn hợp đồng từ [Mã BG]"
  // ==============================================================
  const isContractIntent = 
    lowerText.startsWith("hợp đồng") ||
    lowerText.startsWith("hop dong") ||
    lowerText.startsWith("hđ ") ||
    lowerText.startsWith("hd ") ||
    lowerText.startsWith("hđ:") ||
    lowerText.startsWith("hd:") ||
    lowerText.startsWith("soạn hợp đồng") ||
    lowerText.startsWith("soan hop dong") ||
    lowerText.startsWith("tạo hợp đồng") ||
    lowerText.startsWith("tao hop dong") ||
    lowerText.startsWith("lập hợp đồng") ||
    lowerText.startsWith("lap hop dong") ||
    ((lowerText.includes("hợp đồng") || lowerText.includes("hop dong") || lowerText.includes("hđ") || lowerText.includes("hd")) &&
     Boolean(rawText.match(QUOTE_CODE_REGEX)));

  if (isContractIntent) {
    const quoteCodeMatch = rawText.match(QUOTE_CODE_REGEX);
    const quoteCode = quoteCodeMatch ? quoteCodeMatch[0].toUpperCase() : null;

    if (!quoteCode) {
      return {
        recipientId: senderId,
        messageType: "TEXT",
        text: `📋 SOẠN HỢP ĐỒNG TỰ ĐỘNG TỪ BÁO GIÁ:

Vui lòng cung cấp mã báo giá cần lập hợp đồng mua bán.

💡 Ví dụ:
• "Hợp đồng BG-TBR-2610-9017"
• "Soạn hợp đồng từ BG-TBR-2610-9017"
• "Tạo HĐ BG-TBR-2610-9017 mặc định"`
      };
    }

    try {
      const resolved = await resolveSingleQuotationCode(quoteCode);
      if (!resolved.exactCode) {
        if (resolved.candidates && resolved.candidates.length > 1) {
          return {
            recipientId: senderId,
            messageType: "TEXT",
            text: `⚠️ Có nhiều báo giá khớp một phần với "${quoteCode}":\n${resolved.candidates.map(c => `• ${c}`).join("\n")}\n\nVui lòng gõ chính xác đầy đủ mã báo giá cần lập hợp đồng.`
          };
        }
        return {
          recipientId: senderId,
          messageType: "TEXT",
          text: `⚠️ Không tìm thấy báo giá có mã "${quoteCode}" trong cơ sở dữ liệu. Vui lòng kiểm tra lại mã báo giá hoặc gõ "Báo giá [Khách hàng]: [SL] [Mã]..." để tạo báo giá trước.`
        };
      }

      const qRes = await query(
        "SELECT * FROM sales_quotations WHERE quote_code = $1 LIMIT 1",
        [resolved.exactCode]
      );

      if (qRes.rows.length === 0) {
        return {
          recipientId: senderId,
          messageType: "TEXT",
          text: `⚠️ Không tìm thấy báo giá có mã "${quoteCode}" trong cơ sở dữ liệu. Vui lòng kiểm tra lại mã báo giá hoặc gõ "Báo giá [Khách hàng]: [SL] [Mã]..." để tạo báo giá trước.`
        };
      }

      const q = qRes.rows[0];
      const qStatus = String(q.status || "").toUpperCase();
      if (
        qStatus === "PENDING_APPROVAL" ||
        qStatus === "PENDING_DIRECTOR_APPROVAL" ||
        qStatus === "REJECTED" ||
        qStatus === "DRAFT"
      ) {
        return {
          recipientId: senderId,
          messageType: "TEXT",
          text: `⛔ KHÔNG THỂ LẬP HỢP ĐỒNG: Báo giá [${q.quote_code}] hiện đang ở trạng thái [${qStatus}]. Báo giá phải được Ban Giám Đốc PHÊ DUYỆT (APPROVED) trước khi chuyển sang lập hợp đồng mua bán!`
        };
      }

      const totalFmt = new Intl.NumberFormat("vi-VN").format(parseFloat(q.total_amount || 0));

      // Check existing customer profile
      let existingCust: any = null;
      try {
        const cRes = await query(
          "SELECT * FROM sales_customers WHERE name ILIKE $1 OR name ILIKE $2 LIMIT 1",
          [`%${q.customer_name}%`, `%${q.customer_name.replace(/^(?:Bệnh Viện|Phòng Khám|Trung Tâm|Công Ty)\s+/i, "").trim()}%`]
        );
        if (cRes.rows.length > 0) existingCust = cRes.rows[0];
      } catch (e) {}

      const isConfirmDefault = 
        lowerText.includes("mặc định") || 
        lowerText.includes("mac dinh") ||
        lowerText.includes("đồng ý") ||
        lowerText.includes("dong y") ||
        lowerText.includes("xác nhận") ||
        lowerText.includes("xac nhan");

      const hasDetailedInfo = 
        /(?:đại\s*diện|dai\s*dien|chức\s*vụ|chuc\s*vu|đc:|địa\s*chỉ|dia\s*chi|mst:|mã\s*số\s*thuế|giao\s*hàng|giao\s*hang|thanh\s*toán|thanh\s*toan)/i.test(rawText);

      // CASE A: User asks for contract without details -> Reply asking for basic contract information!
      if (!isConfirmDefault && !hasDetailedInfo) {
        return {
          recipientId: senderId,
          messageType: "TEXT",
          text: `📋 YÊU CẦU THÔNG TIN CƠ BẢN ĐỂ SOẠN THẢO HỢP ĐỒNG:

Hệ thống đã tìm thấy Báo giá [${q.quote_code}]
🏥 Đơn vị / Bên Mua (Bên B): ${q.customer_name}
💰 Tổng giá trị hợp đồng: ${totalFmt} VNĐ (Đã bao gồm VAT 8%)

Để hoàn tất bản Hợp Đồng Mua Bán có đầy đủ tính pháp lý và con dấu số, vui lòng cung cấp hoặc xác nhận các thông tin cơ bản sau:

1. Đại diện Bên B: Họ tên & Chức vụ (Ví dụ: PGS.TS Nguyễn Trường Sơn - Giám Đốc)
2. Địa chỉ trụ sở & Địa điểm giao hàng: ${existingCust?.address ? `(Hiện có: ${existingCust.address})` : ""}
3. Mã số thuế: ${existingCust?.tax_code ? `(Hiện có: ${existingCust.tax_code})` : ""} | Số điện thoại liên hệ
4. Thời hạn giao hàng (Mặc định: Trong vòng 07 ngày làm việc)
5. Điều kiện thanh toán (Mặc định: Chuyển khoản trong vòng 30 ngày)

✍️ CÚ PHÁP PHẢN HỒI LẠI ĐỂ TẠO FILE HỢP ĐỒNG:
"HĐ ${q.quote_code}: Đại diện: [Họ tên - Chức vụ], ĐC: [Địa chỉ], MST: [MST], Giao hàng: [Số ngày], TT: [Số ngày]"

💡 Ví dụ mẫu:
HĐ ${q.quote_code}: Đại diện: Bác sĩ Nguyễn Văn A - Giám Đốc, ĐC: ${existingCust?.address || "201B Nguyễn Chí Thanh Q5 TP.HCM"}, MST: ${existingCust?.tax_code || "0301441837"}, Giao hàng: 7 ngày, TT: 30 ngày

👉 Hoặc nếu đồng ý sử dụng toàn bộ thông tin mặc định theo hồ sơ khách hàng, bạn chỉ cần gửi:
"Tạo HĐ ${q.quote_code} mặc định"`
        };
      }

      // CASE B: User provided details or requested default -> Generate contract and send back PDF file!
      let repName = "";
      let repRole = "";
      let partyBAddress = "";
      let partyBTaxCode = "";
      let partyBPhone = "";
      let deliveryTerms = "";
      let paymentTerms = "";

      // 1. Extract Representative & Role
      const repMatch = rawText.match(/(?:đại\s*diện|dai\s*dien|bs|bác\s*sĩ|ông|bà)[:\s]+([^,;\n]+?)(?=(?:-|chức\s*vụ|đc|địa\s*chỉ|mst|sđt|giao|thanh\s*toán|tt|$))/i);
      if (repMatch && repMatch[1].trim()) {
        repName = repMatch[1].trim();
      }
      const roleMatch = rawText.match(/(?:chức\s*vụ|chuc\s*vu)[:\s]+([^,;\n]+)/i);
      if (roleMatch && roleMatch[1].trim()) {
        repRole = roleMatch[1].trim();
      } else if (rawText.includes("-") && repName) {
        const afterDash = rawText.split(repName)[1]?.split(/[,;\n]/)[0] || "";
        const roleCandidate = afterDash.replace(/^[-\s]+/, "").trim();
        if (roleCandidate.length >= 2 && roleCandidate.length <= 30 && !/(?:đc|mst|giao)/i.test(roleCandidate)) {
          repRole = roleCandidate;
        }
      }

      // 2. Extract Address
      const addrMatch = rawText.match(/(?:đc|địa\s*chỉ|dia\s*chi)[:\s]+([^,;\n]+?)(?=(?:mst|mã\s*số\s*thuế|sđt|phone|giao|thanh\s*toán|tt|$))/i);
      if (addrMatch && addrMatch[1].trim()) {
        partyBAddress = addrMatch[1].trim();
      }

      // 3. Extract Tax Code
      const taxMatch = rawText.match(/(?:mst|mã\s*số\s*thuế|ma\s*so\s*thue)[:\s]+([0-9\-]+)/i);
      if (taxMatch && taxMatch[1].trim()) {
        partyBTaxCode = taxMatch[1].trim();
      }

      // 4. Extract Phone
      const phoneMatch = rawText.match(/(?:sđt|điện\s*thoại|phone)[:\s]+([0-9.\-\s]+)/i);
      if (phoneMatch && phoneMatch[1].trim()) {
        partyBPhone = phoneMatch[1].replace(/\s+/g, "");
      }

      // 5. Extract Delivery Terms
      const delMatch = rawText.match(/(?:giao\s*hàng|giao\s*hang|giao)[:\s]+([^,;\n]+)/i);
      if (delMatch && delMatch[1].trim()) {
        const dVal = delMatch[1].trim();
        deliveryTerms = dVal.toLowerCase().includes("ngày") || dVal.toLowerCase().includes("tuần") ? `Trong vòng ${dVal} kể từ ngày hợp đồng có hiệu lực.` : dVal;
      }

      // 6. Extract Payment Terms
      const payMatch = rawText.match(/(?:thanh\s*toán|thanh\s*toan|tt)[:\s]+([^,;\n]+)/i);
      if (payMatch && payMatch[1].trim()) {
        const pVal = payMatch[1].trim();
        paymentTerms = pVal.toLowerCase().includes("ngày") ? `Chuyển khoản trong vòng ${pVal} kể từ ngày nhận đủ hóa đơn hợp lệ.` : pVal;
      }

      // Fallback to customer profile or standard defaults
      partyBAddress = partyBAddress || existingCust?.address || "Theo thỏa thuận giao hàng hợp đồng";
      partyBTaxCode = partyBTaxCode || existingCust?.tax_code || "Chưa cung cấp";
      partyBPhone = partyBPhone || existingCust?.phone || "Chưa cung cấp";
      repName = repName || existingCust?.contact_person || "Đại diện Quý Đơn Vị";
      repRole = repRole || existingCust?.contact_position || "Đại diện pháp luật";
      deliveryTerms = deliveryTerms || "Trong vòng 07 ngày làm việc kể từ ngày hợp đồng có hiệu lực.";
      paymentTerms = paymentTerms || existingCust?.payment_terms || "Chuyển khoản trong vòng 30 ngày kể từ ngày nhận đủ hóa đơn GTGT và biên bản bàn giao.";

      const brandPrefix = BASE_APP_URL.includes("via") ? "VIA" : "TBR";
      const isTBR = brandPrefix === "TBR";
      const contractCode = `HD-${brandPrefix}-${new Date().getFullYear().toString().slice(-2)}${(new Date().getMonth() + 1).toString().padStart(2, "0")}-${Date.now().toString().slice(-4)}`;

      const contractMeta = {
        quote_code: q.quote_code,
        party_b_name: q.customer_name,
        party_b_address: partyBAddress,
        party_b_tax_code: partyBTaxCode,
        party_b_phone: partyBPhone,
        party_b_representative: repName,
        party_b_role: repRole,
        delivery_terms: deliveryTerms,
        payment_terms: paymentTerms,
        tax_rate: q.tax_rate || 8,
        discount_rate: q.discount_rate || 0,
        discount_amount: q.discount_amount || 0,
        subtotal: q.subtotal || 0,
        total_amount: q.total_amount || 0
      };

      // Save to sales_contracts
      const vnToday = todayVN();
      await query(`
        INSERT INTO sales_contracts (
          contract_code, customer_id, customer_name, sales_rep_name,
          title, sign_date, valid_until, total_value, status, notes, contract_files, items
        ) VALUES ($1, $2, $3, $4, $5, $6::date, ($6::date + INTERVAL '1 year')::date, $7, 'ACTIVE', $8, $9, $10)
        ON CONFLICT (contract_code) DO UPDATE SET
          total_value = EXCLUDED.total_value,
          notes = EXCLUDED.notes,
          items = EXCLUDED.items
      `, [
        contractCode,
        existingCust?.id || null,
        q.customer_name,
        q.sales_rep_name || senderBinding?.display_name || senderName,
        `Hợp đồng mua bán thiết bị & sinh phẩm y tế - ${q.customer_name}`,
        vnToday,
        q.total_amount,
        JSON.stringify(contractMeta),
        JSON.stringify([]),
        typeof q.items === "string" ? q.items : JSON.stringify(q.items)
      ]);

      const companyTitle = isTBR ? "Công ty TNHH Khoa học TBR" : "CÔNG TY TNHH XÉT NGHIỆM VIA";
      const contractPdfUrl = signedDocumentUrl("contract", contractCode);

      return {
        recipientId: senderId,
        messageType: "CARD",
        text: `📜 ĐÃ SOẠN THẢO HỢP ĐỒNG MUA BÁN THÀNH CÔNG! [${contractCode}]
✅ Căn cứ theo Báo giá số: ${q.quote_code}

🏢 BÊN BÁN (BÊN A): ${companyTitle}
🏥 BÊN MUA (BÊN B): ${q.customer_name}
👤 Đại diện Bên B: ${repName} &mdash; Chức vụ: ${repRole}
📍 Địa chỉ giao hàng: ${partyBAddress}
🧾 Mã số thuế: ${partyBTaxCode} | SĐT: ${partyBPhone}
💰 TỔNG GIÁ TRỊ HỢP ĐỒNG: ${totalFmt} VNĐ (Đã bao gồm VAT 8%)
🚚 Thời hạn giao hàng: ${deliveryTerms}
💳 Điều kiện thanh toán: ${paymentTerms}
👨‍💼 NVKD quản lý: ${q.sales_rep_name || senderBinding?.display_name || senderName}

📎 ĐƯỜNG LINK XEM & TẢI FILE HỢP ĐỒNG CHÍNH THỨC (PDF/IN ẤN):
${contractPdfUrl}`,
        buttons: [
          { label: `📜 Mở File Hợp Đồng (${contractCode})`, action: "view_contract_pdf", payload: contractPdfUrl },
          { label: `📄 Xem Lại Báo Giá (${q.quote_code})`, action: "view_pdf", payload: signedDocumentUrl("quotation", q.quote_code) }
        ],
        quoteData: { contractCode, quoteCode: q.quote_code, totalAmount: q.total_amount }
      };
    } catch (contractErr: any) {
      return {
        recipientId: senderId,
        messageType: "TEXT",
        text: `⚠️ Lỗi khi soạn hợp đồng: ${contractErr.message}`
      };
    }
  }

  // ==============================================================
  // INTENT 3A: THÊM MỚI KHÁCH HÀNG QUA ZALO
  // Cú pháp: "Thêm KH: [Tên], [Địa chỉ], [SĐT/MST], [Người liên hệ]"
  // ==============================================================
  const isAddCustomer = 
    lowerText.startsWith("thêm kh") ||
    lowerText.startsWith("them kh") ||
    lowerText.startsWith("tạo kh") ||
    lowerText.startsWith("tao kh") ||
    lowerText.startsWith("thêm khách hàng") ||
    lowerText.startsWith("them khach hang") ||
    lowerText.startsWith("tạo khách hàng") ||
    lowerText.startsWith("tao khach hang");

  if (isAddCustomer) {
    let payload = rawText
      .replace(/^(?:thêm|them|tạo|tao)\s*(?:khách\s*hàng|khach\s*hang|kh)\s*[:\-]?\s*/i, "")
      .trim();

    if (!payload) {
      return {
        recipientId: senderId,
        messageType: "TEXT",
        text: `📋 HƯỚNG DẪN THÊM KHÁCH HÀNG MỚI QUA ZALO:
Soạn tin nhắn theo cú pháp:
"Thêm KH: [Tên khách hàng], [Địa chỉ], [SĐT hoặc MST], [Người liên hệ]"

💡 Ví dụ:
Thêm KH: Bệnh Viện Ung Bướu, 47 Nguyễn Huy Lượng Quận Bình Thạnh TP.HCM, 02838433021, Bác sĩ Trưởng Khoa Xét Nghiệm`
      };
    }

    const parts = payload.split(/[,;\n]+/).map(p => p.trim()).filter(Boolean);
    let rawCustName = parts[0] || "";
    if (rawCustName.length < 2) {
      return {
        recipientId: senderId,
        messageType: "TEXT",
        text: `⚠️ Tên khách hàng không hợp lệ. Vui lòng nhập rõ tên bệnh viện / khách hàng.\nVí dụ: "Thêm KH: Bệnh Viện Hùng Vương, 128 Hồng Bàng Q5, 02838558510"`
      };
    }

    let cleanName = rawCustName
      .replace(/^bv\s+/i, "Bệnh Viện ")
      .replace(/^pk\s+/i, "Phòng Khám ")
      .replace(/^tt\s+/i, "Trung Tâm ")
      .replace(/^cty\s+/i, "Công Ty ")
      .trim();
    cleanName = cleanName.split(/\s+/).map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");

    try {
      const existCheck = await query(
        "SELECT customer_code, name FROM sales_customers WHERE name ILIKE $1 LIMIT 1",
        [`%${cleanName}%`]
      );
      if (existCheck.rows.length > 0) {
        const ec = existCheck.rows[0];
        return {
          recipientId: senderId,
          messageType: "TEXT",
          text: `ℹ️ KHÁCH HÀNG NÀY ĐÃ TỒN TẠI TRÊN PHẦN MỀM!

🏢 Tên khách hàng: ${ec.name}
🏷 Mã khách hàng: ${ec.customer_code}

👉 Bạn có thể yêu cầu soạn báo giá ngay cho khách hàng này:
"Báo giá ${ec.name}: 2 bộ HI-612, ck 0%"`
        };
      }

      let address = "";
      let phoneOrTax = "";
      let contactPerson = "";

      for (let i = 1; i < parts.length; i++) {
        const part = parts[i];
        if (/^[0-9.\-\s]{8,15}$/.test(part)) {
          phoneOrTax = part.replace(/\s+/g, "");
        } else if (/(?:bác\s*sĩ|bs|dr|dược\s*sĩ|ds|anh|chị|ông|bà|trưởng\s*khoa)/i.test(part) || (i === parts.length - 1 && part.length < 35 && !/(?:đường|quận|huyện|phường|tp|tỉnh)/i.test(part))) {
          contactPerson = part;
        } else {
          if (!address) {
            address = part;
          } else {
            address += `, ${part}`;
          }
        }
      }

      const isTaxCode = phoneOrTax.length === 10 || phoneOrTax.length === 13 || phoneOrTax.length === 14;
      const taxCode = isTaxCode ? phoneOrTax : null;
      const phone = !isTaxCode && phoneOrTax ? phoneOrTax : null;

      const salesRepName = senderBinding?.display_name || senderName || "Bùi Lê Phương Quân (NVKD)";
      const salesRepId = senderBinding?.employee_id || "KD-01";
      const brandPrefix = BASE_APP_URL.includes("via") ? "VIA" : "TBR";
      const newCustomerCode = `KH-${brandPrefix}-${Date.now().toString().slice(-4)}`;
      const isHospital = /(?:bệnh\s*viện|viện|phòng\s*khám|trung\s*tâm|cdc)/i.test(cleanName);
      const classification = isHospital ? "Bệnh viện / Cơ sở Y tế" : "Khách hàng trực tiếp";

      await query(
        `INSERT INTO sales_customers (
          customer_code, name, address, phone, tax_code, contact_person,
          sales_rep_id, sales_rep_name, classification, payment_terms, credit_limit, credit_term_days, customer_type
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          newCustomerCode,
          cleanName,
          address || "Chưa cập nhật địa chỉ",
          phone,
          taxCode,
          contactPerson || null,
          salesRepId,
          salesRepName,
          classification,
          "Thanh toán 30 ngày",
          100000000,
          30,
          "END_USER"
        ]
      );

      return {
        recipientId: senderId,
        messageType: "TEXT",
        text: `✅ ĐÃ THÊM MỚI KHÁCH HÀNG THÀNH CÔNG VÀO HỆ THỐNG!

🏢 Tên khách hàng: ${cleanName}
🏷 Mã khách hàng: ${newCustomerCode}
📍 Địa chỉ: ${address || "Chưa cập nhật"}
📞 SĐT / MST: ${phone || taxCode || "Chưa cập nhật"}
👤 Người liên hệ: ${contactPerson || "Chưa cập nhật"}
👨‍💼 NVKD quản lý: ${salesRepName}

👉 BẠN CÓ THỂ LẬP BÁO GIÁ CHO KHÁCH HÀNG NÀY NGAY BÂY GIỜ:
Soạn tin: "Báo giá ${cleanName}: [Số lượng] [Mã sản phẩm], ck [X]%"
(Ví dụ: Báo giá ${cleanName}: 2 bộ HI-612, ck 0%)`
      };
    } catch (addErr: any) {
      return {
        recipientId: senderId,
        messageType: "TEXT",
        text: `⚠️ Lỗi khi thêm khách hàng: ${addErr.message}`
      };
    }
  }

  // ==============================================================
  // INTENT 3B: TRA CỨU KHÁCH HÀNG TRÊN PHẦN MỀM
  // Cú pháp: "Khách hàng [Tên/Mã/SĐT/MST]" hoặc "Tra cứu KH [Tên]"
  // ==============================================================
  const isCustomerLookup = 
    !isAddCustomer && (
      lowerText.startsWith("khách hàng") ||
      lowerText.startsWith("khach hang") ||
      lowerText.startsWith("tra cứu kh") ||
      lowerText.startsWith("tra cuu kh") ||
      lowerText.startsWith("check kh") ||
      lowerText.startsWith("tìm kh") ||
      lowerText.startsWith("tim kh") ||
      lowerText.startsWith("kiểm tra kh") ||
      lowerText.startsWith("kiem tra kh") ||
      lowerText.startsWith("kh ") ||
      lowerText.startsWith("kh-") ||
      lowerText.startsWith("kh:")
    );

  if (isCustomerLookup) {
    let qCust = rawText
      .replace(/^(?:tra\s*cứu|tra\s*cuu|kiểm\s*tra|kiem\s*tra|check|tìm|tim)?\s*(?:khách\s*hàng|khach\s*hang|kh)\s*[:\-]?\s*/i, "")
      .trim();

    if (!qCust) {
      return {
        recipientId: senderId,
        messageType: "TEXT",
        text: `🔍 Vui lòng nhập tên khách hàng, mã khách hàng, mã số thuế hoặc số điện thoại cần tra cứu.

💡 Ví dụ:
• Khách hàng Bệnh Viện Chợ Rẫy
• KH BV Ung Bướu
• Check KH 0314892019
• Tra cứu KH Viện Pasteur`
      };
    }

    let normalizedCust = qCust
      .replace(/^bv\s+/i, "Bệnh Viện ")
      .replace(/^pk\s+/i, "Phòng Khám ")
      .replace(/^tt\s+/i, "Trung Tâm ")
      .replace(/^cty\s+/i, "Công Ty ")
      .trim();
    
    let coreCust = qCust
      .replace(/^(?:bệnh\s*viện|benh\s*vien|bv|phòng\s*khám|phong\s*kham|pk|trung\s*tâm|trung\s*tam|tt|công\s*ty|cong\s*ty|cty|viện|vien)\s+/i, "")
      .trim();

    try {
      const custRes = await query(
        `SELECT * FROM sales_customers 
         WHERE name ILIKE $1 
            OR name ILIKE $2 
            OR name ILIKE $3
            OR customer_code ILIKE $1 
            OR phone ILIKE $1 
            OR tax_code ILIKE $1 
            OR contact_person ILIKE $1
         ORDER BY id DESC LIMIT 5`,
        [`%${qCust}%`, `%${normalizedCust}%`, `%${coreCust || qCust}%`]
      );

      if (custRes.rows.length === 0) {
        const suggestedName = normalizedCust.split(/\s+/).map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
        return {
          recipientId: senderId,
          messageType: "TEXT",
          text: `🔍 KẾT QUẢ TRA CỨU:
Không tìm thấy thông tin khách hàng nào khớp với từ khóa "${qCust}" trên phần mềm!

❓ BẠN CÓ MUỐN NHẬP / TẠO MỚI KHÁCH HÀNG NÀY VÀO HỆ THỐNG KHÔNG?

📋 HƯỚNG DẪN NHẬP KHÁCH HÀNG MỚI QUA ZALO:
Soạn tin nhắn theo cú pháp:
"Thêm KH: [Tên khách hàng], [Địa chỉ], [SĐT hoặc MST], [Người liên hệ]"

💡 Ví dụ:
Thêm KH: ${suggestedName}, 128 Hồng Bàng Phường 12 Quận 5 TP.HCM, 02838558510, Bác sĩ Trưởng Khoa Xét Nghiệm

👉 SAU KHI THÊM, BẠN CÓ THỂ YÊU CẦU BÁO GIÁ NGAY:
Soạn: "Báo giá ${suggestedName}: 2 bộ HI-612, ck 0%"`
        };
      }

      const custListText = custRes.rows.map((c: any, idx: number) => {
        const creditFmt = new Intl.NumberFormat("vi-VN").format(parseFloat(c.credit_limit || 100000000));
        return `${idx + 1}. [${c.customer_code}] ${c.name}
   • Phân loại: ${c.classification || "Khách hàng trực tiếp"}
   • Địa chỉ: ${c.address || "Chưa cập nhật địa chỉ"}
   • MST / ĐT: ${c.tax_code || "Chưa có MST"} | ${c.phone || "Chưa có SĐT"}
   • Người liên hệ: ${c.contact_person || "Chưa cập nhật"} ${c.contact_position ? `(${c.contact_position})` : ""}
   • NVKD phụ trách: ${c.sales_rep_name || "Chưa phân công"}
   • Hạn mức công nợ: ${creditFmt} VNĐ (Thời hạn TT: ${c.credit_term_days || 30} ngày)`;
      }).join("\n\n");

      const topCust = custRes.rows[0];

      return {
        recipientId: senderId,
        messageType: "TEXT",
        text: `🏢 THÔNG TIN KHÁCH HÀNG TÌM THẤY TRÊN HỆ THỐNG:\n\n${custListText}\n\n👉 BẠN CÓ THỂ LẬP BÁO GIÁ CHO KHÁCH HÀNG NÀY NGAY BÂY GIỜ:\nSoạn tin: "Báo giá ${topCust.name}: 2 bộ HI-612, ck 0%"`
      };
    } catch (err: any) {
      return {
        recipientId: senderId,
        messageType: "TEXT",
        text: `⚠️ Lỗi khi tra cứu khách hàng: ${err.message}`
      };
    }
  }

  // ==============================================================
  // INTENT 3: YÊU CẦU SOẠN BÁO GIÁ TỰ ĐỘNG (QUOTATION REQUEST)
  // Cú pháp: "Báo giá [Khách hàng]: [SL] [Mã/Tên], ... [chiết khấu X%]"
  // ==============================================================
  if (
    lowerText.startsWith("báo giá") ||
    lowerText.startsWith("bao gia") ||
    lowerText.startsWith("bg ") ||
    lowerText.includes("soạn báo giá") ||
    lowerText.includes("soan bao gia")
  ) {
    try {
      // 1. Extract Customer Name
      let customerName = "";
      
      // Case A: With colon, e.g. "báo giá BV Chợ Rẫy: 10 kit..."
      const colonMatch = rawText.match(/(?:báo\s*giá|bao\s*gia|bg)\s+(?:cho\s+)?([^:]+):/i);
      if (colonMatch && colonMatch[1].trim()) {
        customerName = colonMatch[1].trim();
      }

      // Case B: Without colon, e.g. "báo giá bv chợ rẫy 2 bộ hi-612, ck 0%"
      if (!customerName) {
        const noColonMatch = rawText.match(/(?:báo\s*giá|bao\s*gia|bg)\s+(?:cho\s+)?(bv\s+[^\d,:]+|bệnh\s*viện\s+[^\d,:]+|pk\s+[^\d,:]+|phòng\s*khám\s+[^\d,:]+|tt\s+[^\d,:]+|trung\s*tâm\s+[^\d,:]+|công\s*ty\s+[^\d,:]+|[a-zà-ỹ\s]+?)(?=\s+\d|\s+ck|\s+chiết|$)/i);
        if (noColonMatch && noColonMatch[1].trim()) {
          const cand = noColonMatch[1].trim();
          if (cand.length >= 3 && !['cho', 'cần', 'gửi', 'xin'].includes(cand.toLowerCase())) {
            customerName = cand;
          }
        }
      }

      if (customerName) {
        customerName = customerName
          .replace(/^bv\s+/i, "Bệnh Viện ")
          .replace(/^pk\s+/i, "Phòng Khám ")
          .replace(/^tt\s+/i, "Trung Tâm ")
          .replace(/^cty\s+/i, "Công Ty ")
          .trim();
        customerName = customerName.split(/\s+/).map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
      } else {
        customerName = "Bệnh Viện Đa Khoa (Chưa chỉ định)";
      }

      // Check if customer exists in sales_customers
      let customerExists = false;
      let matchedCustName = customerName;
      if (customerName && customerName !== "Bệnh Viện Đa Khoa (Chưa chỉ định)") {
        try {
          const coreC = customerName.replace(/^(?:bệnh\s*viện|bv|phòng\s*khám|pk|trung\s*tâm|tt|công\s*ty|cty|viện)\s+/i, "").trim();
          const cCheck = await query(
            `SELECT customer_code, name FROM sales_customers 
             WHERE name ILIKE $1 OR name ILIKE $2 OR customer_code ILIKE $1 LIMIT 1`,
            [`%${customerName}%`, `%${coreC || customerName}%`]
          );
          if (cCheck.rows.length > 0) {
            customerExists = true;
            matchedCustName = cCheck.rows[0].name;
            customerName = matchedCustName;
          }
        } catch (e) {}
      }

      // 2. Extract Discount Rate (%)
      let discountRate = 0;
      const discountMatch = rawText.match(/(?:chiết khấu|chiet khau|ck)\s*([0-9.]+)\s*%/i) || rawText.match(/([0-9.]+)\s*%\s*(?:chiết khấu|ck)/i);
      if (discountMatch) {
        discountRate = parseFloat(discountMatch[1]);
      }

      // 3. Search and extract items
      // Load current products from DB
      const prodsRes = await query("SELECT * FROM products ORDER BY id ASC");
      const dbProducts = prodsRes.rows;

      const itemsList: Array<any> = [];

      // Match dynamically against ALL products in PostgreSQL database
      for (const p of dbProducts) {
        const pCode = (p.code || "").trim();
        const pName = (p.name || "").trim();
        if (!pCode) continue;

        // Check code match or clean code match
        const codeMatch = lowerText.includes(pCode.toLowerCase());
        const cleanCode = pCode.toLowerCase().replace(/[^a-z0-9]/g, "");
        const cleanMatch = cleanCode.length >= 4 && lowerText.replace(/[^a-z0-9]/g, "").includes(cleanCode);

        // Check name keywords (length >= 4)
        const nameKeywords = pName.toLowerCase().split(/[\s,()/-]+/).filter((w: string) => w.length >= 4 && !['kiem', 'đoán', 'loại', 'thương', 'mại', 'bộ', 'hộp', 'máy'].includes(w));
        const nameMatch = nameKeywords.some((k: string) => lowerText.includes(k));

        if (codeMatch || cleanMatch || nameMatch) {
          let qty = 1;
          const reBefore = new RegExp(`(\\d+)\\s*(?:hộp|bộ|máy|cái|chai|gói)?\\s*(?:${pCode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, "i");
          const reAfter = new RegExp(`(?:${pCode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})\\s*(?:x\\s*|:\\s*)?(\\d+)`, "i");

          const mB = rawText.match(reBefore);
          const mA = rawText.match(reAfter);

          if (mB && parseInt(mB[1])) {
            qty = parseInt(mB[1]);
          } else if (mA && parseInt(mA[1])) {
            qty = parseInt(mA[1]);
          }

          const unitPrice = parseFloat(p.standard_price) || 0;
          itemsList.push({
            productCode: p.code,
            product_code: p.code,
            sku: p.code,
            code: p.code,
            productName: p.name,
            product_name: p.name,
            name: p.name,
            quantity: qty,
            qty,
            unit: p.unit || "Hộp",
            price: unitPrice,
            unitPrice: unitPrice,
            unit_price: unitPrice,
            total: unitPrice * qty,
            amount: unitPrice * qty,
            specification: p.specification || "",
            manufacturer: p.manufacturer || "ABT"
          });
        }
      }

      // If no recognized products matched, notify the user with existing SKU suggestions
      if (itemsList.length === 0) {
        const sampleSkus = dbProducts.slice(0, 5).map((p: any) => `• ${p.code}: ${p.name}`).join("\n");
        return {
          recipientId: senderId,
          messageType: "TEXT",
          text: `⚠️ CHƯA NHẬN DIỆN ĐƯỢC MÃ HÀNG CẦN BÁO GIÁ

Vui lòng ghi rõ mã sản phẩm của TBRs trong tin nhắn.
Ví dụ:
• "Báo giá BV Bạch Mai: 10 SQH-115, 2 EQ-EXTRACT-32, ck 12%"
• "Báo giá BV Chợ Rẫy: 20 EXS-021, 5 CS-TIP-FILTER, ck 5%"

📋 Một số mã sản phẩm hiện có trong hệ thống:
${sampleSkus}

👉 Bạn có thể gõ "Tồn kho" để tra cứu toàn bộ danh mục sản phẩm và tồn kho.`
        };
      }

      // Calculate totals
      const subtotal = itemsList.reduce((acc, it) => acc + it.total, 0);
      const discountAmount = Math.round((subtotal * discountRate) / 100);
      const afterDiscount = subtotal - discountAmount;
      const taxRate = 8; // 8% VAT
      const taxAmount = Math.round((afterDiscount * taxRate) / 100);
      const totalAmount = afterDiscount + taxAmount;

      // Determine approval status based on Director Discount Threshold!
      const requiresDirectorApproval = discountRate >= config.director_discount_threshold;
      const quoteCode = `BG-TBR-${new Date().getFullYear().toString().slice(-2)}${(new Date().getMonth() + 1).toString().padStart(2, "0")}-${Date.now().toString().slice(-4)}`;
      const status = requiresDirectorApproval ? "PENDING_DIRECTOR_APPROVAL" : "APPROVED";
      const salesRepName = senderBinding?.display_name || senderName || "Bùi Lê Phương Quân (NVKD)";

      // Insert into sales_quotations
      const vnToday = todayVN();
      await query(
        `INSERT INTO sales_quotations (
          quote_code, customer_name, sales_rep_name, date, valid_until, items,
          subtotal, discount_rate, discount_amount, tax_rate, tax_amount, total_amount, status, terms
        ) VALUES ($1, $2, $3, $4::date, ($4::date + INTERVAL '30 days')::date, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          quoteCode,
          customerName,
          salesRepName,
          vnToday,
          JSON.stringify(itemsList),
          subtotal,
          discountRate,
          discountAmount,
          taxRate,
          taxAmount,
          totalAmount,
          status,
          "Báo giá có hiệu lực trong vòng 30 ngày kể từ ngày ban hành. Giao hàng tận nơi."
        ]
      );

      const subtotalFmt = new Intl.NumberFormat("vi-VN").format(subtotal);
      const discountFmt = new Intl.NumberFormat("vi-VN").format(discountAmount);
      const vatFmt = new Intl.NumberFormat("vi-VN").format(taxAmount);
      const totalFmt = new Intl.NumberFormat("vi-VN").format(totalAmount);

      const itemsText = itemsList
        .map((it, idx) => `  ${idx + 1}. ${it.name}\n     • Mã SKU: ${it.sku} | Số lượng: ${it.qty} ${it.unit}\n     • Đơn giá: ${new Intl.NumberFormat("vi-VN").format(it.price)} đ ➔ ${new Intl.NumberFormat("vi-VN").format(it.total)} đ`)
        .join("\n\n");

      let notExistNotice = "";
      if (!customerExists && customerName !== "Bệnh Viện Đa Khoa (Chưa chỉ định)") {
        notExistNotice = `\n\n💡 Gợi ý: Khách hàng "${customerName}" chưa có trong danh bạ phần mềm.\nBạn có thể lưu vào hệ thống bằng cách gõ: "Thêm KH: ${customerName}, [Địa chỉ], [SĐT], [Người liên hệ]"`;
      }

      let responseText = "";
      if (requiresDirectorApproval) {
        responseText = 
`🔔 BÁO GIÁ ĐÃ ĐƯỢC SOẠN [${quoteCode}]
⚠️ CẢNH BÁO: MỨC CHIẾT KHẤU LỚN (${discountRate}% ≥ ${config.director_discount_threshold}%) CẦN BAN GIÁM ĐỐC PHÊ DUYỆT!

🏥 Đơn vị / Bệnh viện: ${customerName}
👤 NVKD Lập Báo Giá: ${salesRepName}

📦 DANH MỤC HÀNG HÓA:
${itemsText}

-----------------------------------
💵 Tổng tiền trước thuế: ${subtotalFmt} VNĐ
🎁 Chiết khấu (${discountRate}%): -${discountFmt} VNĐ
🧾 Thuế VAT (8%): +${vatFmt} VNĐ
💰 TỔNG THANH TOÁN (BÁO KHÁCH): ${totalFmt} VNĐ

⏳ TRẠNG THÁI: [CHỜ BAN GIÁM ĐỐC DUYỆT]
Hệ thống đã gửi thông báo phê duyệt tới Ban Giám Đốc. Khi Ban Giám Đốc bấm duyệt, hệ thống sẽ kích hoạt cấp file PDF chính thức.${notExistNotice}`;
      } else {
        responseText = 
`📄 ĐÃ SOẠN BÁO GIÁ THÀNH CÔNG [${quoteCode}]
✅ Trạng thái: [ĐÃ PHÊ DUYỆT TỰ ĐỘNG - Mức chiết khấu ${discountRate}% trong định mức]

🏥 Đơn vị / Bệnh viện: ${customerName}
👤 NVKD Lập: ${salesRepName}

📦 DANH MỤC HÀNG HÓA:
${itemsText}

-----------------------------------
💵 Tổng tiền trước thuế: ${subtotalFmt} VNĐ
${discountRate > 0 ? `🎁 Chiết khấu (${discountRate}%): -${discountFmt} VNĐ\n` : ""}🧾 Thuế VAT (8%): +${vatFmt} VNĐ
💰 TỔNG THANH TOÁN: ${totalFmt} VNĐ

📎 Đường link xem & tải PDF báo giá:
${signedDocumentUrl("quotation", quoteCode)}${notExistNotice}`;
      }

      return {
        recipientId: senderId,
        messageType: requiresDirectorApproval ? "APPROVAL_REQUEST" : "CARD",
        text: responseText,
        buttons: requiresDirectorApproval
          ? [
              { label: `✅ DUYỆT ${quoteCode}`, action: "approve", payload: `Duyệt ${quoteCode}` },
              { label: `❌ TỪ CHỐI ${quoteCode}`, action: "reject", payload: `Từ chối ${quoteCode}` }
            ]
          : [
              { label: "📥 Xem & Tải PDF Báo Giá", action: "view_pdf", payload: signedDocumentUrl("quotation", quoteCode) },
              { label: "📜 Soạn Hợp Đồng", action: "create_contract", payload: `Hợp đồng ${quoteCode}` }
            ],
        quoteData: { quoteCode, customerName, totalAmount, discountRate, status }
      };
    } catch (e: any) {
      return {
        recipientId: senderId,
        messageType: "TEXT",
        text: `Lỗi khi xử lý báo giá: ${e.message}`
      };
    }
  }

  // ==============================================================
  // INTENT 4: TRA CỨU TỒN KHO & HẠN DÙNG THỰC TẾ (FEFO)
  // Cú pháp: "Tồn kho [Mã SKU/Tên]" hoặc "Check kho ..."
  // ==============================================================
  const isInventoryQuery = 
    lowerText.includes("tồn kho") || 
    lowerText.includes("ton kho") || 
    lowerText.includes("tra cứu kho") || 
    lowerText.includes("tra cuu kho") || 
    lowerText.includes("check kho") || 
    lowerText.includes("kiểm tra kho") || 
    lowerText.includes("kiem tra kho") || 
    lowerText.startsWith("kho ");

  if (isInventoryQuery) {
    let qTerm = rawText
      .replace(/^(?:tra\s*cứu|tra\s*cuu|kiểm\s*tra|kiem\s*tra|check|tìm|tim)?\s*(?:tồn\s*kho|ton\s*kho|kho)?\s*(?:mã|ma|sku)?\s*/i, "")
      .replace(/(?:tồn\s*kho|ton\s*kho)/gi, "")
      .trim()
      .toUpperCase()
      .replace(/^[:\-\s]+/, "").trim();

    // Query real inventory_items joined with products using LEFT JOIN
    let invQuery = `
      SELECT i.*, COALESCE(p.name, i.product_name, i.product_code) as product_name, 
             p.standard_price, COALESCE(p.unit, 'Hộp') as unit, p.specification, p.category
      FROM inventory_items i
      LEFT JOIN products p ON i.product_code = p.code
    `;
    const params: any[] = [];
    if (qTerm && qTerm !== "TẤT CẢ" && qTerm !== "ALL") {
      invQuery += ` WHERE i.product_code ILIKE $1 OR COALESCE(p.name, i.product_name, '') ILIKE $1 OR i.lot_number ILIKE $1 OR i.shelf_position ILIKE $1`;
      params.push(`%${qTerm}%`);
    }
    invQuery += ` ORDER BY i.expiry_date ASC NULLS LAST LIMIT 10`;

    try {
      const invRes = await query(invQuery, params);

      if (invRes.rows.length === 0) {
        // Fallback: check in products table if item exists in catalog
        const prodCheck = await query(
          `SELECT code, name, unit, standard_price, specification, category 
           FROM products 
           WHERE code ILIKE $1 OR name ILIKE $1 
           LIMIT 5`,
          [`%${qTerm}%`]
        );

        if (prodCheck.rows.length > 0) {
          const prodList = prodCheck.rows.map((p: any, i: number) => {
            const priceFmt = new Intl.NumberFormat("vi-VN").format(parseFloat(p.standard_price || 0));
            return `${i + 1}. [${p.code}] ${p.name}\n   • Tồn khả dụng: 0 ${p.unit || "Hộp"} (Hiện chưa có lô nhập kho thực tế)\n   • Giá tiêu chuẩn: ${priceFmt} VNĐ\n   • Quy cách: ${p.specification || "Tiêu chuẩn"}`;
          }).join("\n\n");

          return {
            recipientId: senderId,
            messageType: "TEXT",
            text: `📦 KẾT QUẢ TRA CỨU DANH MỤC SẢN PHẨM:\n\n${prodList}\n\n👉 Sản phẩm có trong danh mục nhưng hiện tại chưa có lô tồn khả dụng trong kho.`
          };
        }

        return {
          recipientId: senderId,
          messageType: "TEXT",
          text: `🔍 KẾT QUẢ TRA CỨU TỒN KHO: Không tìm thấy sản phẩm nào khớp với từ khóa "${qTerm || "tồn kho"}".\n\n👉 Vui lòng kiểm tra lại mã SKU (Ví dụ: HI-612, HI-007.A, SQH-115, SQH-116...) hoặc gõ "Tồn kho" để tra cứu.`
        };
      }

      const itemsText = invRes.rows.map((row: any, i: number) => {
        const expDate = row.expiry_date ? new Date(row.expiry_date).toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }) : "Chưa có HSD";
        const availableQty = (row.quantity_on_hand || 0) - (row.quantity_allocated || 0);
        return `${i + 1}. [${row.product_code}] ${row.product_name}
   • Tồn khả dụng: ${availableQty} ${row.unit || "Hộp"} (Đang giữ chỗ: ${row.quantity_allocated || 0})
   • Số Lô: ${row.lot_number || "Chưa có Lô"} • HSD: ${expDate} (FEFO)
   • Vị trí lưu kho: ${row.shelf_position || "Kệ chính"} (${row.warehouse_location || "Kho TBRs"})`;
      }).join("\n\n");

      return {
        recipientId: senderId,
        messageType: "TEXT",
        text: `📦 KẾT QUẢ TRA CỨU TỒN KHO & HẠN DÙNG THỰC TẾ (FEFO):\n\n${itemsText}`
      };
    } catch (invErr: any) {
      console.warn("Inventory query error in Zalo Engine:", invErr);
      return {
        recipientId: senderId,
        messageType: "TEXT",
        text: `⚠️ Lỗi khi tra cứu dữ liệu kho: ${invErr?.message || "Hệ thống cơ sở dữ liệu tạm thời bận."}`
      };
    }
  }

  // ==============================================================
  // INTENT 5: GIỮ CHỖ TỒN KHO KHẨN CẤP (DYNAMIC RESERVATION)
  // Cú pháp: "Giữ chỗ [SL] [Mã] cho [Khách hàng]"
  // ==============================================================
  if (lowerText.startsWith("giữ chỗ") || lowerText.startsWith("giu cho") || lowerText.startsWith("reserve")) {
    try {
      // 1. Extract Customer Name
      let customerName = "Bệnh Viện (Chưa chỉ định)";
      const custMatch = rawText.match(/(?:cho\s+)([^0-9]+?)(?:\s+\d+|\s+48h|$)/i);
      if (custMatch && custMatch[1].trim()) {
        customerName = custMatch[1].trim();
      }

      // 2. Extract SKU and Quantity dynamically
      const prodsRes = await query("SELECT code, name, unit FROM products");
      let matchedItem: any = null;
      let requestedQty = 1;

      for (const p of prodsRes.rows) {
        if (lowerText.includes(p.code.toLowerCase())) {
          matchedItem = p;
          const reQty = new RegExp(`(\\d+)\\s*(?:hộp|bộ|máy|cái)?\\s*${p.code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, "i");
          const m = rawText.match(reQty);
          if (m && parseInt(m[1])) {
            requestedQty = Math.max(1, parseInt(m[1]));
          }
          break;
        }
      }

      if (!matchedItem) {
        const sampleSkus = prodsRes.rows.slice(0, 5).map((p: any) => `• ${p.code}: ${p.name}`).join("\n");
        return {
          recipientId: senderId,
          messageType: "TEXT",
          text: `⚠️ CHƯA NHẬN DIỆN ĐƯỢC MÃ SẢN PHẨM (SKU) CẦN GIỮ CHỖ!\n\nVui lòng cung cấp đúng mã sản phẩm hiện có trong danh mục. Ví dụ:\n"Giữ chỗ 10 SQH-115 cho BV Bạch Mai"\n\n📋 Một số mã sản phẩm hiện có:\n${sampleSkus}`
        };
      }

      const reservationCode = `RES-${Date.now().toString().slice(-6)}`;
      const expiresAt = new Date(Date.now() + 48 * 3600 * 1000);
      const reservedBy = senderBinding?.display_name || senderName;

      const txResult = await withTransaction(async (tx) => {
        const invRes = await tx.query(
          `SELECT id, quantity_on_hand, COALESCE(quantity_allocated, 0) AS quantity_allocated
             FROM inventory_items
            WHERE product_code = $1
            ORDER BY (quantity_on_hand - COALESCE(quantity_allocated, 0)) DESC, id ASC
            FOR UPDATE`,
          [matchedItem.code]
        );
        const itemRow = invRes.rows[0];
        const available = itemRow ? Number(itemRow.quantity_on_hand || 0) - Number(itemRow.quantity_allocated || 0) : 0;
        if (!itemRow || available < requestedQty) {
          return { ok: false as const, available: Math.max(0, available) };
        }

        await tx.query(
          `INSERT INTO inventory_reservations (
             reservation_code, order_code, product_code, product_name,
             quantity, reserved_by, customer_name, status, expires_at, notes
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'ACTIVE', $8, $9)`,
          [
            reservationCode,
            `ZALO-${reservationCode}`,
            matchedItem.code,
            matchedItem.name,
            requestedQty,
            reservedBy,
            customerName,
            expiresAt,
            "Giữ chỗ khẩn cấp 48h qua Zalo OA"
          ]
        );

        await tx.query(
          `UPDATE inventory_items
              SET quantity_allocated = COALESCE(quantity_allocated, 0) + $1,
                  last_updated = CURRENT_TIMESTAMP
            WHERE id = $2`,
          [requestedQty, itemRow.id]
        );

        return { ok: true as const, available };
      });

      if (!txResult.ok) {
        return {
          recipientId: senderId,
          messageType: "TEXT",
          text: `⚠️ TỒN KHO KHẢ DỤNG KHÔNG ĐỦ ĐỂ GIỮ CHỖ!\n\n• Sản phẩm: [${matchedItem.code}] ${matchedItem.name}\n• Số lượng yêu cầu giữ chỗ: ${requestedQty} ${matchedItem.unit || "Hộp"}\n• Tồn khả dụng hiện tại: ${txResult.available} ${matchedItem.unit || "Hộp"}\n\nVui lòng kiểm tra lại tồn kho hoặc liên hệ bộ phận Kho Vận / Mua Hàng.`
        };
      }

      return {
        recipientId: senderId,
        messageType: "TEXT",
        text: `🔒 ĐÃ TẠO LỆNH GIỮ CHỖ TỒN KHO THÀNH CÔNG! [${reservationCode}]

📋 Khách hàng: ${customerName}
📦 Mặt hàng: ${requestedQty} ${matchedItem.unit} ${matchedItem.name} (${matchedItem.code})
⏱ Thời gian giữ chỗ: 48 giờ (Hiệu lực đến: ${expiresAt.toLocaleTimeString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh",hour: '2-digit', minute:'2-digit'})} ngày ${expiresAt.toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })})
👤 NVKD Giữ Chỗ: ${reservedBy}

Hệ thống đã tự động cộng số lượng ${requestedQty} ${matchedItem.unit} vào mục giữ chỗ của kho, đảm bảo không bị xuất nhầm cho đơn vị khác.`
      };
    } catch (e: any) {
      return {
        recipientId: senderId,
        messageType: "TEXT",
        text: `Lỗi xử lý giữ chỗ tồn kho: ${e.message}`
      };
    }
  }

  // ==============================================================
  // INTENT 6: NỘP BÁO CÁO NHẬT KÝ NGÀY (DAILY LOG)
  // Cú pháp: "Daily: [Nội dung]"
  // ==============================================================
  if (lowerText.startsWith("daily:") || lowerText.startsWith("daily ") || lowerText.startsWith("nhật ký:")) {
    const logContent = rawText.replace(/^(?:daily:|daily\s+|nhật ký:)\s*/i, "").trim();

    try {
      const vnToday = todayVN();
      await query(
        `INSERT INTO sales_daily_logs (log_date, employee_code, employee_name, work_content, result, issues, next_day_plan)
         VALUES ($1::date, $2, $3, $4, $5, '', $6)`,
        [
          vnToday,
          senderBinding?.employee_id || "KD-01",
          senderBinding?.display_name || senderName,
          logContent || "Báo cáo tiến độ thị trường qua Zalo",
          "Đã hoàn thành công tác ngày",
          "Tiếp tục triển khai theo kế hoạch tuần"
        ]
      );

      return {
        recipientId: senderId,
        messageType: "TEXT",
        text: `📝 ĐÃ GHI NHẬN BÁO CÁO NHẬT KÝ NGÀY (DAILY)!

👤 Nhân sự: ${senderBinding?.display_name || senderName} (${senderBinding?.department || "Kinh Doanh"})
📅 Ngày báo cáo: ${new Date().toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}
📋 Nội dung: "${logContent}"

Dữ liệu đã tự động đồng bộ vào mục [Nhật Ký Daily] trên Portal và thông báo cho Trưởng phòng xem xét chỉ đạo.`
      };
    } catch (e: any) {
      return {
        recipientId: senderId,
        messageType: "TEXT",
        text: `Lỗi ghi nhận nhật ký: ${e.message}`
      };
    }
  }

  // ==============================================================
  // INTENT 7: TRA CỨU TÀI LIỆU KỸ THUẬT & CO/CQ
  // Cú pháp: "Tài liệu [Mã]" hoặc "CO CQ [Mã]"
  // ==============================================================
  if (lowerText.startsWith("tài liệu") || lowerText.startsWith("tai lieu") || lowerText.includes("co cq") || lowerText.includes("catalog")) {
    const docTerm = rawText
      .replace(/^(?:tra\s*cứu|tra\s*cuu|xem|xin)?\s*(?:tài\s*liệu|tai\s*lieu|co\s*cq|catalog)\s*[:\-]?\s*/i, "")
      .trim();
    try {
      const pRes = docTerm
        ? await query(
            `SELECT code, name, category, unit, origin, packaging_spec, specification, manufacturer
               FROM products
              WHERE code ILIKE $1 OR name ILIKE $1
              ORDER BY id ASC LIMIT 5`,
            [`%${docTerm}%`]
          )
        : await query(
            `SELECT code, name, category, unit, origin, packaging_spec, specification, manufacturer
               FROM products
              ORDER BY id ASC LIMIT 5`
          );

      if (pRes.rows.length === 0) {
        return {
          recipientId: senderId,
          messageType: "TEXT",
          text: `📚 TRA CỨU HỒ SƠ KỸ THUẬT & PHÁP LÝ:\nKhông tìm thấy sản phẩm khớp với từ khóa "${docTerm}". Vui lòng nhập đúng mã SKU (ví dụ: "Tài liệu SQH-115") hoặc truy cập phân hệ [Quản Lý Tài Liệu ISO] trên Portal để tải IFU / CO / CQ chính thức.`
        };
      }

      const docsList = pRes.rows.map((p: any, idx: number) => {
        const spec = p.packaging_spec || p.specification || "Theo tiêu chuẩn NSX";
        const orig = p.origin || p.manufacturer || "Việt Nam";
        return `${idx + 1}. [${p.code}] ${p.name}\n   • Nhóm hàng: ${p.category || "Sinh phẩm / Thiết bị Y tế"} | ĐVT: ${p.unit || "Hộp"}\n   • Quy cách đóng gói: ${spec}\n   • Hãng / Xuất xứ: ${orig}\n   • Hồ sơ pháp lý: Đạt chuẩn ISO 13485:2016 (Tải bản PDF CO/CQ & IFU theo lô tại phân hệ Kho / Tài liệu ISO trên Portal)`;
      }).join("\n\n");

      return {
        recipientId: senderId,
        messageType: "TEXT",
        text: `📚 THÔNG TIN KỸ THUẬT & HỒ SƠ SẢN PHẨM TRÊN HỆ THỐNG:\n\n${docsList}`
      };
    } catch (e: any) {
      return {
        recipientId: senderId,
        messageType: "TEXT",
        text: `⚠️ Lỗi khi tra cứu thông tin kỹ thuật sản phẩm: ${e.message}`
      };
    }
  }

  // ==============================================================
  // INTENT DEFAULT: HƯỚNG DẪN SỬ DỤNG / MENU LỆNH NHANH
  // ==============================================================
  return {
    recipientId: senderId,
    messageType: "TEXT",
    text: `👋 XIN CHÀO! ĐÂY LÀ TRỢ LÝ ĐIỀU HÀNH DI ĐỘNG Công ty TNHH Khoa học TBR (ZALO BOT)

Danh sách câu lệnh nhanh hỗ trợ nhân sự và quản lý:

1. 🏢 Tra Cứu Khách Hàng:
   Gõ: "Khách hàng BV Chợ Rẫy" hoặc "Check KH 0314892019"
   (Nếu chưa có, bot sẽ hỏi và hướng dẫn nhập khách hàng mới ngay)

2. ➕ Thêm Mới Khách Hàng:
   Gõ: "Thêm KH: BV Ung Bướu, 47 Nguyễn Huy Lượng Bình Thạnh, 02838433021, BS Trưởng Khoa"

3. 📄 Soạn Báo Giá Nhanh:
   Gõ: "Báo giá BV Chợ Rẫy: 20 kit HBV, 2 máy tách chiết 32 mẫu, ck 12%"
   (Nếu chiết khấu ≥ ${config.director_discount_threshold}%, hệ thống sẽ tự động chuyển tiếp Ban Giám Đốc duyệt)

4. 📜 Soạn Hợp Đồng Từ Báo Giá:
   Gõ: "Hợp đồng BG-TBR-2610-9017"
   (Bot sẽ hướng dẫn cung cấp thông tin hoặc tạo hợp đồng gửi lại file PDF chính thức)

5. 📦 Tra Cứu Tồn Kho & Hạn Dùng (FEFO):
   Gõ: "Tồn kho KIT-HBV-100" hoặc "Tồn kho kit HPV"

6. 🔒 Giữ Chỗ Tồn Kho Khẩn Cấp:
   Gõ: "Giữ chỗ 20 KIT-HBV cho BV Chợ Rẫy"

7. 📝 Nộp Báo Cáo Daily Nhanh:
   Gõ: "Daily: Hôm nay demo xong tại BV Chợ Rẫy, mai qua BV Nhi Đồng"

8. 📚 Tra Cứu Tài Liệu Y Tế & CO/CQ:
   Gõ: "Tài liệu TBR-9600" hoặc "CO CQ kit HCV"

9. ✍ Ban Giám Đốc Phê Duyệt:
   Gõ: "Duyệt BG-TBR-XXXX" hoặc bấm nút phê duyệt trực tiếp.`
  };
}

import { query } from "@/backend/db/db";

// In-flight renewal promise to deduplicate concurrent refresh calls
let inFlightRenewalPromise: Promise<any> | null = null;
let lastKnownValidToken: string = "";
let lastTokenRefreshTimestamp: number = 0;

export interface ZaloTokenRenewalResult {
  success: boolean;
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  message?: string;
  error?: any;
}

/**
 * Lấy cấu hình Zalo hiện tại từ Database và App Storage
 */
export async function getZaloConfig() {
  let config: any = {};
  try {
    const cfgRes = await query("SELECT * FROM zalo_config ORDER BY id ASC LIMIT 1");
    if (cfgRes.rows.length > 0) {
      config = cfgRes.rows[0];
    }
  } catch (err) {
    console.warn("[ZaloTokenService] Error reading zalo_config table:", err);
  }

  // Fallback to app_storage if database row is missing or using default placeholders
  if (!config.app_id || config.app_id === "482910481920481") {
    try {
      const storRes = await query("SELECT data FROM app_storage WHERE key = 'zalo_gateway_config'");
      if (storRes.rows.length > 0 && storRes.rows[0].data) {
        config = { ...config, ...storRes.rows[0].data };
      }
    } catch (e) {}
  }

  return config;
}

/**
 * Tự động làm mới Access Token từ Zalo OAuth v4 sử dụng Refresh Token
 */
export async function renewZaloAccessToken(force = false): Promise<ZaloTokenRenewalResult> {
  // Deduplicate concurrent renewal attempts
  if (inFlightRenewalPromise) {
    return inFlightRenewalPromise;
  }

  inFlightRenewalPromise = (async () => {
    try {
      const config = await getZaloConfig();
      const appId = (config.app_id || "").trim();
      const secretKey = (config.secret_key || "").trim();
      const refreshToken = (config.refresh_token || "").trim();

      if (!appId || !secretKey || !refreshToken || refreshToken === "zalo_refresh_token_demo_valid") {
        return {
          success: false,
          message: "Thiếu thông tin xác thực Zalo (App ID, Secret Key, hoặc Refresh Token) để tự động làm mới token."
        };
      }

      console.log(`[ZaloTokenService] 🔄 Đang tự động làm mới Access Token từ Zalo OAuth v4 (App ID: ${appId})...`);

      const bodyParams = new URLSearchParams({
        app_id: appId,
        grant_type: "refresh_token",
        refresh_token: refreshToken
      });

      const res = await fetch("https://oauth.zaloapp.com/v4/oa/access_token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "secret_key": secretKey
        },
        body: bodyParams.toString()
      });

      const data = await res.json();

      if (data.access_token) {
        const newAccessToken = data.access_token;
        const newRefreshToken = data.refresh_token || refreshToken;
        const expiresIn = data.expires_in || 90000;

        // Lưu token mới vào DB
        await query(
          `UPDATE zalo_config SET
            access_token = $1,
            refresh_token = $2,
            updated_at = CURRENT_TIMESTAMP
           WHERE id = (SELECT id FROM zalo_config ORDER BY id ASC LIMIT 1)`,
          [newAccessToken, newRefreshToken]
        );

        // Cập nhật app_storage
        const updatedCfg = {
          ...config,
          access_token: newAccessToken,
          refresh_token: newRefreshToken,
          updated_at: new Date().toISOString()
        };

        await query(
          `INSERT INTO app_storage (key, data, updated_at)
           VALUES ('zalo_gateway_config', $1::jsonb, NOW())
           ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
          [JSON.stringify(updatedCfg)]
        ).catch(() => {});

        lastKnownValidToken = newAccessToken;
        lastTokenRefreshTimestamp = Date.now();

        console.log(`[ZaloTokenService] ✅ Tự động làm mới Access Token thành công! Thời hạn: ${Math.round(expiresIn / 3600)}h`);

        return {
          success: true,
          access_token: newAccessToken,
          refresh_token: newRefreshToken,
          expires_in: expiresIn,
          message: `Đã tự động làm mới Access Token thành công từ Zalo OAuth v4.`
        };
      } else {
        console.error("[ZaloTokenService] ❌ Zalo từ chối cấp token mới:", data);
        return {
          success: false,
          error: data,
          message: `Zalo từ chối cấp token (${data.error || data.error_name}): ${data.error_description || data.message || 'Secret Key hoặc Refresh Token không hợp lệ'}`
        };
      }
    } catch (err: any) {
      console.error("[ZaloTokenService] ❌ Lỗi kết nối khi làm mới token:", err);
      return {
        success: false,
        message: "Lỗi kết nối máy chủ OAuth Zalo: " + err.message
      };
    } finally {
      inFlightRenewalPromise = null;
    }
  })();

  return inFlightRenewalPromise;
}

/**
 * Kiểm tra xem token có cần làm mới trước khi sử dụng không (Chủ động làm mới nếu token > 20 giờ tuổi)
 */
export async function getValidZaloAccessToken(maxAgeHours = 20): Promise<string> {
  const config = await getZaloConfig();
  const currentToken = (config.access_token || "").trim();

  if (!currentToken || currentToken === "zalo_access_token_demo_valid") {
    return "";
  }

  // Kiểm tra thời điểm cập nhật lần cuối
  let tokenAgeHours = 0;
  if (config.updated_at) {
    const updatedAt = new Date(config.updated_at).getTime();
    tokenAgeHours = (Date.now() - updatedAt) / (1000 * 60 * 60);
  } else if (lastTokenRefreshTimestamp > 0) {
    tokenAgeHours = (Date.now() - lastTokenRefreshTimestamp) / (1000 * 60 * 60);
  }

  // Nếu token đã được tạo quá maxAgeHours (mặc định 20 giờ, Zalo token hết hạn sau 25 giờ)
  // và có Refresh Token hợp lệ thì chủ động refresh trước khi gửi tin!
  const hasRefreshToken = config.refresh_token && config.refresh_token !== "zalo_refresh_token_demo_valid";
  if (tokenAgeHours >= maxAgeHours && hasRefreshToken) {
    console.log(`[ZaloTokenService] ⏰ Token đã qua ${tokenAgeHours.toFixed(1)} giờ tuổi, chủ động làm mới trước khi gọi API...`);
    const renewRes = await renewZaloAccessToken();
    if (renewRes.success && renewRes.access_token) {
      return renewRes.access_token;
    }
  }

  return currentToken;
}

/**
 * Gửi tin nhắn chăm sóc khách hàng (CS) qua Zalo OpenAPI v3
 * TỰ ĐỘNG LÀM MỚI TOKEN VÀ RETRY NẾU GẶP MÃ LỖI TOKEN HẾT HẠN (-216, -210, -124, 401)
 */
export async function sendZaloCustomerServiceMessage(params: {
  recipientId: string;
  text: string;
  senderName?: string;
}): Promise<{
  success: boolean;
  status: string;
  replyData?: any;
  error?: string;
  renewed?: boolean;
}> {
  const { recipientId, text, senderName = "ABT OA Gateway" } = params;

  if (!recipientId || !text) {
    return { success: false, status: "FAILED_INVALID_PARAMS", error: "Missing recipientId or text" };
  }

  let token = await getValidZaloAccessToken();

  if (!token || token === "zalo_access_token_demo_valid") {
    console.warn("[ZaloTokenService] Chưa có Access Token hợp lệ để gửi tin.");
    await query(
      `INSERT INTO zalo_message_logs (zalo_user_id, sender_name, direction, message_type, content, status)
       VALUES ($1, $2, 'OUTBOUND', 'TEXT', $3, 'FAILED_NO_TOKEN')`,
      [recipientId, senderName, text]
    ).catch(() => {});

    return { success: false, status: "FAILED_NO_TOKEN", error: "Chưa cấu hình Access Token chính thức" };
  }

  const callZaloApi = async (accessToken: string) => {
    return fetch("https://openapi.zalo.me/v3.0/oa/message/cs", {
      method: "POST",
      headers: {
        "access_token": accessToken,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        recipient: { user_id: recipientId },
        message: { text }
      })
    });
  };

  try {
    let zaloReplyRes = await callZaloApi(token);
    let replyData = await zaloReplyRes.json();
    let wasRenewed = false;

    // Kiểm tra xem Zalo có báo lỗi Token hết hạn / không hợp lệ hay không (-216, -210, -124, -204)
    const isTokenExpiredError = replyData.error === -216 || replyData.error === -210 || replyData.error === -124;

    if (isTokenExpiredError) {
      console.warn(`[ZaloTokenService] ⚠️ Zalo báo lỗi Token (${replyData.error}: ${replyData.message}). Hệ thống tự động làm mới Access Token ngay lập tức...`);

      const renewRes = await renewZaloAccessToken(true);
      if (renewRes.success && renewRes.access_token) {
        wasRenewed = true;
        token = renewRes.access_token;

        console.log(`[ZaloTokenService] 🔄 Đã có Access Token mới. Đang thử gửi lại tin nhắn cho user ${recipientId}...`);
        zaloReplyRes = await callZaloApi(token);
        replyData = await zaloReplyRes.json();
      } else {
        console.error(`[ZaloTokenService] ❌ Tự động làm mới token thất bại: ${renewRes.message}`);
      }
    }

    const finalStatus = replyData.error === 0
      ? "SENT"
      : `FAILED_${replyData.error}`;

    // Lưu log tin nhắn gửi đi
    await query(
      `INSERT INTO zalo_message_logs (zalo_user_id, sender_name, direction, message_type, content, status)
       VALUES ($1, $2, 'OUTBOUND', 'TEXT', $3, $4)`,
      [recipientId, senderName, text, finalStatus]
    ).catch(() => {});

    return {
      success: replyData.error === 0,
      status: finalStatus,
      replyData,
      renewed: wasRenewed
    };
  } catch (netErr: any) {
    console.error("[ZaloTokenService] ❌ Lỗi kết nối OpenAPI Zalo CS:", netErr);
    await query(
      `INSERT INTO zalo_message_logs (zalo_user_id, sender_name, direction, message_type, content, status)
       VALUES ($1, $2, 'OUTBOUND', 'TEXT', $3, 'FAILED_NETWORK')`,
      [recipientId, senderName, text]
    ).catch(() => {});

    return {
      success: false,
      status: "FAILED_NETWORK",
      error: netErr.message
    };
  }
}

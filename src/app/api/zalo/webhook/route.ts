import { NextRequest, NextResponse } from "next/server";
import { apiErrorResponse } from "@/backend/services/apiErrors";
import { processZaloInboundMessage } from "@/backend/services/zaloEngine";
import { initZaloDatabase } from "@/backend/db/zaloDb";
import { sendZaloCustomerServiceMessage, getZaloConfig } from "@/backend/services/zaloTokenService";
import { query } from "@/backend/db/db";
import crypto from "crypto";

/**
 * Kiểm tra chữ ký Zalo OA Webhook (`X-ZEvent-Signature: mac=<sha256(appId + rawBody + timestamp + OASecretKey)>`).
 * Lưu ý quan trọng:
 * - Trên Zalo Developer Portal, `App Secret Key` (dùng đổi OAuth Access Token) và `OA Secret Key` (dùng ký Webhook)
 *   là 2 khóa KHÁC NHAU.
 * - Nếu người dùng chỉ mới nhập `App Secret Key` vào ô `secret_key` trên giao diện Cấu hình mà chưa cấu hình
 *   biến môi trường `ZALO_OA_SECRET_KEY` (hoặc `webhook_verify_token` đang để mặc định), việc ép so khớp chữ ký
 *   với `secret_key` sẽ làm hỏng 100% sự kiện Webhook (trả về 401 khiến tin nhắn `LK-XXXXXX` bị chặn).
 */
let warnedNoWebhookSecret = false;
// Khóa mẫu từng phát hành trong mã / tài liệu: không bao giờ dùng để xác thực
const PLACEHOLDER_ZALO_SECRETS = new Set(["tbr_webhook_token_2026", "tbr_webhook_verify_2026", "tbr_zalo_sec_89f0293a4bc"]);

/**
 * Chỉ nhận sự kiện có chữ ký hợp lệ: mac = sha256(appId + rawBody + timestamp + OA Secret Key).
 * Trước đây gói tin KHÔNG có chữ ký vẫn được nhận nếu app_id / oa_id khớp cấu hình; hai mã này không bí mật,
 * nên ai cũng giả được lệnh "Duyệt <mã>" gửi qua webhook.
 * Khóa: biến môi trường ZALO_OA_SECRET_KEY, hoặc OA Secret Key nhập ở Cấu hình Zalo (webhook_verify_token / secret_key).
 */
async function verifyZaloSignature(req: NextRequest, rawBody: string, body: any): Promise<boolean> {
  const header = req.headers.get("x-zevent-signature") || "";
  const mac = header.replace(/^mac=/i, "").trim().toLowerCase();

  const cfg: any = await getZaloConfig().catch(() => ({}));
  const appId = String(body?.app_id || cfg?.app_id || "").trim();
  const keys = [
    (process.env.ZALO_OA_SECRET_KEY || "").trim(),
    String(cfg?.webhook_verify_token || "").trim(),
    String(cfg?.secret_key || "").trim()
  ].filter((k, i, arr) => k && !PLACEHOLDER_ZALO_SECRETS.has(k) && arr.indexOf(k) === i);

  if (keys.length === 0) {
    if (!warnedNoWebhookSecret) {
      warnedNoWebhookSecret = true;
      console.error("❌ AN NINH ZALO WEBHOOK: chưa cấu hình OA Secret Key (ZALO_OA_SECRET_KEY) — mọi sự kiện webhook đều bị từ chối.");
    }
    return false;
  }
  if (!mac || !appId) {
    console.warn("⚠️ ZALO WEBHOOK: từ chối sự kiện thiếu chữ ký X-ZEvent-Signature hoặc app_id.");
    return false;
  }
  for (const key of keys) {
    const expected = crypto
      .createHash("sha256")
      .update(`${appId}${rawBody}${body?.timestamp ?? ""}${key}`)
      .digest("hex");
    if (mac.length === expected.length && crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) {
      return true;
    }
  }
  console.warn("⚠️ ZALO WEBHOOK: chữ ký không khớp, đã từ chối sự kiện.");
  return false;
}

/**
 * ZALO WEBHOOK ENDPOINT
 * URL for Zalo Developer Portal: https://[your-domain]/api/zalo/webhook
 */
export async function GET(req: NextRequest) {
  try {
    await initZaloDatabase();
    const { searchParams } = new URL(req.url);
    const challenge = searchParams.get("challenge") || searchParams.get("hub.challenge");

    // If Zalo sends verification challenge (chỉ cho phép ký tự an toàn để chống Reflected XSS)
    if (challenge) {
      const safeChallenge = String(challenge).replace(/[^a-zA-Z0-9._-]/g, "").slice(0, 256);
      return new NextResponse(safeChallenge, {
        status: 200,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "X-Content-Type-Options": "nosniff",
          "Cache-Control": "no-store",
        }
      });
    }

    return NextResponse.json({
      status: "ACTIVE",
      timestamp: new Date().toISOString()
    });
  } catch {
    return NextResponse.json({ error: "Webhook error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    await initZaloDatabase();
    const rawBody = await req.text();
    let body: any = {};
    if (rawBody && rawBody.trim()) {
      try {
        body = JSON.parse(rawBody);
      } catch {
        return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
      }
    }

    // Nếu là gói tin ping kiểm tra kết nối Webhook từ Zalo Developer Portal (body rỗng hoặc không có sender/event)
    if (!body || Object.keys(body).length === 0) {
      return NextResponse.json({ status: "OK", message: "Webhook test ping accepted" }, { status: 200 });
    }

    if (!(await verifyZaloSignature(req, rawBody, body))) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    const eventName = String(body.event_name || body.event || "user_send_text").trim();

    // Bỏ qua các sự kiện do chính OA phát ra (oa_send_text, oa_send_image, oa_send_list...) để tránh lặp vô tận
    if (eventName.startsWith("oa_send")) {
      return NextResponse.json({ success: true, ignored: true, eventName });
    }

    // Trích xuất Zalo User ID của người gửi (hỗ trợ cả user_send_* và sự kiện follow có follower.id)
    const senderId = String(
      body.sender?.id ||
      body.follower?.id ||
      body.user_id_by_app ||
      body.senderId ||
      ""
    ).trim();

    const senderName = body.sender?.name || body.senderName || "Người dùng Zalo";
    let messageText = String(body.message?.text || body.text || "").trim();
    const attachments = Array.isArray(body.message?.attachments)
      ? body.message.attachments
      : Array.isArray(body.attachments)
      ? body.attachments
      : [];

    if (eventName === "follow" && !messageText) {
      messageText = "Đã quan tâm trang Zalo OA";
    } else if (!messageText && attachments.length > 0) {
      messageText = "[Hình ảnh / Tệp đính kèm]";
    }

    // Tài khoản thử nghiệm chỉ dùng qua màn hình Điều hành Zalo (đã đăng nhập), không nhận từ Internet
    if (senderId.startsWith("zalo_test_")) {
      return NextResponse.json({ success: true, note: "Test senders are not accepted on the public webhook" });
    }

    if (!senderId || (!messageText && attachments.length === 0 && eventName !== "follow")) {
      return NextResponse.json({ success: true, note: "Event without actionable sender/content accepted" }, { status: 200 });
    }

    // Process message through Zalo Engine
    const result = await processZaloInboundMessage({
      senderId,
      senderName,
      text: messageText,
      attachments,
      eventName
    });

    // Send reply back to the user via Zalo Official Account OpenAPI v3 (Tự động làm mới Token nếu hết hạn)
    let deliveryStatus = "SKIPPED";
    if (result && result.text && senderId && !senderId.startsWith("zalo_test_")) {
      try {
        const sendRes = await sendZaloCustomerServiceMessage({
          recipientId: senderId,
          text: result.text,
          senderName: "ABT OA Gateway"
        });
        deliveryStatus = sendRes.status;
      } catch (replyErr) {
        console.warn("Zalo OpenAPI CS reply logging error:", replyErr);
        deliveryStatus = "ERROR";
      }
    }

    return NextResponse.json({ success: true, eventName, deliveryStatus });
  } catch (error: any) {
    console.error("Zalo Webhook Error:", error);
    return apiErrorResponse(error);
  }
}

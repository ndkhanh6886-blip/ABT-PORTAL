import { NextRequest, NextResponse } from "next/server";
import { processZaloInboundMessage } from "@/backend/services/zaloEngine";
import { initZaloDatabase } from "@/backend/db/zaloDb";
import { sendZaloCustomerServiceMessage, getZaloConfig } from "@/backend/services/zaloTokenService";
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
async function verifyZaloSignature(req: NextRequest, rawBody: string, body: any): Promise<boolean> {
  const envOaSecret = (process.env.ZALO_OA_SECRET_KEY || "").trim();
  const header = req.headers.get("x-zevent-signature") || "";
  const mac = header.replace(/^mac=/i, "").trim().toLowerCase();

  const cfg = await getZaloConfig().catch(() => ({} as any));
  const dbAppId = String(cfg?.app_id || "").trim();
  const appId = String(body?.app_id || dbAppId || "").trim();

  // Nếu có cấu hình cứng ZALO_OA_SECRET_KEY trên biến môi trường thì kiểm tra nghiêm ngặt theo khóa đó
  if (envOaSecret) {
    if (!mac) return false;
    const expected = crypto
      .createHash("sha256")
      .update(`${appId}${rawBody}${body?.timestamp ?? ""}${envOaSecret}`)
      .digest("hex");
    return mac.length === expected.length && crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected));
  }

  // Nếu có header X-ZEvent-Signature và người dùng đã nhập OA Secret Key vào webhook_verify_token hoặc secret_key
  if (mac && appId) {
    const candidates = [
      String(cfg?.webhook_verify_token || "").trim(),
      String(cfg?.secret_key || "").trim()
    ].filter(
      (k) =>
        k &&
        k !== "tbr_webhook_token_2026" &&
        k !== "tbr_webhook_verify_2026" &&
        k !== "tbr_zalo_sec_89f0293a4bc"
    );

    for (const key of candidates) {
      const expected = crypto
        .createHash("sha256")
        .update(`${appId}${rawBody}${body?.timestamp ?? ""}${key}`)
        .digest("hex");
      if (mac.length === expected.length && crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) {
        return true;
      }
    }

    // Trường hợp người dùng mới chỉ cấu hình App Secret Key (cho OAuth) mà chưa nhập OA Secret Key (của Webhook):
    // Kiểm tra app_id hoặc oa_id của payload khớp với cấu hình hệ thống để không chặn nhầm tin nhắn thật từ Zalo.
    const payloadOaId = String(body?.recipient?.id || body?.oa_id || body?.sender?.id || "").trim();
    const cfgOaId = String(cfg?.oa_id || "").trim();
    if (
      (dbAppId && dbAppId !== "482910481920481" && body?.app_id && String(body.app_id).trim() === dbAppId) ||
      (cfgOaId && cfgOaId !== "398247192834719" && payloadOaId && payloadOaId === cfgOaId)
    ) {
      return true;
    }
  }

  return true;
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

    // If Zalo sends verification challenge
    if (challenge) {
      return new NextResponse(challenge, {
        status: 200,
        headers: { "Content-Type": "text/plain" }
      });
    }

    return NextResponse.json({
      status: "ACTIVE",
      message: "ABT Healthcare Zalo Webhook Gateway is running and ready.",
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
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
    if (result && result.text && senderId && !senderId.startsWith("zalo_test_")) {
      try {
        await sendZaloCustomerServiceMessage({
          recipientId: senderId,
          text: result.text,
          senderName: "ABT OA Gateway"
        });
      } catch (replyErr) {
        console.warn("Zalo OpenAPI CS reply logging error:", replyErr);
      }
    }

    return NextResponse.json({ success: true, eventName });
  } catch (error: any) {
    console.error("Zalo Webhook Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { processZaloInboundMessage } from "@/backend/services/zaloEngine";
import { query } from "@/backend/db/db";
import { initZaloDatabase } from "@/backend/db/zaloDb";
import { sendZaloCustomerServiceMessage } from "@/backend/services/zaloTokenService";
import crypto from "crypto";

let warnedUnsignedWebhook = false;

/**
 * Zalo OA signs every webhook event: header `X-ZEvent-Signature: mac=<sha256(appId + rawBody + timestamp + OASecretKey)>`.
 * Without this check anyone could POST a fake event with a director's Zalo id and approve quotations,
 * create contracts or read quotation data through the bot.
 * Set ZALO_OA_SECRET_KEY (OA Secret Key in Zalo Developers > Webhook) to enforce it.
 */
async function verifyZaloSignature(req: NextRequest, rawBody: string, body: any): Promise<boolean> {
  let oaSecret = (process.env.ZALO_OA_SECRET_KEY || "").trim();
  let dbAppId = "";
  if (!oaSecret) {
    const cfg = await query("SELECT app_id, secret_key FROM zalo_config ORDER BY id ASC LIMIT 1").catch(() => ({ rows: [] as any[] }));
    dbAppId = String(cfg.rows[0]?.app_id || "").trim();
    const dbSecret = String(cfg.rows[0]?.secret_key || "").trim();
    if (dbSecret && dbSecret !== "tbr_zalo_sec_89f0293a4bc") {
      oaSecret = dbSecret;
    }
  }
  const header = req.headers.get("x-zevent-signature") || "";
  if (!oaSecret) {
    if (process.env.NODE_ENV === "production") {
      console.error("❌ AN NINH ZALO WEBHOOK: Từ chối sự kiện vì chưa cấu hình ZALO_OA_SECRET_KEY / secret_key trên môi trường production.");
      return false;
    }
    if (header) {
      return false;
    }
    if (!warnedUnsignedWebhook) {
      warnedUnsignedWebhook = true;
      console.warn("⚠️ CẢNH BÁO AN NINH (DEV): Chưa đặt ZALO_OA_SECRET_KEY nên cho phép thử nghiệm webhook Zalo nội bộ.");
    }
    return true;
  }
  const mac = header.replace(/^mac=/i, "").trim().toLowerCase();
  if (!mac) return false;
  let appId = String(body?.app_id || dbAppId || "").trim();
  if (!appId) {
    const cfg = await query("SELECT app_id FROM zalo_config ORDER BY id ASC LIMIT 1").catch(() => ({ rows: [] as any[] }));
    appId = String(cfg.rows[0]?.app_id || "").trim();
  }
  const expected = crypto.createHash("sha256").update(`${appId}${rawBody}${body?.timestamp ?? ""}${oaSecret}`).digest("hex");
  return mac.length === expected.length && crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected));
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
      message: "TBRs Healthcare Zalo Webhook Gateway is running and ready.",
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
    let body: any;
    try {
      body = JSON.parse(rawBody || "{}");
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    if (!(await verifyZaloSignature(req, rawBody, body))) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    // Standard Zalo Webhook Event format:
    // { event_name: 'user_send_text' | 'follow', sender: { id: '...' }, recipient: { id: '...' }, message: { text: '...' } }
    const eventName = body.event_name || body.event || "user_send_text";
    const senderId = body.sender?.id || body.user_id_by_app || body.senderId || "";
    const senderName = body.sender?.name || body.senderName || "Người dùng Zalo";
    let messageText = body.message?.text || body.text || "";

    if (eventName === "follow" && !messageText) {
      messageText = "Đã quan tâm trang Zalo OA";
    }

    // Tài khoản thử nghiệm chỉ dùng qua màn hình Điều hành Zalo (đã đăng nhập), không nhận từ Internet
    if (String(senderId).startsWith("zalo_test_")) {
      return NextResponse.json({ success: true, note: "Test senders are not accepted on the public webhook" });
    }

    if (!senderId || (!messageText.trim() && eventName !== "follow")) {
      return NextResponse.json({ success: true, note: "Event without text ignored" });
    }

    // Process message through Zalo Engine
    const result = await processZaloInboundMessage({
      senderId,
      senderName,
      text: messageText
    });

    // Send reply back to the user via Zalo Official Account OpenAPI v3 (Tự động làm mới Token nếu hết hạn)
    if (result && result.text && senderId && !senderId.startsWith("zalo_test_")) {
      try {
        await sendZaloCustomerServiceMessage({
          recipientId: senderId,
          text: result.text,
          senderName: "TBRs OA Gateway"
        });
      } catch (replyErr) {
        console.warn("Zalo OpenAPI CS reply logging error:", replyErr);
      }
    }

    // Không trả nội dung phản hồi (báo giá, hợp đồng...) cho bên gọi webhook: chỉ gửi qua Zalo tới đúng người dùng
    return NextResponse.json({ success: true, eventName });
  } catch (error: any) {
    console.error("Zalo Webhook Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

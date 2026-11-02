import { NextRequest, NextResponse } from "next/server";
import { query, logAudit } from "@/backend/db/db";
import crypto from "crypto";
import { initZaloDatabase, syncPersonnelToZaloBindings, clearMockZaloData } from "@/backend/db/zaloDb";
import { processZaloInboundMessage, getPendingApprovalsSummaryForZalo, generateZaloMorningDigest } from "@/backend/services/zaloEngine";
import { renewZaloAccessToken, getValidZaloAccessToken, sendZaloCustomerServiceMessage } from "@/backend/services/zaloTokenService";

export const dynamic = "force-dynamic";
export const revalidate = 0;

import { getAuthorizedUser, isAdminUser, unauthorizedResponse, forbiddenResponse, setAuditActor } from "@/backend/services/authz";
import { hasPermission } from "@/backend/services/permissions";

const SECRET_FIELDS = ["secret_key", "access_token", "refresh_token", "webhook_verify_token"];
const MASK = "••••••";

/** Secrets of the Zalo OA are never sent to the browser in clear (only the last 4 characters). */
function maskConfig(config: any) {
  const out = { ...(config || {}) };
  for (const f of SECRET_FIELDS) {
    const v = String(out[f] || "");
    out[f] = v ? `${MASK}${v.slice(-4)}` : "";
  }
  return out;
}

/** A masked value sent back unchanged by the settings form means "keep the stored secret". */
function unmasked(v: any) {
  const s = String(v ?? "");
  return s.startsWith(MASK) ? "" : s;
}

export async function GET(req: NextRequest) {
  try {
    await initZaloDatabase();
    const { searchParams } = new URL(req.url);
    const action = searchParams.get("action") || "overview";
    const me = await getAuthorizedUser(req);
    setAuditActor(me);
    if (!me) return unauthorizedResponse();
    if (!isAdminUser(me) && !hasPermission(me, "zalo.view")) return forbiddenResponse();

    if (action === "overview") {
      // Proactively check and refresh token if older than 20 hours
      try {
        await getValidZaloAccessToken(20);
      } catch (e) {
        console.warn("[ZaloConfig] Proactive token check error:", e);
      }

      // 1. Config
      let cfgRes = await query("SELECT * FROM zalo_config ORDER BY id ASC LIMIT 1");
      let config = cfgRes.rows[0] || {};

      // Kiểm tra đồng bộ từ app_storage nếu cấu hình database chưa có hoặc đang là demo cũ
      if (!config.app_id || config.app_id === "482910481920481") {
        try {
          const storRes = await query("SELECT data FROM app_storage WHERE key = 'zalo_gateway_config'");
          if (storRes.rows.length > 0 && storRes.rows[0].data) {
            config = { ...config, ...storRes.rows[0].data };
          }
        } catch (e) {}
      }

      // 2. User Bindings (Ordered by Department and Employee ID)
      const bindRes = await query(`
        SELECT * FROM zalo_user_bindings 
        ORDER BY 
          CASE 
            WHEN department = 'Ban Giám Đốc' THEN 1
            WHEN department = 'Kinh Doanh' THEN 2
            WHEN department = 'Kho Vận' THEN 3
            WHEN department = 'Kỹ Thuật & Ứng Dụng' THEN 4
            WHEN department = 'Mua Hàng & Cung Ứng' THEN 5
            WHEN department = 'Pháp Chế' THEN 6
            WHEN department = 'Kế Toán' THEN 7
            WHEN department = 'Marketing' THEN 8
            ELSE 9
          END,
          employee_id ASC,
          id ASC
      `);
      const bindings = bindRes.rows;

      // Stats
      const total = bindings.length;
      const connectedCount = bindings.filter((b: any) => b.connection_status === "CONNECTED").length;
      const pendingCount = bindings.filter((b: any) => b.connection_status === "PENDING_ZALO").length;
      const noPhoneCount = bindings.filter((b: any) => b.connection_status === "NO_PHONE").length;

      // 3. Pending Approvals across all modules (Quotations, SO 0đ/Credit, Proposals/DXNP, PO, RMA)
      const threshold = parseFloat(config.director_discount_threshold) || 10.0;
      const multiApprovals = await getPendingApprovalsSummaryForZalo(threshold);
      const pendingApprovals = multiApprovals.quotations;

      // 4. Recent Message Logs
      const logsRes = await query("SELECT * FROM zalo_message_logs ORDER BY id DESC LIMIT 50");
      const logs = logsRes.rows;

      return new NextResponse(
        JSON.stringify({
          config: maskConfig(config),
          bindings,
          stats: {
            total,
            connectedCount,
            pendingCount,
            noPhoneCount
          },
          pendingApprovals,
          multiApprovals,
          logs
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
            "Pragma": "no-cache",
            "Expires": "0"
          }
        }
      );
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error: any) {
    console.error("Zalo Config GET Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    await initZaloDatabase();
    const body = await req.json();
    const { action } = body;

    const me = await getAuthorizedUser(req);
    setAuditActor(me);
    if (!me) return unauthorizedResponse();
    // test_chat chạy bot dưới danh nghĩa một nhân sự (thao tác thật trên dữ liệu) nên chỉ dành cho quản trị viên
    const ADMIN_ACTIONS = ["update_config", "save_binding", "update_employee_zalo", "sync_personnel", "clear_mock_data", "renew_token", "test_chat"];
    if (ADMIN_ACTIONS.includes(action) && !isAdminUser(me)) {
      return forbiddenResponse("Chỉ Quản trị viên mới được thay đổi cấu hình / liên kết Zalo.");
    }
    if (
      action === "director_action" &&
      !isAdminUser(me) &&
      !hasPermission(me, "sales.approve_discount") &&
      !hasPermission(me, "sales.approve_quotes") &&
      !hasPermission(me, "sales.approve_zero_price") &&
      !hasPermission(me, "sales.approve_orders") &&
      !hasPermission(me, "sales.approve_credit") &&
      !hasPermission(me, "procurement.approve_po")
    ) {
      return forbiddenResponse("Chỉ Ban Giám Đốc hoặc nhân sự được phân quyền phê duyệt mới thực hiện được thao tác này.");
    }

    // Mã liên kết Zalo dùng một lần (30 phút): mỗi nhân viên tự tạo cho chính mình, quản trị viên tạo hộ được.
    // Nhắn mã này cho Zalo OA là cách DUY NHẤT để liên kết tài khoản Zalo với hồ sơ nhân sự.
    if (action === "create_link_code") {
      const requested = String(body.employee_id || "").trim();
      let bindingRes;
      if (requested && isAdminUser(me)) {
        bindingRes = await query("SELECT id, employee_id, display_name FROM zalo_user_bindings WHERE employee_id = $1 LIMIT 1", [requested]);
      } else {
        bindingRes = await query(
          `SELECT id, employee_id, display_name FROM zalo_user_bindings
            WHERE employee_id = $1 OR employee_id = REPLACE(REPLACE($1, 'ABT', 'NV-ABT-'), 'VIA', 'NV-VIA-')
               OR REPLACE(REPLACE(employee_id, 'NV-ABT-', 'ABT'), 'NV-VIA-', 'VIA') = $1
            LIMIT 1`,
          [me.username]
        );
      }
      const binding = bindingRes.rows[0];
      if (!binding) {
        return NextResponse.json({ error: "Chưa có hồ sơ Zalo cho nhân sự này. Quản trị viên cần bấm \"Đồng bộ nhân sự\" trong Điều hành Zalo trước." }, { status: 404 });
      }
      const code = `LK-${crypto.randomBytes(4).toString("hex").toUpperCase().slice(0, 6)}`;
      await query(
        "UPDATE zalo_user_bindings SET link_code_hash = $1, link_code_expires = NOW() + INTERVAL '30 minutes', updated_at = CURRENT_TIMESTAMP WHERE id = $2",
        [crypto.createHash("sha256").update(code).digest("hex"), binding.id]
      );
      await logAudit("ZALO_LINK_CODE", "ZALO", `Tạo mã liên kết Zalo cho ${binding.display_name} (${binding.employee_id})`);
      return NextResponse.json({ success: true, code, employee_id: binding.employee_id, display_name: binding.display_name, expires_in_minutes: 30 });
    }

    if (!isAdminUser(me) && !hasPermission(me, "zalo.view")) return forbiddenResponse();

    // 1. Update Config (App ID, Secret Key, OA ID, Discount Threshold)
    if (action === "update_config") {
      const {
        oa_id,
        oa_name,
        app_id,
        secret_key,
        access_token,
        refresh_token,
        webhook_verify_token,
        director_discount_threshold,
        director_phone,
        director_zalo_id
      } = body;

      const upRes = await query(
        `UPDATE zalo_config SET 
          oa_id = COALESCE(NULLIF($1, ''), oa_id),
          oa_name = COALESCE(NULLIF($2, ''), oa_name),
          app_id = COALESCE(NULLIF($3, ''), app_id),
          secret_key = COALESCE(NULLIF($4, ''), secret_key),
          access_token = COALESCE(NULLIF($5, ''), access_token),
          refresh_token = COALESCE(NULLIF($6, ''), refresh_token),
          webhook_verify_token = COALESCE(NULLIF($7, ''), webhook_verify_token),
          director_discount_threshold = COALESCE($8, director_discount_threshold),
          director_phone = COALESCE(NULLIF($9, ''), director_phone),
          director_zalo_id = COALESCE($10, director_zalo_id),
          updated_at = CURRENT_TIMESTAMP
        WHERE id = (SELECT id FROM zalo_config ORDER BY id ASC LIMIT 1)`,
        [
          oa_id,
          oa_name,
          app_id,
          unmasked(secret_key),
          unmasked(access_token),
          unmasked(refresh_token),
          unmasked(webhook_verify_token),
          director_discount_threshold,
          director_phone,
          director_zalo_id
        ]
      );

      if (upRes.rowCount === 0) {
        await query(
          `INSERT INTO zalo_config (
            oa_id, oa_name, app_id, secret_key, access_token, refresh_token,
            webhook_verify_token, director_discount_threshold, director_phone, director_zalo_id
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            oa_id || "125246484401171420",
            oa_name || "Công ty TNHH Giải pháp Y sinh ABT",
            app_id || "",
            secret_key || "",
            access_token || "",
            refresh_token || "",
            webhook_verify_token || "tbr_webhook_token_2026",
            director_discount_threshold || 10.00,
            director_phone || "0916033652",
            director_zalo_id || ""
          ]
        );
      }

      const finalCfgRes = await query("SELECT * FROM zalo_config ORDER BY id ASC LIMIT 1");
      const savedConfig = finalCfgRes.rows[0] || {};

      // Đồng bộ vào app_storage đảm bảo đa máy chủ / đa phiên đồng bộ 100%
      await query(
        `INSERT INTO app_storage (key, data, updated_at)
         VALUES ('zalo_gateway_config', $1::jsonb, NOW())
         ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
        [JSON.stringify(savedConfig)]
      ).catch(() => {});

      return new NextResponse(
        JSON.stringify({ 
          success: true, 
          message: "Đã cập nhật cấu hình Zalo thành công!", 
          config: maskConfig(savedConfig) 
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "no-store, no-cache, must-revalidate"
          }
        }
      );
    }

    // 2. Add or Update User Binding
    if (action === "save_binding") {
      const { zalo_user_id, phone_number, display_name, user_type, employee_id, department, role } = body;
      await query(
        `INSERT INTO zalo_user_bindings (zalo_user_id, phone_number, display_name, user_type, employee_id, department, role)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (zalo_user_id) 
         DO UPDATE SET phone_number = $2, display_name = $3, user_type = $4, employee_id = $5, department = $6, role = $7`,
        [zalo_user_id, phone_number, display_name, user_type || "EMPLOYEE", employee_id, department, role || "STAFF"]
      );

      return NextResponse.json({ success: true, message: "Đã lưu định danh tài khoản Zalo!" });
    }

    // 3. Director / Approver Approve or Reject any Pending Item (Quotation, SO 0đ/Credit, Proposal DXNP, PO, RMA) directly from Portal
    if (action === "director_action") {
      const { quote_code, target_code, decision, command_override, reason } = body;
      const code = String(target_code || quote_code || "").trim();
      const approver_name = me.full_name || me.username;

      // Find a director binding or current user's binding for processZaloInboundMessage
      const dirBindRes = await query(
        `SELECT employee_id FROM zalo_user_bindings
          WHERE employee_id = $1
             OR LOWER(TRIM(display_name)) = LOWER(TRIM($2))
             OR role = 'DIRECTOR'
          ORDER BY CASE WHEN LOWER(TRIM(display_name)) = LOWER(TRIM($2)) THEN 0 ELSE 1 END, id ASC LIMIT 1`,
        [me.username, approver_name]
      );
      const simEmpId = dirBindRes.rows[0]?.employee_id || "NV-TBR-001";

      const cmdText = command_override
        ? String(command_override)
        : decision === "APPROVE"
        ? `Duyệt ${code}`
        : `Từ chối ${code} ${reason || "Không đồng ý phê duyệt"}`;

      const reply = await processZaloInboundMessage({
        senderId: `portal_approver_${me.username}`,
        senderName: approver_name,
        text: cmdText,
        simulateEmployeeId: simEmpId
      });

      // Log outbound message to notify requester/sales
      await query(
        `INSERT INTO zalo_message_logs (zalo_user_id, sender_name, direction, message_type, content, status)
         VALUES ('system_oa', 'Zalo OA Gateway', 'OUTBOUND', 'APPROVAL', $1, 'SENT')`,
        [reply.text || `${decision === "APPROVE" ? "✅ ĐÃ DUYỆT" : "❌ TỪ CHỐI"} hồ sơ ${code} bởi ${approver_name}.`]
      );

      return NextResponse.json({
        success: true,
        reply,
        message: decision === "APPROVE" ? `✅ Đã phê duyệt ${code} thành công!` : `❌ Đã từ chối ${code}!`
      });
    }

    // 3B. Send Morning Executive Digest (Bản tin Điều hành Đầu ngày)
    if (action === "send_morning_digest") {
      const cfgRes = await query("SELECT director_discount_threshold FROM zalo_config ORDER BY id ASC LIMIT 1");
      const threshold = parseFloat(cfgRes.rows[0]?.director_discount_threshold) || 10.0;
      const digest = await generateZaloMorningDigest(threshold);

      const mgrRes = await query(
        `SELECT display_name, zalo_user_id FROM zalo_user_bindings
          WHERE role IN ('DIRECTOR', 'HEAD_OF_DEPT') OR department = 'Ban Giám Đốc'`
      ).catch(() => ({ rows: [] as any[] }));

      const connectedMgrs = mgrRes.rows.filter(
        (r: any) => r.zalo_user_id && !String(r.zalo_user_id).startsWith("zalo_test_") && !String(r.zalo_user_id).startsWith("portal_sim_")
      );

      if (connectedMgrs.length > 0) {
        for (const m of connectedMgrs) {
          await sendZaloCustomerServiceMessage({
            recipientId: String(m.zalo_user_id),
            text: digest.text,
            senderName: `Bản Tin Sáng ➔ ${m.display_name}`
          }).catch(() => {});
        }
      } else {
        await query(
          `INSERT INTO zalo_message_logs (zalo_user_id, sender_name, direction, message_type, content, status)
           VALUES ('morning_digest_cron', 'Bản Tin Điều Hành Sáng (8:00 AM)', 'OUTBOUND', 'MORNING_DIGEST', $1, 'SENT')`,
          [digest.text]
        ).catch(() => {});
      }

      return NextResponse.json({
        success: true,
        digest,
        message: "☀️ Đã phát Bản tin Điều hành Đầu ngày tới Ban Giám Đốc & các Trưởng bộ phận!"
      });
    }

    // 4. Update Employee Zalo Information (Phone number, Zalo User ID, Notes)
    if (action === "update_employee_zalo") {
      const { id, employee_id, phone_number, zalo_user_id, notes } = body;
      let cleanPhone = (phone_number || "").trim().replace(/[^0-9+]/g, "");
      let cleanZaloId = (zalo_user_id || "").trim();

      // Kiểm tra nếu người dùng vô tình nhập số điện thoại vào ô Zalo User ID
      const isPhoneLike = /^0[0-9]{9,10}$|^84[0-9]{9,10}$|^\+84[0-9]{9,10}$/.test(cleanZaloId);
      if (isPhoneLike) {
        if (!cleanPhone) cleanPhone = cleanZaloId;
        cleanZaloId = "";
      }

      let status = "NO_PHONE";
      if (cleanPhone) {
        status = cleanZaloId ? "CONNECTED" : "PENDING_ZALO";
      }

      await query(
        `UPDATE zalo_user_bindings SET
          phone_number = $1,
          zalo_user_id = $2,
          connection_status = $3,
          is_active = $4,
          notes = $5,
          updated_at = CURRENT_TIMESTAMP
         WHERE id = $6`,
        [cleanPhone || null, cleanZaloId || null, status, status === "CONNECTED", notes || null, id]
      );

      // Update personnel table phone if phone was provided/changed
      if (cleanPhone && employee_id) {
        await query(`UPDATE personnel SET phone = $1 WHERE employee_code = $2`, [cleanPhone, employee_id]);
      }

      return NextResponse.json({
        success: true,
        message: "Đã cập nhật thông tin Zalo cho nhân sự thành công!"
      });
    }

    // 5. Force Sync Real Personnel from personnel Table
    if (action === "sync_personnel") {
      const res = await syncPersonnelToZaloBindings();
      return NextResponse.json({
        success: true,
        message: `Đã làm sạch bản ghi trùng lặp và đồng bộ thành công ${res.count || 0} nhân sự từ danh mục nhân sự thực tế!`,
        count: res.count
      });
    }

    // 6. Clear Mock Simulation Data
    if (action === "clear_mock_data") {
      await clearMockZaloData();
      return NextResponse.json({
        success: true,
        message: "Đã xóa toàn bộ dữ liệu giả lập và đồng bộ danh mục nhân sự thực tế!"
      });
    }

    // 7. Test Chat Simulator
    if (action === "test_chat") {
      const { senderName = "Bùi Lê Phương Quân (NVKD)", text, employee_id } = body;
      const reply = await processZaloInboundMessage({
        senderId: `portal_sim_${me.username}`,
        senderName,
        text,
        simulateEmployeeId: employee_id ? String(employee_id) : undefined
      });
      return NextResponse.json({ success: true, reply });
    }

    // 8. Test Zalo Official Account API Connection
    if (action === "test_connection") {
      const tokenToTest = unmasked(body.access_token).trim();
      const currentToken = tokenToTest || (await query("SELECT access_token FROM zalo_config ORDER BY id ASC LIMIT 1")).rows[0]?.access_token;

      if (!currentToken || currentToken === "zalo_access_token_demo_valid") {
        return NextResponse.json({
          success: false,
          errorCode: -1,
          message: "Chưa có Access Token thực tế từ Zalo Developer. Vui lòng nhập Access Token vào ô trên."
        });
      }

      try {
        const zaloRes = await fetch("https://openapi.zalo.me/v2.0/oa/getoa", {
          method: "GET",
          headers: { access_token: currentToken }
        });
        const zaloData = await zaloRes.json();

        if (zaloData.error === 0) {
          return NextResponse.json({
            success: true,
            oa_info: zaloData.data,
            message: `Kết nối thành công tới Zalo OA: "${zaloData.data?.name || 'Doanh Nghiệp'}" (ID: ${zaloData.data?.oa_id || 'N/A'})`
          });
        } else {
          let advice = "";
          if (zaloData.error === -216 || zaloData.error === -210) {
            advice = "Các nguyên nhân phổ biến:\n" +
              "1. ĐÃ TẠO NHẦM TOKEN: Khi tạo token tại developers.zalo.me/tools/explorer, bạn đã chọn 'User Access Token' thay vì 'OA Access Token' (phải chọn loại OA và tích chọn đúng OA 'Công ty TNHH Giải pháp Y sinh ABT').\n" +
              "2. TOKEN ĐÃ HẾT HẠN HOẶC BỊ THU HỒI: Access Token của Zalo có hạn 25 giờ. Nếu đã có người bấm tạo lại token hoặc dùng Refresh Token, token cũ lập tức bị Zalo vô hiệu hóa.\n" +
              "3. CHƯA LIÊN KẾT APP VỚI OA: Vào developers.zalo.me > Chọn App > Mục Official Account kiểm tra xem App đã được liên kết với OA của công ty hay chưa.\n" +
              "4. COPY THIẾU KÝ TỰ: Chuỗi Access Token rất dài (~400-500 ký tự), hãy đảm bảo bôi đen toàn bộ (Ctrl+A) khi copy.";
          } else if (zaloData.error === -204) {
            advice = "Ứng dụng Zalo chưa được cấp quyền quản trị Official Account này. Hãy vào developers.zalo.me cấp quyền quản trị OA cho App.";
          }

          return NextResponse.json({
            success: false,
            errorCode: zaloData.error,
            zaloMessage: zaloData.message,
            advice,
            message: `Zalo trả về mã lỗi ${zaloData.error}: ${zaloData.message}${advice ? `\n\n💡 NGUYÊN NHÂN & CÁCH XỬ LÝ:\n${advice}` : ''}`
          });
        }
      } catch (err: any) {
        return NextResponse.json({
          success: false,
          errorCode: -999,
          message: `Không thể kết nối máy chủ Zalo OpenAPI: ${err.message}`
        });
      }
    }

    // 9. Renew Access Token using Refresh Token via Zalo OAuth v4
    if (action === "renew_token") {
      const incomingAppId = String(body.app_id || "").trim();
      const incomingSecret = unmasked(body.secret_key).trim();
      const incomingRefresh = unmasked(body.refresh_token).trim();
      if (incomingAppId || incomingSecret || incomingRefresh) {
        await query(
          `UPDATE zalo_config SET
            app_id = COALESCE(NULLIF($1, ''), app_id),
            secret_key = COALESCE(NULLIF($2, ''), secret_key),
            refresh_token = COALESCE(NULLIF($3, ''), refresh_token),
            updated_at = CURRENT_TIMESTAMP
           WHERE id = (SELECT id FROM zalo_config ORDER BY id ASC LIMIT 1)`,
          [incomingAppId, incomingSecret, incomingRefresh]
        );
      }
      const renewRes: any = await renewZaloAccessToken(true);
      // Token mới được lưu ở máy chủ; không gửi nguyên văn về trình duyệt
      const { access_token: _at, refresh_token: _rt, ...safeRes } = renewRes || {};
      return NextResponse.json(safeRes);
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error: any) {
    console.error("Zalo Config POST Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

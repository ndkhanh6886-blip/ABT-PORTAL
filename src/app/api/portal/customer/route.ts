import { NextRequest, NextResponse } from "next/server";
import { query, logAudit } from "@/backend/db/db";
import { createSessionToken, verifySessionToken, sessionCookieOptions } from "@/backend/services/session";
import { getAuthorizedUser, isAdminUser, unauthorizedResponse, forbiddenResponse } from "@/backend/services/authz";
import { hasPermission } from "@/backend/services/permissions";
import { clientIp, hitRateLimit } from "@/backend/services/rateLimit";

/** Public portal endpoints are rate limited per IP (anti-spam / anti-enumeration). */
function tooMany(req: NextRequest, bucket: string, limit: number, windowMs: number) {
  const r = hitRateLimit(`portal:${bucket}:${clientIp(req)}`, limit, windowMs);
  return r.allowed ? null : NextResponse.json({ error: `Quá nhiều yêu cầu. Vui lòng thử lại sau ${Math.ceil(r.retryAfterSec / 60)} phút.` }, { status: 429 });
}

// Phiên của khách hàng (tách biệt hoàn toàn với phiên nhân viên)
const CUSTOMER_COOKIE = "tbrs_customer_session";

async function getCustomerSession(req: NextRequest) {
  const s = await verifySessionToken(req.cookies.get(CUSTOMER_COOKIE)?.value);
  return s && s.role === "customer" ? s : null;
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const action = searchParams.get("action");
    const q = (searchParams.get("query") || "").trim();


    // 1. Tra cứu đơn hàng bảo mật dành riêng cho Khách hàng đã đăng nhập (Order Tracking)
    if (action === "track_orders") {
      // Bảo vệ quyền riêng tư: chỉ dùng danh tính khách hàng đã xác thực (cookie phiên), không tin
      // customer_id / customer_code truyền trên URL (có thể bị dò để xem đơn của viện khác)
      const customerSession = await getCustomerSession(req);
      const customerId = customerSession ? String(customerSession.id) : null;
      const customerCode = customerSession ? customerSession.username.replace(/^customer:/, "") : "";

      if (!customerSession) {
        return NextResponse.json({
          orders: [],
          authenticated: false,
          error: "Vui lòng đăng nhập bằng Mã khách hàng và Số điện thoại để bảo mật thông tin đơn hàng."
        }, { status: 401 });
      }

      // Tra cứu đúng các đơn hàng thuộc về Khách hàng này
      let ordersRes;
      if (q) {
        ordersRes = await query(`
          SELECT so.id, so.order_code, so.customer_name, so.order_date, so.delivery_status, 
                 so.shipping_method, so.tracking_code, so.total_amount, so.items, 
                 so.vat_requested, so.vat_company_name, so.invoiced_delivery_slips
          FROM sales_orders so
          -- Chỉ đơn của đúng khách hàng này: theo customer_id, hoặc đơn cũ chưa gắn id nhưng TRÙNG KHỚP tên
          -- (trước đây so khớp gần đúng ILIKE nên khách "Viện A" xem được đơn của "Viện A - Chi nhánh B")
          LEFT JOIN sales_customers sc ON sc.id = $1
          WHERE (so.customer_id = $1
             OR (so.customer_id IS NULL AND sc.id IS NOT NULL AND LOWER(sc.customer_code) = LOWER($2)
                 AND LOWER(TRIM(so.customer_name)) = LOWER(TRIM(sc.name))))
            AND (so.order_code ILIKE $3 OR so.items::text ILIKE $3)
          ORDER BY so.id DESC
          LIMIT 25
        `, [Number(customerId) || 0, customerCode, `%${q}%`]);
      } else {
        ordersRes = await query(`
          SELECT so.id, so.order_code, so.customer_name, so.order_date, so.delivery_status, 
                 so.shipping_method, so.tracking_code, so.total_amount, so.items, 
                 so.vat_requested, so.vat_company_name, so.invoiced_delivery_slips
          FROM sales_orders so
          -- Chỉ đơn của đúng khách hàng này: theo customer_id, hoặc đơn cũ chưa gắn id nhưng TRÙNG KHỚP tên
          -- (trước đây so khớp gần đúng ILIKE nên khách "Viện A" xem được đơn của "Viện A - Chi nhánh B")
          LEFT JOIN sales_customers sc ON sc.id = $1
          WHERE (so.customer_id = $1
             OR (so.customer_id IS NULL AND sc.id IS NOT NULL AND LOWER(sc.customer_code) = LOWER($2)
                 AND LOWER(TRIM(so.customer_name)) = LOWER(TRIM(sc.name))))
          ORDER BY so.id DESC
          LIMIT 25
        `, [Number(customerId) || 0, customerCode]);
      }

      return NextResponse.json({ authenticated: true, orders: ordersRes.rows });
    }

    // 2. Tra cứu tiến trình xử lý sự cố (Incident Tracking)
    if (action === "track_incident") {
      const code = searchParams.get("incident_code");
      if (!code) {
        return NextResponse.json({ error: "Vui lòng nhập mã sự cố" }, { status: 400 });
      }

      const limited = tooMany(req, "track_incident", 30, 10 * 60 * 1000);
      if (limited) return limited;
      // Tra cứu công khai: khớp ĐÚNG mã sự cố và chỉ trả thông tin tiến độ (không trả SĐT, email,
      // dữ liệu điều tra nội bộ). Trước đây tìm gần đúng nên gõ một ký tự là xem được hồ sơ bất kỳ.
      const cleanCode = code.trim();
      if (cleanCode.length < 6) {
        return NextResponse.json({ error: "Vui lòng nhập đầy đủ mã sự cố" }, { status: 400 });
      }
      const incRes = await query(
        `SELECT incident_code, customer_name, organization, status, resolution_status, created_at, updated_at,
                handled_by, product_name, lot_number, severity, description, attachments
           FROM customer_incidents WHERE UPPER(incident_code) = UPPER($1) LIMIT 1`,
        [cleanCode]
      );

      if (incRes.rows.length === 0) {
        return NextResponse.json({ error: "Không tìm thấy hồ sơ sự cố này" }, { status: 404 });
      }

      return NextResponse.json({ incident: incRes.rows[0] });
    }

    // 3. Lấy danh sách sản phẩm phục vụ form báo cáo sự cố
    if (action === "products_list") {
      const prodRes = await query("SELECT code, name, category, manufacturer FROM products ORDER BY name ASC LIMIT 50");
      return NextResponse.json({ products: prodRes.rows });
    }

    // 4. Lấy danh sách sự cố phục vụ màn hình Application và Ban Đảm Bảo Chất Lượng
    if (action === "list_incidents") {
      if (!(await getAuthorizedUser(req))) return unauthorizedResponse();
      const incRes = await query(`
        SELECT * FROM customer_incidents 
        ORDER BY id DESC 
        LIMIT 200
      `);
      return NextResponse.json({ success: true, incidents: incRes.rows });
    }

    return NextResponse.json({ error: "Hành động GET không hợp lệ" }, { status: 400 });
  } catch (error: any) {
    console.error("Customer Portal API GET error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const action = searchParams.get("action");
    const body = await req.json();

    // 0. Xác thực đăng nhập Khách Hàng (Mã khách hàng & Số điện thoại)
    if (action === "login") {
      const limitedLogin = tooMany(req, "login", 10, 15 * 60 * 1000);
      if (limitedLogin) return limitedLogin;
      const { customer_code, phone } = body;
      const cleanCode = (customer_code || "").trim();
      const cleanPhone = (phone || "").replace(/[\s\-\.]/g, "").trim();

      if (!cleanCode || !cleanPhone || cleanPhone.length < 8) {
        return NextResponse.json(
          { error: "Vui lòng nhập đầy đủ Mã khách hàng và Số điện thoại đăng ký" },
          { status: 400 }
        );
      }

      // Tra cứu bảng sales_customers
      const custRes = await query(
        `SELECT id, customer_code, name, phone, email, tax_code, address
         FROM sales_customers
         WHERE LOWER(TRIM(customer_code)) = LOWER($1)
           AND (
             REPLACE(REPLACE(REPLACE(phone, ' ', ''), '-', ''), '.', '') = $2
             OR RIGHT(REPLACE(REPLACE(REPLACE(phone, ' ', ''), '-', ''), '.', ''), 9) = RIGHT($2, 9)
           )
         LIMIT 1`,
        [cleanCode, cleanPhone]
      );

      if (custRes.rows.length === 0) {
        return NextResponse.json(
          { 
            error: "Mã khách hàng hoặc Số điện thoại không khớp với hồ sơ y tế tại TBRs. Quý Viện vui lòng kiểm tra lại hoặc liên hệ Hotline hỗ trợ." 
          },
          { status: 401 }
        );
      }

      const customer = custRes.rows[0];

      await logAudit(
        "CUSTOMER_LOGIN",
        "Portal_Customer",
        `Khách hàng [${customer.customer_code}] ${customer.name} xác thực thành công qua SĐT ${customer.phone}`,
        customer.customer_code,
        customer.name
      );

      const token = await createSessionToken({
        id: customer.id,
        username: `customer:${customer.customer_code}`,
        role: "customer",
        department: "",
        full_name: customer.name,
      });
      const response = NextResponse.json({
        success: true,
        message: "Xác thực danh tính khách hàng thành công!",
        customer
      });
      response.cookies.set(CUSTOMER_COOKIE, token, sessionCookieOptions(req));
      return response;
    }

    // 1. Khách hàng gửi Đánh giá chất lượng CSAT / NPS (ISO 9001)
    if (action === "submit_feedback") {
      const limitedFb = tooMany(req, "feedback", 10, 60 * 60 * 1000);
      if (limitedFb) return limitedFb;
      const {
        customer_name,
        customer_phone,
        organization,
        order_code,
        nps_score,
        csat_cold_chain,
        csat_delivery,
        csat_product,
        csat_support,
        comments
      } = body;

      if (!customer_name) {
        return NextResponse.json({ error: "Vui lòng nhập họ tên người gửi đánh giá" }, { status: 400 });
      }

      const insertRes = await query(`
        INSERT INTO customer_feedback (
          customer_name, customer_phone, organization, order_code, 
          nps_score, csat_cold_chain, csat_delivery, csat_product, csat_support, comments
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING id
      `, [
        customer_name,
        customer_phone || "",
        organization || "",
        order_code || "",
        Number(nps_score) || 10,
        Number(csat_cold_chain) || 5,
        Number(csat_delivery) || 5,
        Number(csat_product) || 5,
        Number(csat_support) || 5,
        comments || ""
      ]);

      await logAudit("CUSTOMER_FEEDBACK", "PORTAL", `Khách hàng ${customer_name} (${organization || "Đối tác"}) gửi đánh giá dịch vụ (NPS: ${nps_score}/10)`);
      return NextResponse.json({ success: true, feedback_id: insertRes.rows[0]?.id });
    }

    // 2. Khách hàng Báo cáo sự cố chất lượng / cảnh giác y tế (ISO 13485 / MedWatch)
    if (action === "report_incident") {
      const limitedInc = tooMany(req, "report_incident", 10, 60 * 60 * 1000);
      if (limitedInc) return limitedInc;
      const {
        customer_name,
        customer_phone,
        customer_email,
        organization,
        order_code,
        product_code,
        product_name,
        lot_number,
        incident_category,
        incident_categories,
        root_cause_data,
        severity,
        patient_impact,
        instrument_model,
        affected_tests,
        description,
        attachments
      } = body;

      const categoriesList = Array.isArray(incident_categories) && incident_categories.length > 0 
        ? incident_categories 
        : [incident_category || "OTHER"];

      const primaryCategory = categoriesList.join(", ");

      if (!customer_name || !description) {
        return NextResponse.json({ error: "Vui lòng điền đầy đủ các thông tin bắt buộc (*)" }, { status: 400 });
      }

      const currentYear = new Date().getFullYear();
      const randomSuffix = Math.floor(1000 + Math.random() * 9000);
      const incidentCode = `INC-${currentYear}-${randomSuffix}`;

      await query(`
        INSERT INTO customer_incidents (
          incident_code, customer_name, customer_phone, customer_email, organization, 
          order_code, product_code, product_name, lot_number, incident_category, 
          incident_categories, root_cause_data,
          severity, patient_impact, instrument_model, affected_tests, description, attachments, status
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, 'RECEIVED')
      `, [
        incidentCode,
        customer_name,
        customer_phone || "",
        customer_email || "",
        organization || "",
        order_code || "",
        product_code || "",
        product_name || "",
        lot_number || "",
        primaryCategory,
        JSON.stringify(categoriesList),
        JSON.stringify(root_cause_data || {}),
        severity || "MEDIUM",
        patient_impact || "NO_IMPACT",
        instrument_model || "",
        Number(affected_tests) || 1,
        description,
        JSON.stringify(attachments || [])
      ]);

      await logAudit(
        "CUSTOMER_INCIDENT_REPORTED",
        "QUALITY_ALERT",
        `[KHẨN CẤP] Khách hàng ${customer_name} báo cáo sự cố ${incidentCode} (Lô: ${lot_number || "N/A"}, Phân loại: ${primaryCategory}, Mức độ: ${severity})`
      );

      return NextResponse.json({
        success: true,
        incident_code: incidentCode,
        message: "Hệ thống đã tiếp nhận báo cáo sự cố thành công! Đội ngũ Kỹ thuật & QA của TBRs sẽ liên hệ xử lý trong vòng 2 giờ làm việc."
      });
    }

    // 3. Đồng bộ tiến trình xử lý sự cố từ phân hệ Application (2-way sync)
    if (action === "sync_incident_status") {
      const authUser = await getAuthorizedUser(req);
      if (!authUser) return unauthorizedResponse();
      if (!isAdminUser(authUser) && !hasPermission(authUser, "application.view") && !hasPermission(authUser, "quality.view")) {
        return forbiddenResponse("Chỉ bộ phận Kỹ thuật Application / QA hoặc Quản trị viên mới được phép cập nhật tiến trình sự cố.");
      }
      const {
        incident_code,
        status,
        current_step,
        resolution_status,
        handled_by,
        root_cause_conclusion,
        final_customer_solution,
        corrective_actions,
        preventive_actions,
        not_real_issue_reason,
        investigation_details,
        capa_action,
        attachments
      } = body;

      if (!incident_code) {
        return NextResponse.json({ error: "Thiếu mã sự cố (incident_code)" }, { status: 400 });
      }

      // Format composite capa_action if not provided
      let finalCapa = capa_action || "";
      if (!finalCapa && (corrective_actions || preventive_actions || final_customer_solution)) {
        finalCapa = [
          final_customer_solution ? `Giải pháp khách hàng: ${final_customer_solution}` : "",
          corrective_actions ? `Biện pháp khắc phục (Corrective): ${corrective_actions}` : "",
          preventive_actions ? `Biện pháp phòng ngừa (Preventive): ${preventive_actions}` : ""
        ].filter(Boolean).join("\n\n");
      }

      const updateRes = await query(`
        UPDATE customer_incidents
        SET status = COALESCE($1, status),
            current_step = COALESCE($2, current_step),
            resolution_status = COALESCE($3, resolution_status),
            handled_by = COALESCE($4, handled_by),
            root_cause_conclusion = COALESCE($5, root_cause_conclusion),
            final_customer_solution = COALESCE($6, final_customer_solution),
            corrective_actions = COALESCE($7, corrective_actions),
            preventive_actions = COALESCE($8, preventive_actions),
            not_real_issue_reason = COALESCE($9, not_real_issue_reason),
            investigation_details = CASE WHEN $10::text IS NOT NULL THEN $10::jsonb ELSE investigation_details END,
            capa_action = COALESCE($11, capa_action),
            attachments = CASE WHEN $13::text IS NOT NULL THEN $13::jsonb ELSE attachments END,
            updated_at = CURRENT_TIMESTAMP
        WHERE UPPER(incident_code) = UPPER($12)
        RETURNING *
      `, [
        status || null,
        current_step || null,
        resolution_status || null,
        handled_by || null,
        root_cause_conclusion || null,
        final_customer_solution || null,
        corrective_actions || null,
        preventive_actions || null,
        not_real_issue_reason || null,
        investigation_details ? JSON.stringify(investigation_details) : null,
        finalCapa || null,
        incident_code.trim(),
        Array.isArray(attachments) ? JSON.stringify(attachments) : null
      ]);

      await logAudit(
        "APPLICATION_INCIDENT_UPDATED",
        "QUALITY_ALERT",
        `[APPLICATION] Cập nhật sự cố ${incident_code}: Trạng thái ${status || "đang xử lý"}, Bước ${current_step || "N/A"} bởi ${handled_by || "Chuyên viên Application"}`
      );

      return NextResponse.json({
        success: true,
        incident: updateRes.rows[0] || null,
        message: `Đã đồng bộ tiến trình xử lý sự cố ${incident_code} sang Cổng khách hàng thành công!`
      });
    }

    // 4. Tạo sự cố mới từ phân hệ Application và đồng bộ lên CSDL
    if (action === "create_incident_from_app") {
      if (!(await getAuthorizedUser(req))) return unauthorizedResponse();
      const {
        incident_code,
        customer_name,
        customer_phone,
        organization,
        product_code,
        product_name,
        lot_number,
        description,
        handled_by,
        severity,
        attachments
      } = body;

      const code = incident_code || `INC-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;

      const insertRes = await query(`
        INSERT INTO customer_incidents (
          incident_code, customer_name, customer_phone, organization,
          product_code, product_name, lot_number, description,
          severity, status, current_step, resolution_status, handled_by, attachments, incident_category, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'RECEIVED', 'Step1', 'Investigating', $10, $11::jsonb, $12, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        RETURNING *
      `, [
        code,
        customer_name || "Khách hàng y tế",
        customer_phone || "",
        organization || customer_name || "",
        product_code || "",
        product_name || "",
        lot_number || "",
        description || "",
        severity || "MEDIUM",
        handled_by || "Chuyên viên Application",
        JSON.stringify(Array.isArray(attachments) ? attachments : []),
        // cột bắt buộc: thiếu nó thì sự cố tạo từ Application không bao giờ được lưu vào CSDL
        String(body.incident_category || "OTHER")
      ]);

      await logAudit(
        "APPLICATION_INCIDENT_CREATED",
        "QUALITY_ALERT",
        `[APPLICATION] Tạo mới sự cố ${code} cho ${customer_name} (${product_name}, Lô ${lot_number})`
      );

      return NextResponse.json({ success: true, incident: insertRes.rows[0], incident_code: code });
    }

    return NextResponse.json({ error: "Hành động POST không hợp lệ" }, { status: 400 });
  } catch (error: any) {
    console.error("Customer Portal API POST error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

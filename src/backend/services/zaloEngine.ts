import { query, withTransaction } from "@/backend/db/db";
import { initZaloDatabase } from "@/backend/db/zaloDb";
import crypto from "crypto";
import { signedDocumentUrl } from "@/backend/services/documentLinks";
import { todayVN, nowVNDateTime } from "@/backend/services/dates";
import { isAdminUser, isAccountantUser } from "@/backend/services/authz";
import { hasPermission } from "@/backend/services/permissions";
import { sendZaloCustomerServiceMessage } from "@/backend/services/zaloTokenService";
import { addStock, sortByProductCode } from "@/backend/services/inventoryLedger";

export interface ZaloMessageResponse {
  recipientId: string;
  messageType: "TEXT" | "CARD" | "FILE" | "APPROVAL_REQUEST";
  text: string;
  buttons?: Array<{ label: string; action: string; payload: string }>;
  fileUrl?: string;
  quoteData?: any;
}

const BASE_APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://tbr-portal.vn";

const QUOTE_CODE_REGEX = /BG-(?:TBR|VIA|ABT)-[A-Za-z0-9-]+|BG[0-9]{2}-[A-Za-z0-9-]+|BG-[0-9-]+/i;
const SO_CODE_REGEX = /SO[0-9]{2}-[A-Za-z0-9-]+|SO-(?:TBR|VIA|ABT)?-?[A-Za-z0-9-]+/i;
const PO_CODE_REGEX = /PO[0-9]{2}-[A-Za-z0-9-]+|PO-(?:TBR|VIA|ABT)?-?[A-Za-z0-9-]+/i;
const RMA_CODE_REGEX = /RMA[0-9]{2}-[A-Za-z0-9-]+|RMA-(?:TBR|VIA|ABT)?-?[A-Za-z0-9-]+/i;
const DX_CODE_REGEX = /DX(?:NP)?-[0-9]{4,6}-[0-9]{3,6}|DXNP-[A-Za-z0-9-]+/i;
const PX_CODE_REGEX = /PX[0-9]{2}-[A-Za-z0-9-]+|PGH[0-9]{2}-[A-Za-z0-9-]+|PX-[A-Za-z0-9-]+/i;

function fmtVnd(n: any): string {
  return new Intl.NumberFormat("vi-VN").format(Math.round(Number(n) || 0));
}

function parseJsonSafeArray(v: any): any[] {
  if (Array.isArray(v)) return v;
  if (typeof v === "string") {
    try {
      const parsed = JSON.parse(v);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function parseJsonSafeObj(v: any): Record<string, any> {
  if (v && typeof v === "object" && !Array.isArray(v)) return v;
  if (typeof v === "string") {
    try {
      const parsed = JSON.parse(v);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

async function resolvePortalUserForBinding(senderBinding: any): Promise<any | null> {
  const empId = String(senderBinding?.employee_id || "").trim();
  const displayName = String(senderBinding?.display_name || "").trim();
  if (!empId && !displayName) return null;
  try {
    const uRes = await query(
      `SELECT id, username, role, department, full_name, permissions FROM users
        WHERE ($1 <> '' AND (
                username = $1
                OR username = REPLACE(REPLACE(REPLACE($1, 'NV-TBR-', 'TBR'), 'NV-VIA-', 'VIA'), 'NV-ABT-', 'ABT')
              ))
           OR ($2 <> '' AND LOWER(TRIM(full_name)) = LOWER(TRIM($2)))
        ORDER BY id ASC LIMIT 1`,
      [empId, displayName]
    );
    return uRes.rows[0] || null;
  } catch {
    return null;
  }
}

function isDirectorBinding(senderBinding: any, senderId: string, directorZaloId: string): boolean {
  return Boolean(
    senderBinding?.role === "DIRECTOR" ||
    senderBinding?.user_type === "DIRECTOR" ||
    senderBinding?.department === "Ban Giám Đốc" ||
    (directorZaloId && senderId === directorZaloId)
  );
}

async function hasQuotationApprovalAuthority(
  senderBinding: any,
  senderId: string,
  directorZaloId: string,
  isZeroPriceQuote = false
): Promise<boolean> {
  if (isDirectorBinding(senderBinding, senderId, directorZaloId)) return true;
  const u = await resolvePortalUserForBinding(senderBinding);
  if (!u) return false;
  if (isAdminUser(u)) return true;
  if (isZeroPriceQuote && (hasPermission(u, "sales.approve_zero_price") || hasPermission(u, "sales.approve_quotes"))) {
    return true;
  }
  return hasPermission(u, "sales.approve_quotes") || hasPermission(u, "sales.approve_discount");
}

async function hasSpecificApprovalAuthority(
  senderBinding: any,
  senderId: string,
  directorZaloId: string,
  perms: string[],
  options?: { allowAccountant?: boolean; allowDeptHead?: boolean }
): Promise<boolean> {
  if (isDirectorBinding(senderBinding, senderId, directorZaloId)) return true;
  if (options?.allowAccountant && (senderBinding?.role === "ACCOUNTANT" || senderBinding?.department === "Kế Toán")) {
    return true;
  }
  if (options?.allowDeptHead && (senderBinding?.role === "HEAD_OF_DEPT" || senderBinding?.user_type === "MANAGER")) {
    return true;
  }
  const u = await resolvePortalUserForBinding(senderBinding);
  if (!u) return false;
  if (isAdminUser(u)) return true;
  if (options?.allowAccountant && isAccountantUser(u)) return true;
  return perms.some((p) => hasPermission(u, p as any));
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

async function syncQuotationsToAppStorage() {
  try {
    const allQ = await query("SELECT * FROM sales_quotations ORDER BY id DESC");
    const list = allQ.rows.map((r: any) => {
      const extra = parseJsonSafeObj(r.extra_data);
      const items = parseJsonSafeArray(r.items);
      const hasZero = extra.hasZeroPriceItems !== undefined
        ? Boolean(extra.hasZeroPriceItems)
        : items.some((it: any) => Number(it?.unitPrice ?? it?.unit_price ?? it?.price ?? 0) === 0 || Boolean(it?.isFreeSample || it?.isGift));
      return {
        ...extra,
        id: r.quote_code || String(r.id),
        quote_code: r.quote_code,
        customer_id: r.customer_id,
        customer_name: r.customer_name,
        customerName: r.customer_name,
        sales_rep_name: r.sales_rep_name,
        salesRepName: r.sales_rep_name,
        date: r.date,
        valid_until: r.valid_until,
        validUntil: r.valid_until,
        items,
        subtotal: Number(r.subtotal || 0),
        totalBeforeVat: Number(r.subtotal || 0),
        discount_rate: Number(r.discount_rate || 0),
        discountRate: Number(r.discount_rate || 0),
        discount_amount: Number(r.discount_amount || 0),
        totalDiscount: Number(r.discount_amount || 0),
        tax_rate: Number(r.tax_rate || 8),
        taxRate: Number(r.tax_rate || 8),
        tax_amount: Number(r.tax_amount || 0),
        totalVat: Number(r.tax_amount || 0),
        total_amount: Number(r.total_amount || 0),
        totalAmount: Number(r.total_amount || 0),
        status: r.status,
        terms: r.terms || "",
        paymentTerms: r.terms || "",
        hasZeroPriceItems: hasZero,
        has_zero_price_items: hasZero,
      };
    });
    await query(
      `INSERT INTO app_storage (key, data, updated_at) VALUES ('sales_quotations', $1::jsonb, CURRENT_TIMESTAMP)
       ON CONFLICT (key) DO UPDATE SET data = $1::jsonb, version = COALESCE(app_storage.version, 1) + 1, updated_at = CURRENT_TIMESTAMP`,
      [JSON.stringify(list)]
    );
  } catch (e) {
    console.warn("[ZaloEngine] syncQuotationsToAppStorage warning:", e);
  }
}

export type ZaloProactiveEventType =
  | "QUOTE_APPROVAL_NEEDED"
  | "SO_APPROVAL_NEEDED"
  | "PO_APPROVAL_NEEDED"
  | "PROPOSAL_APPROVAL_NEEDED"
  | "RMA_APPROVAL_NEEDED"
  | "DELIVERY_DISPATCHED"
  | "DELIVERY_COMPLETED_POD"
  | "INVOICE_OR_PAYMENT_RECORDED"
  | "CUSTOMER_DELIVERY_ZNS";

/**
 * Chủ động bắn thông báo đẩy (Outbound Push Notification) qua Zalo OA cho Ban Giám Đốc,
 * Người được phân quyền duyệt, NVKD phụ trách hoặc Khách hàng (ZNS/OA) và lưu vết vào zalo_message_logs.
 */
export async function notifyZaloProactiveEvent(params: {
  eventType: ZaloProactiveEventType;
  code: string;
  customerName?: string;
  salesRepName?: string;
  requesterName?: string;
  targetApproverName?: string;
  totalAmount?: number;
  reasonOrNote?: string;
  extraInfo?: string;
}) {
  try {
    await initZaloDatabase();
    const {
      eventType,
      code,
      customerName = "",
      salesRepName = "",
      requesterName = "",
      targetApproverName = "",
      totalAmount = 0,
      reasonOrNote = "",
      extraInfo = ""
    } = params;

    let text = "";
    let recipientFilterSql = `department = 'Ban Giám Đốc' OR role = 'DIRECTOR'`;
    let recipientParams: any[] = [];
    let targetLabel = "Ban Giám Đốc / Người duyệt";

    if (eventType === "QUOTE_APPROVAL_NEEDED") {
      text =
        `🔔 [ZALO PUSH] BÁO GIÁ CẦN PHÊ DUYỆT [${code}]\n` +
        `🏥 Khách hàng: ${customerName || "Khách hàng"}\n` +
        `👤 NVKD lập: ${salesRepName || "Kinh doanh"}\n` +
        `💰 Tổng giá trị: ${fmtVnd(totalAmount)} VNĐ\n` +
        `📌 Lý do trình duyệt: ${reasonOrNote || "Chiết khấu vượt ngưỡng / Có mặt hàng 0 đồng"}\n\n` +
        `👉 Nhắn "Duyệt ${code}" hoặc "Từ chối ${code} [Lý do]" để xử lý ngay trên Zalo!`;
    } else if (eventType === "SO_APPROVAL_NEEDED") {
      text =
        `🔔 [ZALO PUSH] ĐƠN ĐẶT HÀNG (SO) CHỜ PHÊ DUYỆT [${code}]\n` +
        `🏥 Khách hàng: ${customerName || "Khách hàng"}\n` +
        `👤 NVKD phụ trách: ${salesRepName || "Kinh doanh"}\n` +
        `💰 Giá trị đơn: ${fmtVnd(totalAmount)} VNĐ\n` +
        `⚠️ Nội dung cần duyệt: ${reasonOrNote || "Duyệt đơn hàng / Hàng 0đ / Mở khóa công nợ"}\n\n` +
        `👉 Nhắn "Duyệt ${code}" (hoặc "Duyệt 0đ ${code}" / "Duyệt nợ ${code}") để mở khóa ngay!`;
    } else if (eventType === "PO_APPROVAL_NEEDED") {
      text =
        `🛒 [ZALO PUSH] ĐƠN MUA HÀNG (PO) CHỜ DUYỆT [${code}]\n` +
        `🏢 Nhà cung cấp: ${customerName || "Nhà cung cấp"}\n` +
        `👤 Người lập: ${requesterName || "Phòng Cung Ứng"}\n` +
        `💰 Tổng tiền PO: ${fmtVnd(totalAmount)} VNĐ\n` +
        (reasonOrNote ? `📝 Ghi chú: ${reasonOrNote}\n` : "") +
        `\n👉 Nhắn "Duyệt ${code}" hoặc "Từ chối ${code} [Lý do]" để phê duyệt đơn mua hàng!`;
    } else if (eventType === "PROPOSAL_APPROVAL_NEEDED") {
      targetLabel = targetApproverName || "Cấp phê duyệt / Ban Giám Đốc";
      text =
        `📋 [ZALO PUSH] TỜ TRÌNH / ĐƠN NGHỈ PHÉP MỚI [${code}]\n` +
        `👤 Người trình: ${requesterName || "Nhân viên"}\n` +
        `📌 Nội dung: ${reasonOrNote || "Đề xuất nội bộ / Xin nghỉ phép"}\n` +
        (totalAmount > 0 ? `💰 Giá trị đề xuất: ${fmtVnd(totalAmount)} VNĐ\n` : "") +
        (extraInfo ? `ℹ️ Chi tiết: ${extraInfo}\n` : "") +
        `\n👉 Nhắn "Duyệt ${code}" hoặc "Từ chối ${code} [Lý do]" để ký duyệt điện tử ngay!`;
      if (targetApproverName) {
        recipientFilterSql = `LOWER(TRIM(display_name)) = LOWER(TRIM($1)) OR department = 'Ban Giám Đốc' OR role = 'DIRECTOR'`;
        recipientParams = [targetApproverName];
      }
    } else if (eventType === "RMA_APPROVAL_NEEDED") {
      text =
        `🔄 [ZALO PUSH] YÊU CẦU TRẢ HÀNG (RMA) CHỜ DUYỆT [${code}]\n` +
        `🏥 Khách hàng: ${customerName || "Khách hàng"}\n` +
        `💰 Giá trị hoàn/trả: ${fmtVnd(totalAmount)} VNĐ\n` +
        `📌 Lý do trả hàng: ${reasonOrNote || "Khách hoàn trả hàng theo phiếu giao"}\n\n` +
        `👉 Nhắn "Duyệt ${code}" hoặc "Từ chối ${code} [Lý do]" để xử lý nhập kho trả hàng!`;
    } else if (eventType === "DELIVERY_DISPATCHED") {
      targetLabel = salesRepName || "NVKD Phụ trách";
      text =
        `🚚 [ZALO PUSH - KHO ĐÃ XUẤT HÀNG ĐI GIAO] [${code}]\n` +
        `🏥 Khách hàng: ${customerName || "Khách hàng"}\n` +
        `👤 NVKD phụ trách: ${salesRepName || "Kinh doanh"}\n` +
        (extraInfo ? `📦 Chi tiết: ${extraInfo}\n` : "") +
        (reasonOrNote ? `📞 Người giao / Ghi chú: ${reasonOrNote}\n` : "") +
        `\n👉 Khi giao xong tại viện, nhân viên giao nhận có thể gửi ảnh biên bản hoặc nhắn "Đã giao ${code}" vào Zalo OA để chốt POD!`;
      if (salesRepName) {
        recipientFilterSql = `LOWER(TRIM(display_name)) = LOWER(TRIM($1)) OR department = 'Kho Vận'`;
        recipientParams = [salesRepName];
      }
    } else if (eventType === "DELIVERY_COMPLETED_POD") {
      targetLabel = salesRepName || "NVKD & Kế toán";
      text =
        `✅ [ZALO PUSH - ĐÃ GIAO HÀNG THÀNH CÔNG & LƯU POD] [${code}]\n` +
        `🏥 Khách hàng: ${customerName || "Khách hàng"}\n` +
        `👤 NVKD phụ trách: ${salesRepName || "Kinh doanh"}\n` +
        (reasonOrNote ? `📸 Ghi chú bàn giao (POD): ${reasonOrNote}\n` : "") +
        `\n👉 Kế toán có thể tiến hành xuất Hóa đơn VAT và theo dõi công nợ theo phiếu giao ${code}.`;
      if (salesRepName) {
        recipientFilterSql = `LOWER(TRIM(display_name)) = LOWER(TRIM($1)) OR department = 'Kế Toán'`;
        recipientParams = [salesRepName];
      }
    } else if (eventType === "INVOICE_OR_PAYMENT_RECORDED") {
      targetLabel = salesRepName || "NVKD Phụ trách";
      text =
        `🧾 [ZALO PUSH - CẬP NHẬT HÓA ĐƠN / THANH TOÁN] [${code}]\n` +
        `🏥 Khách hàng: ${customerName || "Khách hàng"}\n` +
        `💰 Số tiền: ${fmtVnd(totalAmount)} VNĐ\n` +
        `📌 Nội dung: ${reasonOrNote || "Kế toán đã cập nhật hóa đơn VAT / gạch nợ thanh toán"}\n` +
        (extraInfo ? `ℹ️ ${extraInfo}\n` : "");
      if (salesRepName) {
        recipientFilterSql = `LOWER(TRIM(display_name)) = LOWER(TRIM($1))`;
        recipientParams = [salesRepName];
      }
    } else if (eventType === "CUSTOMER_DELIVERY_ZNS") {
      targetLabel = `Khách hàng: ${customerName || code}`;
      text =
        `🏥 [THÔNG BÁO GIAO HÀNG & CHỨNG TỪ LÔ/HSD - ZNS KHÁCH HÀNG]\n` +
        `Kính gửi: ${customerName || "Quý Khách hàng / Khoa Dược"}\n` +
        `Mã chứng từ: ${code}\n` +
        (extraInfo ? `${extraInfo}\n` : "") +
        (reasonOrNote ? `📞 Thông tin giao nhận: ${reasonOrNote}\n` : "") +
        `\nCảm ơn Quý đơn vị đã tin tưởng hợp tác!`;
    }

    if (!text) return { sent: 0 };

    // Tìm các nhân sự nhận thông báo đã liên kết Zalo User ID thật
    let recipients: any[] = [];
    if (eventType !== "CUSTOMER_DELIVERY_ZNS") {
      const bindRes = await query(
        `SELECT employee_id, display_name, zalo_user_id, phone_number
           FROM zalo_user_bindings
          WHERE (${recipientFilterSql})`,
        recipientParams
      ).catch(() => ({ rows: [] as any[] }));
      recipients = bindRes.rows;
    }

    const connectedRecipients = recipients.filter(
      (r: any) => r.zalo_user_id && !String(r.zalo_user_id).startsWith("zalo_test_") && !String(r.zalo_user_id).startsWith("portal_sim_")
    );

    if (connectedRecipients.length > 0) {
      for (const r of connectedRecipients) {
        await sendZaloCustomerServiceMessage({
          recipientId: String(r.zalo_user_id),
          text,
          senderName: `Zalo Push ➔ ${r.display_name || targetLabel}`
        }).catch(() => {});
      }
      return { sent: connectedRecipients.length };
    } else {
      // Lưu vào bảng zalo_message_logs để hiển thị đầy đủ trên Nhật Ký Tin Nhắn của Zalo Hub
      const fallbackRecipient = recipients[0]?.display_name || targetLabel;
      const fallbackZaloId = recipients[0]?.employee_id || "system_push_alert";
      await query(
        `INSERT INTO zalo_message_logs (zalo_user_id, sender_name, direction, message_type, content, status)
         VALUES ($1, $2, 'OUTBOUND', $3, $4, 'SENT')`,
        [fallbackZaloId, `Zalo Push ➔ ${fallbackRecipient}`, eventType, text]
      ).catch(() => {});
      return { sent: 1 };
    }
  } catch (err) {
    console.warn("[ZaloEngine] notifyZaloProactiveEvent warning:", err);
    return { sent: 0 };
  }
}

/**
 * Tổng hợp toàn bộ các hồ sơ đang chờ phê duyệt trên hệ thống (Báo giá, Đơn SO, Tờ trình/Nghỉ phép, PO, RMA)
 */
export async function getPendingApprovalsSummaryForZalo(discountThreshold = 10.0) {
  const [quotesRes, ordersRes, proposalsRes, posRes, rmasRes] = await Promise.all([
    query(
      `SELECT id, quote_code, customer_name, sales_rep_name, subtotal, discount_rate, discount_amount, total_amount, status, date, items, extra_data
         FROM sales_quotations
        WHERE status IN ('PENDING_DIRECTOR_APPROVAL', 'PENDING_APPROVAL')
           OR (discount_rate >= $1 AND status NOT IN ('APPROVED', 'REJECTED'))
        ORDER BY id DESC LIMIT 15`,
      [discountThreshold]
    ).catch(() => ({ rows: [] as any[] })),
    query(
      `SELECT id, order_code, customer_name, sales_rep_name, total_amount, order_date,
              is_credit_blocked, credit_block_reason, has_zero_price_items, price_approval_status, approval_status
         FROM sales_orders
        WHERE COALESCE(delivery_status, '') <> 'CANCELLED'
          AND COALESCE(applied_price_policy, '') <> 'STOCK'
          AND (
            is_credit_blocked = TRUE
            OR price_approval_status = 'PENDING_APPROVAL'
            OR COALESCE(approval_status, 'PENDING_APPROVAL') = 'PENDING_APPROVAL'
          )
        ORDER BY id DESC LIMIT 15`
    ).catch(() => ({ rows: [] as any[] })),
    query(
      `SELECT id, request_code, template_code, template_name, title, requester_name, requester_dept, total_amount, status, current_stage_no, approval_stages, form_data, created_at
         FROM portal_approval_requests
        WHERE status IN ('PENDING', 'IN_REVIEW')
        ORDER BY id DESC LIMIT 15`
    ).catch(() => ({ rows: [] as any[] })),
    query(
      `SELECT id, po_code, supplier_name, total_amount, order_date, status, created_by, notes
         FROM procurement_orders
        WHERE UPPER(COALESCE(status, 'PENDING')) IN ('DRAFT', 'PENDING')
        ORDER BY id DESC LIMIT 10`
    ).catch(() => ({ rows: [] as any[] })),
    query(
      `SELECT id, rma_code, order_code, customer_name, total_amount, reason_category, status, restock_action
         FROM rma_returns
        WHERE status = 'PENDING_APPROVAL'
        ORDER BY id DESC LIMIT 10`
    ).catch(() => ({ rows: [] as any[] }))
  ]);

  return {
    quotations: quotesRes.rows,
    orders: ordersRes.rows,
    proposals: proposalsRes.rows,
    pos: posRes.rows,
    rmas: rmasRes.rows,
    totalCount:
      quotesRes.rows.length +
      ordersRes.rows.length +
      proposalsRes.rows.length +
      posRes.rows.length +
      rmasRes.rows.length
  };
}

/**
 * Tạo nội dung Bản tin Điều hành Đầu ngày (Morning Digest 8:00 AM)
 */
export async function generateZaloMorningDigest(discountThreshold = 10.0): Promise<{
  text: string;
  buttons: Array<{ label: string; action: string; payload: string }>;
}> {
  const pending = await getPendingApprovalsSummaryForZalo(discountThreshold);

  // 1. Lô hàng cận date (FEFO <= 90 ngày)
  const expRes = await query(
    `SELECT product_code, COALESCE(product_name, product_code) AS product_name, lot_number, expiry_date,
            (COALESCE(quantity_on_hand, 0) - COALESCE(quantity_allocated, 0)) AS avail_qty
       FROM inventory_items
      WHERE expiry_date IS NOT NULL
        AND expiry_date <= (CURRENT_DATE + INTERVAL '90 days')
        AND COALESCE(quantity_on_hand, 0) > 0
      ORDER BY expiry_date ASC LIMIT 5`
  ).catch(() => ({ rows: [] as any[] }));

  // 2. Mặt hàng chạm tồn kho tối thiểu
  const lowStockRes = await query(
    `SELECT p.code, p.name, p.min_stock_level, COALESCE(SUM(i.quantity_on_hand), 0) AS on_hand
       FROM products p
       LEFT JOIN inventory_items i ON i.product_code = p.code
      WHERE COALESCE(p.min_stock_level, 0) > 0
      GROUP BY p.code, p.name, p.min_stock_level
     HAVING COALESCE(SUM(i.quantity_on_hand), 0) <= p.min_stock_level
      ORDER BY (p.min_stock_level - COALESCE(SUM(i.quantity_on_hand), 0)) DESC LIMIT 5`
  ).catch(() => ({ rows: [] as any[] }));

  // 3. Phiếu giao hàng đang trên đường giao (B2)
  const activeSlipsRes = await query(
    `SELECT slip_code, order_code, customer_name, delivery_date
       FROM sales_delivery_slips
      WHERE UPPER(COALESCE(status, '')) IN ('SHIPPED', 'DISPATCHED', 'PENDING', 'PACKED')
      ORDER BY id DESC LIMIT 5`
  ).catch(() => ({ rows: [] as any[] }));

  // 4. Tổng công nợ chưa thu của các đơn đã giao
  const debtRes = await query(
    `SELECT COUNT(*) AS order_count,
            COALESCE(SUM(GREATEST(0, COALESCE(total_amount, 0) - COALESCE(amount_paid, 0))), 0) AS total_unpaid
       FROM sales_orders
      WHERE COALESCE(payment_status, 'UNPAID') <> 'PAID'
        AND UPPER(COALESCE(delivery_status, '')) IN ('DELIVERED', 'PARTIALLY_DELIVERED')
        AND UPPER(COALESCE(applied_price_policy, '')) <> 'STOCK'`
  ).catch(() => ({ rows: [{ order_count: 0, total_unpaid: 0 }] }));

  const debtRow = debtRes.rows[0] || { order_count: 0, total_unpaid: 0 };

  const expLines = expRes.rows.length > 0
    ? expRes.rows.map((r: any) => {
        const dStr = r.expiry_date ? new Date(r.expiry_date).toLocaleDateString("vi-VN") : "—";
        return `  • [${r.product_code}] Lô ${r.lot_number || "—"} (HSD: ${dStr}) — Tồn: ${r.avail_qty}`;
      }).join("\n")
    : "  • Không có lô hàng nào cận hạn (< 90 ngày).";

  const lowStockLines = lowStockRes.rows.length > 0
    ? lowStockRes.rows.map((r: any) => `  • [${r.code}] ${r.name}: Tồn ${r.on_hand}/${r.min_stock_level}`).join("\n")
    : "  • Tất cả sản phẩm đều đảm bảo định mức tồn an toàn.";

  const text =
`☀️ BẢN TIN ĐIỀU HÀNH ĐẦU NGÀY (${new Date().toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })})
━━━━━━━━━━━━━━━━━━━━━━
⏳ 1. HỒ SƠ CHỜ PHÊ DUYỆT (${pending.totalCount} hồ sơ):
  • Báo giá chờ duyệt (CK cao / 0đ): ${pending.quotations.length} phiếu
  • Đơn đặt hàng SO (Duyệt đơn / 0đ / Công nợ): ${pending.orders.length} đơn
  • Tờ trình & Nghỉ phép (DX / DXNP): ${pending.proposals.length} phiếu
  • Đơn mua hàng NCC (PO): ${pending.pos.length} đơn
  • Phiếu trả hàng (RMA): ${pending.rmas.length} phiếu

📦 2. CẢNH BÁO KHO & HẠN DÙNG (FEFO < 90 NGÀY):
${expLines}

⚠️ 3. CẢNH BÁO TỒN KHO TỐI THIỂU (${lowStockRes.rows.length} mã):
${lowStockLines}

🚚 4. TIẾN ĐỘ GIAO HÀNG & CÔNG NỢ:
  • Phiếu giao hàng đang xử lý / đi giao: ${activeSlipsRes.rows.length} phiếu
  • Công nợ đơn đã giao chờ thu: ${debtRow.order_count} đơn (${fmtVnd(debtRow.total_unpaid)} VNĐ)

👉 Bấm các nút bên dưới hoặc gõ "Chờ duyệt", "Công nợ", "Tồn kho" để xử lý ngay trên Zalo!`;

  return {
    text,
    buttons: [
      { label: `⏳ Xem & Duyệt ${pending.totalCount} Hồ Sơ`, action: "quick_cmd", payload: "Chờ duyệt" },
      { label: "💰 Tra Cứu Công Nợ Quá Hạn", action: "quick_cmd", payload: "Công nợ" },
      { label: "📦 Kiểm Tra Tồn Kho FEFO", action: "quick_cmd", payload: "Tồn kho" }
    ]
  };
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
  /** Optional media/file attachments from Zalo webhook (e.g. POD photo) */
  attachments?: Array<{ type?: string; payload?: { url?: string; name?: string } }>;
  eventName?: string;
}): Promise<ZaloMessageResponse> {
  await initZaloDatabase();

  const { senderId, senderName = "Người dùng Zalo", text, attachments = [] } = params;
  const rawText = String(text || "").normalize("NFC").trim();
  const lowerText = rawText.toLowerCase();

  // 1. Sender binding: ONLY by the Zalo user id that was linked with a one-time code from the portal.
  let senderBinding: any = null;
  try {
    const bindRes = params.simulateEmployeeId
      ? await query("SELECT * FROM zalo_user_bindings WHERE employee_id = $1 LIMIT 1", [params.simulateEmployeeId])
      : await query("SELECT * FROM zalo_user_bindings WHERE zalo_user_id = $1 LIMIT 1", [senderId]);
    if (bindRes.rows.length > 0) senderBinding = bindRes.rows[0];
  } catch (err) {
    console.warn("Binding lookup error:", err);
  }

  // 1B. LINKING: the message contains a one-time code "LK-XXXXXX" created by the employee in ABT Portal
  const linkCodeMatch = rawText.toUpperCase().replace(/\s+/g, "").match(/LK-?([A-F0-9]{6})/);
  if (linkCodeMatch) {
    try {
      const normalizedCode = `LK-${linkCodeMatch[1]}`;
      const codeHash = crypto.createHash("sha256").update(normalizedCode).digest("hex");
      const matchRes = await query(
        "SELECT * FROM zalo_user_bindings WHERE link_code_hash = $1 AND (link_code_expires IS NULL OR link_code_expires > NOW() - INTERVAL '24 hours') LIMIT 1",
        [codeHash]
      );
      if (matchRes.rows.length > 0) {
        senderBinding = matchRes.rows[0];
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
          [senderId, senderBinding.display_name, `${normalizedCode} (Đã liên kết nhân sự ${senderBinding.employee_id})`]
        ).catch(() => {});

        return {
          recipientId: senderId,
          messageType: "TEXT",
          text:
`🎉 XÁC THỰC THÀNH CÔNG!
Chào mừng ${senderBinding.display_name} [${senderBinding.employee_id}] (${senderBinding.department} - ${senderBinding.position || 'Nhân sự'})!

✅ Tài khoản Zalo của bạn đã được LIÊN KẾT CHÍNH THỨC với Trung tâm Điều hành Zalo OA.

Từ bây giờ, bạn có thể thực hiện trực tiếp trên Zalo:
1. ⏳ Xem & Phê duyệt 1 chạm (Báo giá, Đơn 0đ, Công nợ, Nghỉ phép DXNP, PO, RMA): Gõ "Chờ duyệt"
2. 📋 Soạn báo giá tự động: Gõ "Báo giá BV Chợ Rẫy: 10 kit HBV, ck 5%"
3. 🚚 Tra cứu tiến độ đơn hàng & Gửi POD giao hàng: Gõ "Đơn hàng SO26-..." hoặc "Đã giao PX26-..."
4. 💰 Tra cứu công nợ khách hàng: Gõ "Công nợ BV Chợ Rẫy"
5. 📦 Tra cứu tồn kho FEFO & Giữ chỗ 48h: Gõ "Tồn kho ..." hoặc "Giữ chỗ ..."

Gõ "menu" hoặc "help" bất kỳ lúc nào để xem danh sách lệnh hỗ trợ.`
        };
      }
    } catch (autoBindErr) {
      console.warn("Zalo link code error:", autoBindErr);
    }
  }

  if (!senderBinding) {
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
`👋 Xin chào! Hệ thống nhận diện tin nhắn từ tài khoản Zalo của bạn tới trang Zalo OA Công ty Cổ phần Công nghệ TBR.

⚠️ Hiện tại tài khoản Zalo này CHƯA ĐƯỢC LIÊN KẾT với hồ sơ nhân sự trên hệ thống ABT Portal.

👉 ĐỂ LIÊN KẾT TÀI KHOẢN (dành cho nhân viên TBR):
1. Đăng nhập ABT Portal → bấm vào tên của bạn → "Bảo mật tài khoản" → "Tạo mã liên kết Zalo".
2. Nhắn mã vừa nhận (dạng LK-XXXXXX, hiệu lực 30 phút) vào khung chat này.

Vì lý do bảo mật, hệ thống không liên kết theo số điện thoại hay mã nhân viên.`
    };
  }

  // If personnel has NO phone number and is NOT linked via Zalo ID:
  if (!senderBinding.zalo_user_id && (!senderBinding.phone_number || senderBinding.connection_status === "NO_PHONE")) {
    const empName = senderBinding.display_name || senderName;
    const empCode = senderBinding.employee_id ? ` [${senderBinding.employee_id}]` : "";

    return {
      recipientId: senderId,
      messageType: "TEXT",
      text: 
`⚠️ THÔNG BÁO: KHÔNG KẾT NỐI HỆ THỐNG ZALO

Nhân sự: ${empName}${empCode}
Trạng thái: ❌ KHÔNG KẾT NỐI (Chưa có số điện thoại Zalo trong hồ sơ)

Hồ sơ nhân sự của bạn trên ABT Portal hiện đang để trống thông tin số điện thoại, do đó hệ thống chưa thể kích hoạt tính năng điều hành, kiểm tra kho và nhận lệnh qua Zalo.

👉 HƯỚNG DẪN KÍCH HOẠT:
Vui lòng liên hệ Quản trị viên hệ thống để cập nhật số điện thoại chính thức vào danh mục nhân sự.`
    };
  }

  // 2. Fetch Zalo Configuration (Approval Threshold, Director ID, etc.)
  let config = {
    director_discount_threshold: 10.0,
    director_zalo_id: "zalo_dir_bld_01",
    oa_name: "Công ty cổ phần Công nghệ TBR"
  };
  try {
    const cfgRes = await query("SELECT * FROM zalo_config LIMIT 1");
    if (cfgRes.rows.length > 0) {
      config = {
        ...config,
        director_discount_threshold: parseFloat(cfgRes.rows[0].director_discount_threshold) || 10.0,
        director_zalo_id: cfgRes.rows[0].director_zalo_id || "zalo_dir_bld_01",
        oa_name: cfgRes.rows[0].oa_name || "Công ty cổ phần Công nghệ TBR"
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
      [senderId, senderBinding?.display_name || senderName, rawText || "[Đính kèm tệp/hình ảnh]"]
    );
  } catch (err) {}

  // ==============================================================
  // INTENT 0A: TRA CỨU DANH SÁCH HỒ SƠ CHỜ DUYỆT (BÁO GIÁ, ĐƠN 0Đ, CÔNG NỢ, NGHỈ PHÉP DXNP, PO, RMA)
  // Cú pháp: "Chờ duyệt", "Danh sách chờ duyệt", "Cần duyệt", "Pending"
  // ==============================================================
  if (
    lowerText === "chờ duyệt" ||
    lowerText === "cho duyet" ||
    lowerText === "cần duyệt" ||
    lowerText === "can duyet" ||
    lowerText === "danh sách chờ duyệt" ||
    lowerText === "danh sach cho duyet" ||
    lowerText === "pending" ||
    lowerText.startsWith("chờ duyệt ") ||
    lowerText.startsWith("cho duyet ")
  ) {
    const pending = await getPendingApprovalsSummaryForZalo(config.director_discount_threshold);
    if (pending.totalCount === 0) {
      return {
        recipientId: senderId,
        messageType: "TEXT",
        text: `✅ TẤT CẢ HỒ SƠ ĐÃ ĐƯỢC PHÊ DUYỆT!\n\nHiện tại không có Báo giá, Đơn hàng 0đ, Đơn khóa công nợ, Tờ trình / Nghỉ phép (DXNP), Đơn mua hàng (PO) hay Phiếu trả hàng (RMA) nào đang chờ duyệt.`
      };
    }

    const lines: string[] = [
      `⏳ TỔNG HỢP HỒ SƠ ĐANG CHỜ PHÊ DUYỆT (${pending.totalCount} hồ sơ):`,
      `━━━━━━━━━━━━━━━━━━━━━━`
    ];
    const quickButtons: Array<{ label: string; action: string; payload: string }> = [];

    if (pending.quotations.length > 0) {
      lines.push(`\n📄 1. BÁO GIÁ CHỜ DUYỆT (${pending.quotations.length}):`);
      for (const q of pending.quotations.slice(0, 4)) {
        const items = parseJsonSafeArray(q.items);
        const hasZero = items.some((it: any) => Number(it?.unitPrice ?? it?.unit_price ?? it?.price ?? 0) === 0);
        const tag = hasZero ? "🎁 Có giá 0đ" : `CK ${q.discount_rate}%`;
        lines.push(`  • [${q.quote_code}] ${q.customer_name} — ${fmtVnd(q.total_amount)} đ (${tag} • NVKD: ${q.sales_rep_name || "—"})`);
        if (quickButtons.length < 5) {
          quickButtons.push({ label: `✅ Duyệt ${q.quote_code} (${tag})`, action: "approve", payload: `Duyệt ${q.quote_code}` });
        }
      }
    }

    if (pending.orders.length > 0) {
      lines.push(`\n🛍️ 2. ĐƠN ĐẶT HÀNG SO CHỜ DUYỆT (${pending.orders.length}):`);
      for (const o of pending.orders.slice(0, 4)) {
        const flags: string[] = [];
        let cmd = `Duyệt ${o.order_code}`;
        if (o.price_approval_status === "PENDING_APPROVAL") {
          flags.push("🎁 Hàng 0đ/Tặng");
          cmd = `Duyệt 0đ ${o.order_code}`;
        }
        if (o.is_credit_blocked) {
          flags.push("🔒 Khóa công nợ");
          if (cmd === `Duyệt ${o.order_code}`) cmd = `Duyệt nợ ${o.order_code}`;
        }
        if (flags.length === 0) flags.push("⏳ Chờ duyệt đơn");
        lines.push(`  • [${o.order_code}] ${o.customer_name} — ${fmtVnd(o.total_amount)} đ (${flags.join(" + ")})`);
        if (quickButtons.length < 5) {
          quickButtons.push({ label: `✅ ${cmd}`, action: "approve", payload: cmd });
        }
      }
    }

    if (pending.proposals.length > 0) {
      lines.push(`\n📋 3. TỜ TRÌNH & ĐƠN XIN NGHỈ PHÉP (${pending.proposals.length}):`);
      for (const p of pending.proposals.slice(0, 4)) {
        const isLeave = p.template_code === "HR_LEAVE" || String(p.title || "").toLowerCase().includes("nghỉ phép");
        const icon = isLeave ? "🏖️ Nghỉ phép" : "📝 Tờ trình";
        lines.push(`  • [${p.request_code}] ${icon}: ${p.title} (${p.requester_name} - ${p.requester_dept})`);
        if (quickButtons.length < 5) {
          quickButtons.push({ label: `✅ Duyệt ${p.request_code}`, action: "approve", payload: `Duyệt ${p.request_code}` });
        }
      }
    }

    if (pending.pos.length > 0) {
      lines.push(`\n🛒 4. ĐƠN MUA HÀNG NCC - PO (${pending.pos.length}):`);
      for (const po of pending.pos.slice(0, 3)) {
        lines.push(`  • [${po.po_code}] ${po.supplier_name} — ${fmtVnd(po.total_amount)} đ`);
        if (quickButtons.length < 5) {
          quickButtons.push({ label: `✅ Duyệt ${po.po_code}`, action: "approve", payload: `Duyệt ${po.po_code}` });
        }
      }
    }

    if (pending.rmas.length > 0) {
      lines.push(`\n🔄 5. PHIẾU TRẢ HÀNG RMA (${pending.rmas.length}):`);
      for (const rma of pending.rmas.slice(0, 3)) {
        lines.push(`  • [${rma.rma_code}] Đơn ${rma.order_code} (${rma.customer_name}) — ${fmtVnd(rma.total_amount)} đ`);
        if (quickButtons.length < 5) {
          quickButtons.push({ label: `✅ Duyệt ${rma.rma_code}`, action: "approve", payload: `Duyệt ${rma.rma_code}` });
        }
      }
    }

    lines.push(`\n💡 Cú pháp duyệt nhanh: "Duyệt [Mã phiếu]" hoặc "Từ chối [Mã phiếu] [Lý do]"`);

    return {
      recipientId: senderId,
      messageType: "APPROVAL_REQUEST",
      text: lines.join("\n"),
      buttons: quickButtons
    };
  }

  // ==============================================================
  // INTENT 0B: BẢN TIN ĐIỀU HÀNH ĐẦU NGÀY (MORNING EXECUTIVE DIGEST)
  // Cú pháp: "Bản tin sáng", "Tổng hợp đầu ngày", "Digest", "Báo cáo điều hành"
  // ==============================================================
  if (
    lowerText.includes("bản tin sáng") ||
    lowerText.includes("ban tin sang") ||
    lowerText.includes("tổng hợp đầu ngày") ||
    lowerText.includes("tong hop dau ngay") ||
    lowerText === "digest" ||
    lowerText.includes("báo cáo điều hành") ||
    lowerText.includes("bao cao dieu hanh")
  ) {
    const digest = await generateZaloMorningDigest(config.director_discount_threshold);
    return {
      recipientId: senderId,
      messageType: "CARD",
      text: digest.text,
      buttons: digest.buttons
    };
  }

  // ==============================================================
  // INTENT 1 & 2: TRUNG TÂM PHÊ DUYỆT & TỪ CHỐI 1 CHẠM ĐA NĂNG TRÊN ZALO
  // Hỗ trợ: Báo giá (CK cao & 0đ), Đơn hàng SO (Duyệt đơn, Duyệt giá 0đ, Mở khóa công nợ),
  //         Tờ trình & Nghỉ phép (DX / DXNP), Đơn mua hàng (PO), Phiếu trả hàng (RMA)
  // ==============================================================
  const isApproveCmd =
    lowerText.startsWith("duyệt ") ||
    lowerText.startsWith("duyet ") ||
    lowerText.startsWith("approve ") ||
    lowerText.startsWith("mở khóa ") ||
    lowerText.startsWith("mo khoa ") ||
    lowerText.includes("đồng ý duyệt") ||
    lowerText.includes("dong y duyet");

  const isRejectCmd =
    lowerText.startsWith("từ chối ") ||
    lowerText.startsWith("tu choi ") ||
    lowerText.startsWith("reject ");

  if (isApproveCmd || isRejectCmd) {
    const approverDisplay = senderBinding?.display_name || senderName || "Ban Giám Đốc";
    const rejectReason = isRejectCmd
      ? rawText.replace(/^(?:từ\s*chối|tu\s*choi|reject)\s+[A-Za-z0-9_-]+\s*/i, "").trim() || "Chưa đạt yêu cầu phê duyệt"
      : "";

    // 1. KIỂM TRA NẾU LÀ ĐƠN ĐẶT HÀNG BÁN (SO...)
    const soMatch = rawText.match(SO_CODE_REGEX);
    if (soMatch) {
      const soCode = soMatch[0].toUpperCase();
      const ordRes = await query("SELECT * FROM sales_orders WHERE UPPER(order_code) = $1 LIMIT 1", [soCode]);
      if (ordRes.rows.length === 0) {
        return {
          recipientId: senderId,
          messageType: "TEXT",
          text: `⚠️ Không tìm thấy đơn đặt hàng "${soCode}" trong cơ sở dữ liệu.`
        };
      }
      const ord = ordRes.rows[0];
      const wantsZeroPriceOnly = lowerText.includes("0đ") || lowerText.includes("0d") || lowerText.includes("0 đồng") || lowerText.includes("quà tặng");
      const wantsCreditUnlock = lowerText.includes("nợ") || lowerText.includes("no ") || lowerText.includes("mở khóa") || lowerText.includes("mo khoa");

      const canApproveZero = await hasSpecificApprovalAuthority(
        senderBinding,
        senderId,
        config.director_zalo_id,
        ["sales.approve_zero_price", "sales.approve_quotes", "sales.approve_discount", "sales.approve_orders"]
      );
      const canApproveCredit = await hasSpecificApprovalAuthority(
        senderBinding,
        senderId,
        config.director_zalo_id,
        ["sales.approve_credit", "sales.approve_orders"],
        { allowAccountant: true }
      );
      const canApproveOrder = await hasSpecificApprovalAuthority(
        senderBinding,
        senderId,
        config.director_zalo_id,
        ["sales.approve_orders", "sales.approve_quotes", "sales.approve_zero_price"],
        { allowDeptHead: true }
      );

      if (isRejectCmd) {
        if (!canApproveOrder && !canApproveZero) {
          return {
            recipientId: senderId,
            messageType: "TEXT",
            text: `⛔ BẠN KHÔNG CÓ THẨM QUYỀN TỪ CHỐI ĐƠN HÀNG ${soCode}.`
          };
        }
        await query(
          `UPDATE sales_orders
              SET approval_status = 'REJECTED',
                  price_approval_status = CASE WHEN price_approval_status = 'PENDING_APPROVAL' THEN 'REJECTED' ELSE price_approval_status END,
                  approved_by = $1,
                  approved_at = CURRENT_TIMESTAMP,
                  approval_note = $2
            WHERE id = $3`,
          [approverDisplay, `Từ chối qua Zalo: ${rejectReason}`, ord.id]
        );
        return {
          recipientId: senderId,
          messageType: "TEXT",
          text: `❌ ĐÃ TỪ CHỐI ĐƠN ĐẶT HÀNG [${ord.order_code}]\n🏥 Khách hàng: ${ord.customer_name}\n👤 Người từ chối: ${approverDisplay}\n📌 Lý do: ${rejectReason}`
        };
      }

      // Xử lý DUYỆT SO (Duyệt 0đ, Mở khóa công nợ, hoặc Duyệt tổng thể)
      const actionsDone: string[] = [];
      let nextCreditBlocked = Boolean(ord.is_credit_blocked);
      let nextPriceStatus = String(ord.price_approval_status || "APPROVED");
      let nextApprovalStatus = String(ord.approval_status || "PENDING_APPROVAL");

      if ((wantsCreditUnlock || (!wantsZeroPriceOnly && nextCreditBlocked)) && nextCreditBlocked) {
        if (!canApproveCredit) {
          return {
            recipientId: senderId,
            messageType: "TEXT",
            text: `⛔ Đơn ${ord.order_code} đang bị KHÓA CÔNG NỢ (${ord.credit_block_reason || "Vượt hạn mức"}). Chỉ Kế toán, Ban Giám Đốc hoặc người có quyền duyệt công nợ mới được mở khóa.`
          };
        }
        nextCreditBlocked = false;
        actionsDone.push("🔓 Mở khóa công nợ");
      }

      if ((wantsZeroPriceOnly || (!wantsCreditUnlock && nextPriceStatus === "PENDING_APPROVAL")) && nextPriceStatus === "PENDING_APPROVAL") {
        if (!canApproveZero) {
          return {
            recipientId: senderId,
            messageType: "TEXT",
            text: `⛔ Đơn ${ord.order_code} có mặt hàng GIÁ 0 ĐỒNG / QUÀ TẶNG. Chỉ Ban Giám Đốc hoặc nhân sự được cấp quyền "Phê Duyệt Báo Giá & Đơn Hàng 0 Đồng" mới được duyệt.`
          };
        }
        nextPriceStatus = "APPROVED";
        actionsDone.push("🎁 Duyệt giá 0 đồng / Hàng tặng");
      }

      if (!nextCreditBlocked && nextPriceStatus === "APPROVED") {
        if (canApproveOrder || canApproveZero || canApproveCredit) {
          nextApprovalStatus = "APPROVED";
          actionsDone.push("✅ Phê duyệt đơn hàng SO");
        }
      }

      if (actionsDone.length === 0) {
        if (!canApproveOrder) {
          return {
            recipientId: senderId,
            messageType: "TEXT",
            text: `⛔ Bạn chưa được phân quyền phê duyệt đơn đặt hàng ${ord.order_code}.`
          };
        }
        nextApprovalStatus = "APPROVED";
        actionsDone.push("✅ Phê duyệt đơn hàng SO");
      }

      await query(
        `UPDATE sales_orders
            SET is_credit_blocked = $1,
                credit_override_by = CASE WHEN $1 = FALSE AND is_credit_blocked = TRUE THEN $4 ELSE credit_override_by END,
                credit_override_at = CASE WHEN $1 = FALSE AND is_credit_blocked = TRUE THEN CURRENT_TIMESTAMP ELSE credit_override_at END,
                credit_override_reason = CASE WHEN $1 = FALSE AND is_credit_blocked = TRUE THEN 'Mở khóa công nợ qua Zalo OA' ELSE credit_override_reason END,
                price_approval_status = $2,
                price_approval_notes = CASE WHEN $2 = 'APPROVED' THEN 'Duyệt giá 0đ/quà tặng qua Zalo bởi ' || $4 ELSE price_approval_notes END,
                approval_status = $3,
                approved_by = $4,
                approved_at = CURRENT_TIMESTAMP,
                approval_note = 'Phê duyệt qua Zalo OA bởi ' || $4
          WHERE id = $5`,
        [nextCreditBlocked, nextPriceStatus, nextApprovalStatus, approverDisplay, ord.id]
      );

      return {
        recipientId: senderId,
        messageType: "TEXT",
        text:
`✅ ĐÃ PHÊ DUYỆT ĐƠN ĐẶT HÀNG THÀNH CÔNG! [${ord.order_code}]
━━━━━━━━━━━━━━━━━━━━━━
🏥 Khách hàng: ${ord.customer_name}
👤 NVKD phụ trách: ${ord.sales_rep_name || "—"}
💰 Tổng giá trị: ${fmtVnd(ord.total_amount)} VNĐ
⚡ Thao tác đã thực hiện: ${actionsDone.join(" • ")}
✍ Người phê duyệt: ${approverDisplay}
📅 Thời điểm: ${new Date().toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}

👉 Trạng thái đơn hiện tại: [${nextApprovalStatus === "APPROVED" ? "ĐÃ DUYỆT - SẴN SÀNG XUẤT KHO" : "ĐÃ MỞ KHÓA 1 PHẦN"}].`
      };
    }

    // 2. KIỂM TRA NẾU LÀ TỜ TRÌNH NỘI BỘ / ĐƠN XIN NGHỈ PHÉP (DX-... / DXNP...)
    const dxMatch = rawText.match(DX_CODE_REGEX);
    if (dxMatch) {
      const dxCode = dxMatch[0].toUpperCase();
      const reqRes = await query("SELECT * FROM portal_approval_requests WHERE UPPER(request_code) = $1 LIMIT 1", [dxCode]);
      if (reqRes.rows.length === 0) {
        return {
          recipientId: senderId,
          messageType: "TEXT",
          text: `⚠️ Không tìm thấy Tờ trình / Đơn xin nghỉ phép có mã "${dxCode}".`
        };
      }
      const row = reqRes.rows[0];
      if (!["PENDING", "IN_REVIEW"].includes(row.status)) {
        return {
          recipientId: senderId,
          messageType: "TEXT",
          text: `ℹ️ Tờ trình [${row.request_code}] đã ở trạng thái "${row.status}" trước đó.`
        };
      }

      const canApproveDx = await hasSpecificApprovalAuthority(
        senderBinding,
        senderId,
        config.director_zalo_id,
        ["workspace.manage_templates", "sales.approve_orders", "procurement.approve_po"],
        { allowDeptHead: true, allowAccountant: true }
      );
      if (!canApproveDx) {
        return {
          recipientId: senderId,
          messageType: "TEXT",
          text: `⛔ Bạn không có thẩm quyền phê duyệt Tờ trình / Đơn nghỉ phép [${row.request_code}].`
        };
      }

      const stages: any[] = parseJsonSafeArray(row.approval_stages);
      const logs: any[] = parseJsonSafeArray(row.comments_log);
      const currentIdx = stages.findIndex((s: any) => Number(s.stage_no) === Number(row.current_stage_no));
      const sig = crypto
        .createHash("sha256")
        .update(`${senderBinding?.employee_id || senderId}|${row.request_code}|ZALO|${Date.now()}`)
        .digest("hex")
        .slice(0, 12)
        .toUpperCase();

      if (isRejectCmd) {
        if (currentIdx !== -1) {
          stages[currentIdx] = {
            ...stages[currentIdx],
            status: "REJECTED",
            acted_by: approverDisplay,
            acted_at: nowVNDateTime(),
            comment: rejectReason,
            signature_hash: sig
          };
        }
        logs.push({
          id: `LOG-${Date.now()}`,
          actor_name: approverDisplay,
          actor_dept: senderBinding?.department || "Ban Giám Đốc",
          action: "REJECT",
          signature_hash: sig,
          comment: `[Từ chối qua Zalo OA]: ${rejectReason}`,
          created_at: nowVNDateTime()
        });
        await query(
          `UPDATE portal_approval_requests
              SET status = 'REJECTED', approval_stages = $2::jsonb, comments_log = $3::jsonb,
                  completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
            WHERE id = $1`,
          [row.id, JSON.stringify(stages), JSON.stringify(logs)]
        );
        return {
          recipientId: senderId,
          messageType: "TEXT",
          text: `❌ ĐÃ TỪ CHỐI TỜ TRÌNH / ĐƠN NGHỈ PHÉP [${row.request_code}]\n📌 Tiêu đề: ${row.title}\n👤 Người đề xuất: ${row.requester_name}\n✍ Người từ chối: ${approverDisplay}\n📝 Lý do: ${rejectReason}`
        };
      }

      // Phê duyệt tờ trình / đơn xin nghỉ phép qua Zalo
      const isBoss = isDirectorBinding(senderBinding, senderId, config.director_zalo_id);
      if (isBoss) {
        // Ban Giám Đốc duyệt trên Zalo -> thông qua toàn bộ các bước còn lại ngay lập tức
        for (let i = 0; i < stages.length; i++) {
          if (stages[i].status === "PENDING" || stages[i].status === "WAITING") {
            stages[i] = {
              ...stages[i],
              status: "APPROVED",
              acted_by: approverDisplay,
              acted_at: nowVNDateTime(),
              comment: "Phê duyệt qua Zalo OA",
              signature_hash: sig
            };
          }
        }
      } else if (currentIdx !== -1) {
        stages[currentIdx] = {
          ...stages[currentIdx],
          status: "APPROVED",
          acted_by: approverDisplay,
          acted_at: nowVNDateTime(),
          comment: "Phê duyệt qua Zalo OA",
          signature_hash: sig
        };
      }

      const nextIdx = stages.findIndex((s: any, idx: number) => idx > currentIdx && s.is_required !== false && s.status === "WAITING");
      let nextStatus = "APPROVED";
      let nextStageNo = row.current_stage_no;
      if (!isBoss && nextIdx !== -1) {
        stages[nextIdx] = { ...stages[nextIdx], status: "PENDING" };
        nextStageNo = stages[nextIdx].stage_no;
        nextStatus = "IN_REVIEW";
      }

      logs.push({
        id: `LOG-${Date.now()}`,
        actor_name: approverDisplay,
        actor_dept: senderBinding?.department || "Ban Giám Đốc",
        action: "APPROVE",
        signature_hash: sig,
        comment: `[Duyệt qua Zalo OA — Mã ký số ${sig}]: Đồng ý phê duyệt.`,
        created_at: nowVNDateTime()
      });

      await query(
        `UPDATE portal_approval_requests
            SET status = $2,
                current_stage_no = $3,
                approval_stages = $4::jsonb,
                comments_log = $5::jsonb,
                completed_at = CASE WHEN $2 = 'APPROVED' THEN CURRENT_TIMESTAMP ELSE completed_at END,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = $1`,
        [row.id, nextStatus, nextStageNo, JSON.stringify(stages), JSON.stringify(logs)]
      );

      return {
        recipientId: senderId,
        messageType: "TEXT",
        text:
`✅ ĐÃ KÝ DUYỆT TỜ TRÌNH / ĐƠN NGHỈ PHÉP [${row.request_code}]
━━━━━━━━━━━━━━━━━━━━━━
📋 Biểu mẫu: ${row.template_name}
📌 Tiêu đề: ${row.title}
👤 Người trình: ${row.requester_name} (${row.requester_dept})
${Number(row.total_amount) > 0 ? `💰 Giá trị: ${fmtVnd(row.total_amount)} VNĐ\n` : ""}🔐 Chữ ký số nội bộ: ${sig}
✍ Người duyệt: ${approverDisplay}
📊 Trạng thái mới: [${nextStatus === "APPROVED" ? "ĐÃ PHÊ DUYỆT HOÀN TẤT" : `CHUYỂN BƯỚC ${nextStageNo}`}]`
      };
    }

    // 3. KIỂM TRA NẾU LÀ ĐƠN MUA HÀNG NHÀ CUNG CẤP (PO...)
    const poMatch = rawText.match(PO_CODE_REGEX);
    if (poMatch) {
      const poCode = poMatch[0].toUpperCase();
      const poRes = await query("SELECT * FROM procurement_orders WHERE UPPER(po_code) = $1 LIMIT 1", [poCode]);
      if (poRes.rows.length === 0) {
        return {
          recipientId: senderId,
          messageType: "TEXT",
          text: `⚠️ Không tìm thấy Đơn đặt hàng mua ngoài (PO) có mã "${poCode}".`
        };
      }
      const po = poRes.rows[0];
      const canApprovePo = await hasSpecificApprovalAuthority(
        senderBinding,
        senderId,
        config.director_zalo_id,
        ["procurement.approve_po"]
      );
      if (!canApprovePo) {
        return {
          recipientId: senderId,
          messageType: "TEXT",
          text: `⛔ Bạn không có quyền phê duyệt Đơn đặt hàng nhà cung cấp (${po.po_code}).`
        };
      }
      const nextPoStatus = isRejectCmd ? "CANCELLED" : "APPROVED";
      const noteAppend = isRejectCmd
        ? ` • [Từ chối qua Zalo bởi ${approverDisplay}: ${rejectReason}]`
        : ` • [Đã duyệt PO qua Zalo bởi ${approverDisplay}]`;
      await query(
        `UPDATE procurement_orders
            SET status = $1,
                notes = COALESCE(notes, '') || $2,
                version = COALESCE(version, 0) + 1
          WHERE id = $3`,
        [nextPoStatus, noteAppend, po.id]
      );
      return {
        recipientId: senderId,
        messageType: "TEXT",
        text: isRejectCmd
          ? `❌ ĐÃ TỪ CHỐI / HỦY ĐƠN MUA HÀNG [${po.po_code}]\n🏢 Nhà cung cấp: ${po.supplier_name}\n📌 Lý do: ${rejectReason}`
          : `✅ ĐÃ PHÊ DUYỆT ĐƠN MUA HÀNG (PO) [${po.po_code}]\n🏢 Nhà cung cấp: ${po.supplier_name}\n💰 Tổng giá trị: ${fmtVnd(po.total_amount)} VNĐ\n✍ Người phê duyệt: ${approverDisplay}\n\n👉 Phòng Cung ứng có thể tiến hành gửi PO cho Nhà cung cấp và theo dõi lịch giao hàng.`
      };
    }

    // 4. KIỂM TRA NẾU LÀ PHIẾU TRẢ HÀNG (RMA...)
    const rmaMatch = rawText.match(RMA_CODE_REGEX);
    if (rmaMatch) {
      const rmaCode = rmaMatch[0].toUpperCase();
      const rmaRes = await query("SELECT * FROM rma_returns WHERE UPPER(rma_code) = $1 LIMIT 1", [rmaCode]);
      if (rmaRes.rows.length === 0) {
        return {
          recipientId: senderId,
          messageType: "TEXT",
          text: `⚠️ Không tìm thấy Phiếu trả hàng RMA có mã "${rmaCode}".`
        };
      }
      const rma = rmaRes.rows[0];
      if (rma.status !== "PENDING_APPROVAL") {
        return {
          recipientId: senderId,
          messageType: "TEXT",
          text: `ℹ️ Phiếu trả hàng [${rma.rma_code}] đã được xử lý trước đó (Trạng thái: ${rma.status}).`
        };
      }
      const canApproveRma = await hasSpecificApprovalAuthority(
        senderBinding,
        senderId,
        config.director_zalo_id,
        ["sales.approve_orders", "warehouse.approve"],
        { allowDeptHead: true }
      );
      if (!canApproveRma) {
        return {
          recipientId: senderId,
          messageType: "TEXT",
          text: `⛔ Bạn không có quyền phê duyệt Phiếu trả hàng RMA [${rma.rma_code}].`
        };
      }

      if (isRejectCmd) {
        await query(
          `UPDATE rma_returns SET status = 'REJECTED', approved_by = $1, notes = COALESCE(notes, '') || $2 WHERE id = $3`,
          [approverDisplay, ` • [Từ chối qua Zalo bởi ${approverDisplay}: ${rejectReason}]`, rma.id]
        );
        return {
          recipientId: senderId,
          messageType: "TEXT",
          text: `❌ ĐÃ TỪ CHỐI PHIẾU TRẢ HÀNG [${rma.rma_code}]\n🏥 Khách hàng: ${rma.customer_name}\n📌 Lý do: ${rejectReason}`
        };
      }

      await withTransaction(async (c) => {
        await c.query(
          `UPDATE rma_returns SET status = 'APPROVED', approved_by = $1, notes = COALESCE(notes, '') || $2 WHERE id = $3`,
          [approverDisplay, ` • [Duyệt qua Zalo OA bởi ${approverDisplay}]`, rma.id]
        );
        if ((rma.restock_action || "RESTOCK") === "RESTOCK") {
          const items = parseJsonSafeArray(rma.items);
          const validItems = sortByProductCode(
            items.filter((it: any) => (it.product_code || it.productCode) && Number(it.quantity) > 0),
            (it: any) => it.product_code || it.productCode
          );
          for (const it of validItems) {
            await addStock(c, {
              productCode: String(it.product_code || it.productCode).trim(),
              productName: String(it.product_name || it.name || it.product_code).trim(),
              qty: Number(it.quantity) || 0,
              lotNumber: it.lot_number || it.lotNumber || null,
              expiryDate: it.expiry_date || it.expiryDate || null,
              location: "Kho Trung Tâm",
              shelf: "Khu Nhập Trả RMA"
            });
          }
        }
        const rmaAmt = Number(rma.total_amount) || 0;
        if (String(rma.refund_type || "CREDIT_OFFSET").toUpperCase() === "CREDIT_OFFSET" && rma.order_code && rmaAmt > 0) {
          await c.query(
            `UPDATE sales_orders SET total_amount = GREATEST(0, COALESCE(total_amount, 0) - $1) WHERE order_code = $2`,
            [rmaAmt, rma.order_code]
          );
        }
      });

      return {
        recipientId: senderId,
        messageType: "TEXT",
        text: `✅ ĐÃ DUYỆT PHIẾU TRẢ HÀNG RMA [${rma.rma_code}]\n🏥 Khách hàng: ${rma.customer_name} (Đơn gốc: ${rma.order_code})\n💰 Giá trị hoàn/giảm trừ: ${fmtVnd(rma.total_amount)} VNĐ\n✍ Người duyệt: ${approverDisplay}\n📦 Hệ thống đã tự động nhập trả tồn kho & cập nhật công nợ đơn hàng.`
      };
    }

    // 5. MẶC ĐỊNH: XỬ LÝ DUYỆT / TỪ CHỐI BÁO GIÁ (BG-...: Chiết khấu cao hoặc Báo giá 0 đồng)
    const quoteCodeMatch = rawText.match(QUOTE_CODE_REGEX);
    const quoteCode = quoteCodeMatch ? quoteCodeMatch[0].toUpperCase() : null;

    if (!quoteCode) {
      return {
        recipientId: senderId,
        messageType: "TEXT",
        text:
          "⚠️ Vui lòng ghi rõ mã hồ sơ cần duyệt hoặc từ chối.\n" +
          "Ví dụ:\n" +
          "• Báo giá (CK cao / 0đ): 'Duyệt BG-TBR-2609-089'\n" +
          "• Đơn hàng 0đ / Công nợ: 'Duyệt 0đ SO26-...' hoặc 'Duyệt nợ SO26-...'\n" +
          "• Nghỉ phép / Tờ trình: 'Duyệt DX-202611-0001'\n" +
          "• Đơn mua hàng / Trả hàng: 'Duyệt PO26-...' hoặc 'Duyệt RMA26-...'\n" +
          "👉 Hoặc gõ 'Chờ duyệt' để xem danh sách kèm nút bấm!"
      };
    }

    try {
      const resolved = await resolveSingleQuotationCode(quoteCode);
      if (!resolved.exactCode) {
        if (resolved.candidates && resolved.candidates.length > 1) {
          return {
            recipientId: senderId,
            messageType: "TEXT",
            text: `⚠️ Có nhiều báo giá khớp một phần với "${quoteCode}":\n${resolved.candidates.map(c => `• ${c}`).join("\n")}\n\nVui lòng gõ chính xác đầy đủ mã báo giá.`
          };
        }
        return {
          recipientId: senderId,
          messageType: "TEXT",
          text: `⚠️ Không tìm thấy báo giá có mã "${quoteCode}" trong cơ sở dữ liệu.`
        };
      }

      const qCheck = await query("SELECT * FROM sales_quotations WHERE quote_code = $1 LIMIT 1", [resolved.exactCode]);
      const existingQuote = qCheck.rows[0];
      const qItems = parseJsonSafeArray(existingQuote?.items);
      const qExtra = parseJsonSafeObj(existingQuote?.extra_data);
      const isZeroPriceQuote =
        Boolean(qExtra.hasZeroPriceItems) ||
        qItems.some((it: any) => Number(it?.unitPrice ?? it?.unit_price ?? it?.price ?? 0) === 0 || Boolean(it?.isFreeSample || it?.isGift));

      const hasAuth = await hasQuotationApprovalAuthority(senderBinding, senderId, config.director_zalo_id, isZeroPriceQuote);
      if (!hasAuth) {
        return {
          recipientId: senderId,
          messageType: "TEXT",
          text: isZeroPriceQuote
            ? `⛔ BẠN KHÔNG CÓ THẨM QUYỀN: Báo giá ${resolved.exactCode} có mặt hàng giá 0 đồng, cần Ban Giám Đốc hoặc nhân sự có quyền "Phê Duyệt Báo Giá & Đơn Hàng 0 Đồng" phê duyệt.`
            : `⛔ BẠN KHÔNG CÓ THẨM QUYỀN DUYỆT: Quyền phê duyệt mức chiết khấu lớn thuộc thẩm quyền của Ban Giám Đốc hoặc người được phân quyền duyệt báo giá (Ngưỡng quy định: ≥ ${config.director_discount_threshold}%).`
        };
      }

      if (isRejectCmd) {
        await query(`UPDATE sales_quotations SET status = 'REJECTED' WHERE quote_code = $1`, [resolved.exactCode]);
        await syncQuotationsToAppStorage();
        return {
          recipientId: senderId,
          messageType: "TEXT",
          text: `❌ ĐÃ TỪ CHỐI BÁO GIÁ ${resolved.exactCode} bởi ${approverDisplay}.\n📌 Lý do: ${rejectReason}\nHệ thống đã cập nhật trạng thái và thông báo cho NVKD phụ trách.`
        };
      }

      const mergedExtra = {
        ...qExtra,
        approvedBy: approverDisplay,
        approvedAt: new Date().toISOString(),
        zeroPriceApproved: isZeroPriceQuote ? true : qExtra.zeroPriceApproved
      };
      const updateRes = await query(
        `UPDATE sales_quotations 
            SET status = 'APPROVED',
                extra_data = COALESCE(extra_data, '{}'::jsonb) || $2::jsonb
          WHERE quote_code = $1
          RETURNING *`,
        [resolved.exactCode, JSON.stringify(mergedExtra)]
      );

      await syncQuotationsToAppStorage();

      const q = updateRes.rows[0];
      const totalFmt = fmtVnd(q.total_amount);

      const approvalNotice = 
`✅ ĐÃ PHÊ DUYỆT BÁO GIÁ THÀNH CÔNG!

📋 Mã Báo Giá: ${q.quote_code}
🏥 Khách Hàng: ${q.customer_name}
👤 NVKD Phụ Trách: ${q.sales_rep_name || "Nhân viên kinh doanh"}
💰 Tổng Tiền Duyệt: ${totalFmt} VNĐ (${isZeroPriceQuote ? "Có mặt hàng 0đ/Hàng mẫu" : `Chiết khấu ${q.discount_rate}%`})
📅 Thời Điểm Duyệt: ${new Date().toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}
✍ Người Phê Duyệt: ${approverDisplay}

📎 Link tải PDF Báo giá chính thức:
${signedDocumentUrl("quotation", q.quote_code)}`;

      return {
        recipientId: senderId,
        messageType: "CARD",
        text: approvalNotice,
        buttons: [
          { label: "📥 Xem & Tải PDF Báo Giá", action: "view_pdf", payload: signedDocumentUrl("quotation", q.quote_code) },
          { label: "📜 Soạn Hợp Đồng", action: "create_contract", payload: `Hợp đồng ${q.quote_code}` }
        ],
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

      const companyTitle = isTBR ? "CÔNG TY CỔ PHẦN CÔNG NGHỆ TBR" : "CÔNG TY TNHH XÉT NGHIỆM VIA";
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

Vui lòng ghi rõ mã sản phẩm của TBR trong tin nhắn.
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
  // Cú pháp: "Tồn kho [Mã SKU/Tên]" hoặc "Check kho ..." hoặc nhập trực tiếp mã SKU (VD: "HI-612.N")
  // ==============================================================
  const directSkuMatch = /^[A-Z]{2,4}-[A-Z0-9.\-]+$/i.test(rawText);
  const isInventoryQuery = 
    lowerText.includes("tồn kho") || 
    lowerText.includes("ton kho") || 
    lowerText.includes("tra cứu kho") || 
    lowerText.includes("tra cuu kho") || 
    lowerText.includes("check kho") || 
    lowerText.includes("kiểm tra kho") || 
    lowerText.includes("kiem tra kho") || 
    lowerText.startsWith("kho ") ||
    lowerText === "kho" ||
    directSkuMatch;

  if (isInventoryQuery) {
    let qTerm = rawText
      .replace(/^(?:tra\s*cứu|tra\s*cuu|kiểm\s*tra|kiem\s*tra|check|tìm|tim)?\s*(?:tồn\s*kho|ton\s*kho|kho)?\s*(?:mã|ma|sku)?\s*/i, "")
      .replace(/(?:tồn\s*kho|ton\s*kho)/gi, "")
      .trim()
      .toUpperCase()
      .replace(/^[:\-\s]+/, "").trim();

    const formatExpStr = (val: any): string => {
      if (!val) return "Chưa có HSD";
      const s = String(val).trim();
      const dmyDot = s.match(/^(\d{2})[./-](\d{2})[./-](\d{4})$/);
      if (dmyDot) return `${dmyDot[1]}/${dmyDot[2]}/${dmyDot[3]}`;
      const ymd = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (ymd) return `${ymd[3]}/${ymd[2]}/${ymd[1]}`;
      const d = new Date(s);
      if (!isNaN(d.getTime())) {
        return d.toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
      }
      return s;
    };

    const cleanQ = qTerm.replace(/[^A-Z0-9]/gi, "");
    let invQuery = `
      SELECT i.*, COALESCE(p.name, i.product_name, i.product_code) as product_name, 
             p.standard_price, COALESCE(p.unit, 'Hộp') as unit, p.specification, p.category
      FROM inventory_items i
      LEFT JOIN products p ON i.product_code = p.code
    `;
    const qParams: any[] = [];
    if (qTerm && qTerm !== "TẤT CẢ" && qTerm !== "ALL") {
      invQuery += `
        WHERE i.product_code ILIKE $1
           OR COALESCE(p.name, i.product_name, '') ILIKE $1
           OR COALESCE(i.lot_number, '') ILIKE $1
           OR COALESCE(i.shelf_position, '') ILIKE $1
           OR ($2 <> '' AND REGEXP_REPLACE(i.product_code, '[^a-zA-Z0-9]', '', 'g') ILIKE $2)
      `;
      qParams.push(`%${qTerm}%`, cleanQ ? `%${cleanQ}%` : "");
    }
    invQuery += ` ORDER BY i.product_code ASC LIMIT 10`;

    try {
      const invRes = await query(invQuery, qParams);

      if (invRes.rows.length === 0) {
        // Fallback: check in products table if item exists in catalog
        const prodCheck = await query(
          `SELECT code, name, unit, standard_price, specification, category 
           FROM products 
           WHERE code ILIKE $1
              OR name ILIKE $1
              OR ($2 <> '' AND REGEXP_REPLACE(code, '[^a-zA-Z0-9]', '', 'g') ILIKE $2)
           ORDER BY code ASC
           LIMIT 5`,
          [`%${qTerm}%`, cleanQ ? `%${cleanQ}%` : ""]
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
          text: `🔍 KẾT QUẢ TRA CỨU TỒN KHO: Không tìm thấy sản phẩm nào khớp với từ khóa "${qTerm || "tồn kho"}".\n\n👉 Vui lòng kiểm tra lại mã SKU (Ví dụ: HI-612.N, HI-612, HI-007.A, SQH-115...) hoặc gõ "Tồn kho" để xem danh sách.`
        };
      }

      const matchedCodes = invRes.rows.map((r: any) => r.product_code).filter(Boolean);
      const lotsRes = await query(
        `SELECT product_code, lot_number, expiry_date, warehouse_location, quantity_on_hand, COALESCE(is_quarantined, false) AS is_quarantined
           FROM inventory_lots
          WHERE product_code = ANY($1::text[]) AND quantity_on_hand > 0
          ORDER BY product_code ASC, id ASC`,
        [matchedCodes]
      ).catch(() => ({ rows: [] as any[] }));

      const itemsText = invRes.rows.map((row: any, i: number) => {
        const expDate = formatExpStr(row.expiry_date);
        const onHand = Number(row.quantity_on_hand || 0);
        const allocated = Number(row.quantity_allocated || 0);
        const availableQty = Math.max(0, onHand - allocated);
        const priceFmt = Number(row.standard_price) > 0 ? ` | Giá chuẩn: ${fmtVnd(row.standard_price)} đ/${row.unit || "Hộp"}` : "";
        const prodLots = lotsRes.rows.filter((l: any) => l.product_code === row.product_code);

        const lotDetails = prodLots.length > 0
          ? prodLots.map((l: any) =>
              `   • Lô ${l.lot_number || "N/A"}: ${l.quantity_on_hand} ${row.unit || "Hộp"} • HSD: ${formatExpStr(l.expiry_date)}${l.is_quarantined ? " [ĐANG BIỆT TRỮ]" : ""} (${l.warehouse_location || row.warehouse_location || "Kho ABT"})`
            ).join("\n")
          : `   • Số Lô: ${row.lot_number || "Chưa có Lô"} • HSD: ${expDate} (${row.warehouse_location || "Kho ABT"})`;

        return `${i + 1}. [${row.product_code}] ${row.product_name}
   • Quy cách: ${row.specification || "Tiêu chuẩn"}${priceFmt}
   • Tồn khả dụng: ${availableQty} ${row.unit || "Hộp"} (Tổng tồn: ${onHand} • Đang giữ chỗ: ${allocated})
${lotDetails}
   • Vị trí kệ: ${row.shelf_position || "Kệ chính"}`;
      }).join("\n\n");

      const firstCode = invRes.rows[0]?.product_code || "HI-612.N";
      return {
        recipientId: senderId,
        messageType: "CARD",
        text: `📦 KẾT QUẢ TRA CỨU TỒN KHO & HẠN DÙNG THỰC TẾ (FEFO):\n━━━━━━━━━━━━━━━━━━━━━━\n${itemsText}\n\n💡 Gõ "Giữ chỗ 5 ${firstCode} cho BV..." để giữ hàng 48h hoặc "Báo giá BV...: 5 ${firstCode}" để lập báo giá.`,
        buttons: [
          { label: `🔒 Giữ chỗ 5 ${firstCode}`, action: "quick_cmd", payload: `Giữ chỗ 5 ${firstCode} cho Bệnh Viện Chợ Rẫy` },
          { label: `📄 Báo giá 5 ${firstCode}`, action: "quick_cmd", payload: `Báo giá Bệnh Viện Chợ Rẫy: 5 ${firstCode}, ck 0%` }
        ]
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
  // INTENT 8: XÁC NHẬN GIAO HÀNG & ĐÍNH KÈM ẢNH BIÊN BẢN POD QUA ZALO
  // Cú pháp: "Đã giao PX26-...", "POD PX26-... [ghi chú]", hoặc gửi ảnh kèm mã PX...
  // ==============================================================
  const pxMatchInText = rawText.match(PX_CODE_REGEX);
  const hasMediaAttachment = Array.isArray(attachments) && attachments.length > 0;
  const isPodCommand =
    lowerText.startsWith("đã giao ") ||
    lowerText.startsWith("da giao ") ||
    lowerText.startsWith("pod ") ||
    lowerText.startsWith("pod:") ||
    lowerText.startsWith("giao xong ") ||
    (hasMediaAttachment && Boolean(pxMatchInText));

  if (isPodCommand) {
    const slipCodeInput = pxMatchInText ? pxMatchInText[0].toUpperCase() : "";
    if (!slipCodeInput) {
      // Liệt kê các phiếu giao đang đi giao để nhân viên bấm chọn
      const activeSlips = await query(
        `SELECT slip_code, order_code, customer_name, status
           FROM sales_delivery_slips
          WHERE UPPER(COALESCE(status, '')) NOT IN ('CANCELLED', 'DELIVERED')
          ORDER BY id DESC LIMIT 5`
      ).catch(() => ({ rows: [] as any[] }));
      const slipBtns = activeSlips.rows.map((s: any) => ({
        label: `✅ Đã giao ${s.slip_code} (${s.customer_name})`,
        action: "quick_cmd",
        payload: `Đã giao ${s.slip_code}: Khoa Dược đã ký nhận đủ hàng & POD`
      }));
      return {
        recipientId: senderId,
        messageType: "CARD",
        text:
          `📸 XÁC NHẬN ĐÃ GIAO HÀNG & LƯU BIÊN BẢN (POD):\n\n` +
          `Vui lòng cung cấp mã Phiếu giao hàng (dạng PX26-...) hoặc bấm chọn phiếu đang giao bên dưới:\n` +
          `💡 Ví dụ: "Đã giao PX26-CR-0001: Khoa Dược đã ký nhận đủ hàng"`,
        buttons: slipBtns
      };
    }

    try {
      const slipRes = await query(
        `SELECT * FROM sales_delivery_slips WHERE UPPER(slip_code) = $1 OR slip_code ILIKE $2 ORDER BY id DESC LIMIT 1`,
        [slipCodeInput, `%${slipCodeInput}%`]
      );
      if (slipRes.rows.length === 0) {
        return {
          recipientId: senderId,
          messageType: "TEXT",
          text: `⚠️ Không tìm thấy Phiếu giao hàng "${slipCodeInput}" trên hệ thống.`
        };
      }
      const slip = slipRes.rows[0];
      const extra = parseJsonSafeObj(slip.extra_data);
      const podNote = rawText
        .replace(/^(?:đã\s*giao|da\s*giao|pod|giao\s*xong)\s*[:\-]?\s*/i, "")
        .replace(PX_CODE_REGEX, "")
        .replace(/^[:\-\s]+/, "")
        .trim() || `Xác nhận giao thành công qua Zalo bởi ${senderBinding?.display_name || senderName}`;

      const prevPodFiles = Array.isArray(extra.podFiles) ? extra.podFiles : [];
      const newMediaFiles = (attachments || [])
        .filter((a: any) => a?.payload?.url)
        .map((a: any, i: number) => ({
          name: a.payload?.name || `POD_${slip.slip_code}_${Date.now()}_${i + 1}.jpg`,
          url: a.payload?.url,
          uploadedAt: new Date().toISOString(),
          uploadedBy: senderBinding?.display_name || senderName
        }));

      const nextExtra = {
        ...extra,
        deliveryStatus: "DELIVERED",
        isDelivered: true,
        deliveredAt: todayVN(),
        podConfirmedBy: senderBinding?.display_name || senderName,
        podConfirmedAt: new Date().toISOString(),
        podNotes: podNote,
        podFiles: [...prevPodFiles, ...newMediaFiles]
      };

      await query(
        `UPDATE sales_delivery_slips
            SET status = 'DELIVERED',
                extra_data = COALESCE(extra_data, '{}'::jsonb) || $1::jsonb,
                notes = CASE WHEN notes IS NULL OR notes = '' THEN $2 ELSE notes || ' • [POD Zalo: ' || $2 || ']' END,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = $3`,
        [JSON.stringify(nextExtra), podNote, slip.id]
      );

      // Cập nhật trạng thái giao hàng của đơn SO gốc
      let salesRepName = "";
      if (slip.order_code) {
        const ordRes = await query("SELECT id, order_code, sales_rep_name, items FROM sales_orders WHERE order_code = $1 LIMIT 1", [slip.order_code]);
        if (ordRes.rows[0]) {
          salesRepName = ordRes.rows[0].sales_rep_name || "";
          await query(
            `UPDATE sales_orders
                SET delivery_status = 'DELIVERED',
                    delivered_at = COALESCE(delivered_at, CURRENT_DATE)
              WHERE id = $1 AND UPPER(COALESCE(delivery_status, '')) NOT IN ('CANCELLED', 'DELIVERED')`,
            [ordRes.rows[0].id]
          );
        }
      }

      // Thông báo chủ động cho NVKD & Kế toán
      await notifyZaloProactiveEvent({
        eventType: "DELIVERY_COMPLETED_POD",
        code: slip.slip_code,
        customerName: slip.customer_name,
        salesRepName,
        reasonOrNote: `${podNote} (Đơn gốc: ${slip.order_code || "—"})`
      });

      return {
        recipientId: senderId,
        messageType: "CARD",
        text:
`✅ ĐÃ CHỐT GIAO HÀNG THÀNH CÔNG (B3: ĐÃ GIAO & LƯU POD)!
━━━━━━━━━━━━━━━━━━━━━━
🚚 Mã Phiếu Giao: ${slip.slip_code}
🛍️ Đơn Hàng Gốc: ${slip.order_code || "—"}
🏥 Khách Hàng: ${slip.customer_name}
👤 Người Xác Nhận: ${senderBinding?.display_name || senderName}
📝 Ghi Chú POD: ${podNote}
${newMediaFiles.length > 0 ? `📎 Ảnh POD đính kèm: ${newMediaFiles.length} ảnh\n` : ""}
🔔 Hệ thống đã tự động chuyển trạng thái phiếu sang [✅ ĐÃ GIAO] và gửi thông báo Zalo cho NVKD ${salesRepName ? `(${salesRepName})` : ""} cùng bộ phận Kế toán!`,
        buttons: [
          { label: `📲 Gửi ZNS Báo Khách (${slip.slip_code})`, action: "quick_cmd", payload: `ZNS ${slip.slip_code}` },
          { label: `📦 Xem Đơn ${slip.order_code || ""}`, action: "quick_cmd", payload: `Đơn hàng ${slip.order_code || slip.slip_code}` }
        ]
      };
    } catch (e: any) {
      return {
        recipientId: senderId,
        messageType: "TEXT",
        text: `⚠️ Lỗi khi cập nhật POD phiếu giao hàng: ${e.message}`
      };
    }
  }

  // ==============================================================
  // INTENT 9: GỬI THÔNG BÁO ZNS / OA CHO KHÁCH HÀNG B2B / BỆNH VIỆN
  // Cú pháp: "Thông báo KH [Mã PX / Mã SO]" hoặc "ZNS [Mã PX / Mã SO]"
  // ==============================================================
  if (
    lowerText.startsWith("zns ") ||
    lowerText.startsWith("thông báo kh") ||
    lowerText.startsWith("thong bao kh") ||
    lowerText.startsWith("báo khách ") ||
    lowerText.startsWith("bao khach ")
  ) {
    const pxMatch = rawText.match(PX_CODE_REGEX);
    const soMatch = rawText.match(SO_CODE_REGEX);
    const targetCode = (pxMatch?.[0] || soMatch?.[0] || "").toUpperCase();

    if (!targetCode) {
      return {
        recipientId: senderId,
        messageType: "TEXT",
        text: `📲 GỬI THÔNG BÁO ZNS / ZALO OA CHO KHÁCH HÀNG:\nVui lòng nhập mã Phiếu giao hàng (PX...) hoặc mã Đơn hàng (SO...).\n💡 Ví dụ: "ZNS PX26-CR-0001" hoặc "Thông báo KH SO26-CR-1001"`
      };
    }

    try {
      let slip: any = null;
      let order: any = null;
      if (targetCode.startsWith("PX") || targetCode.startsWith("PGH")) {
        const sRes = await query("SELECT * FROM sales_delivery_slips WHERE UPPER(slip_code) = $1 LIMIT 1", [targetCode]);
        slip = sRes.rows[0];
        if (slip?.order_code) {
          const oRes = await query("SELECT * FROM sales_orders WHERE order_code = $1 LIMIT 1", [slip.order_code]);
          order = oRes.rows[0];
        }
      } else {
        const oRes = await query("SELECT * FROM sales_orders WHERE UPPER(order_code) = $1 LIMIT 1", [targetCode]);
        order = oRes.rows[0];
        if (order) {
          const sRes = await query("SELECT * FROM sales_delivery_slips WHERE order_code = $1 ORDER BY id DESC LIMIT 1", [order.order_code]);
          slip = sRes.rows[0];
        }
      }

      if (!slip && !order) {
        return {
          recipientId: senderId,
          messageType: "TEXT",
          text: `⚠️ Không tìm thấy chứng từ "${targetCode}" để tạo bản tin ZNS gửi khách hàng.`
        };
      }

      const custName = slip?.customer_name || order?.customer_name || "Quý Bệnh viện / Đơn vị";
      const custPhone = slip?.customer_phone || order?.contact_phone || "Đang cập nhật";
      const items = parseJsonSafeArray(slip?.items || order?.items);
      const itemLines = items.slice(0, 6).map((it: any, idx: number) => {
        const code = it.productCode || it.product_code || it.code || "SKU";
        const name = it.productName || it.product_name || it.name || code;
        const qty = it.quantity ?? it.qtyDeliverNow ?? it.qty ?? 1;
        const unit = it.unit || "Hộp";
        const lot = it.lotNumber || it.lot_number ? ` | Lô: ${it.lotNumber || it.lot_number}` : "";
        const exp = it.expiryDate || it.expiry_date ? ` | HSD: ${it.expiryDate || it.expiry_date}` : "";
        return `  ${idx + 1}. [${code}] ${name}: ${qty} ${unit}${lot}${exp}`;
      }).join("\n");

      const dispatcherInfo = slip?.dispatcher_name
        ? `${slip.dispatcher_name}${slip.dispatcher_phone ? ` (${slip.dispatcher_phone})` : ""}`
        : "Bộ phận Giao nhận Kho Lạnh";

      await notifyZaloProactiveEvent({
        eventType: "CUSTOMER_DELIVERY_ZNS",
        code: slip?.slip_code || order?.order_code || targetCode,
        customerName: `${custName} (SĐT: ${custPhone})`,
        extraInfo: `📦 Danh mục bàn giao:\n${itemLines}`,
        reasonOrNote: `${dispatcherInfo}${order?.invoice_no ? ` • Hóa đơn VAT số: ${order.invoice_no}` : ""}`
      });

      return {
        recipientId: senderId,
        messageType: "TEXT",
        text:
`📲 ĐÃ PHÁT THÔNG BÁO ZNS / OA TỚI KHÁCH HÀNG THÀNH CÔNG!
━━━━━━━━━━━━━━━━━━━━━━
🏥 Đơn vị nhận: ${custName}
📞 SĐT nhận ZNS: ${custPhone}
📄 Mã chứng từ: ${slip?.slip_code || order?.order_code}
${order?.invoice_no ? `🧾 Số Hóa đơn VAT: ${order.invoice_no}\n` : ""}🚚 Nhân sự giao: ${dispatcherInfo}

📦 Nội dung danh mục hàng & Số lô/HSD đã gửi:
${itemLines}

✅ Bản tin đã được lưu vết tại mục [Nhật Ký Tin Nhắn] trên Zalo Hub.`
      };
    } catch (e: any) {
      return {
        recipientId: senderId,
        messageType: "TEXT",
        text: `⚠️ Lỗi khi gửi ZNS khách hàng: ${e.message}`
      };
    }
  }

  // ==============================================================
  // INTENT 10: TRA CỨU TIẾN ĐỘ ĐƠN HÀNG (SO) & PHIẾU GIAO HÀNG (PX)
  // Cú pháp: "Đơn hàng [Mã SO / Tên KH]", "Tiến độ [Mã SO]", "Phiếu giao [Mã PX / Mã SO]"
  // ==============================================================
  const isOrderLookupIntent =
    lowerText.startsWith("đơn hàng") ||
    lowerText.startsWith("don hang") ||
    lowerText.startsWith("tiến độ") ||
    lowerText.startsWith("tien do") ||
    lowerText.startsWith("phiếu giao") ||
    lowerText.startsWith("phieu giao") ||
    Boolean(rawText.match(/^SO[0-9]{2}-[A-Za-z0-9-]+$/i)) ||
    Boolean(rawText.match(/^PX[0-9]{2}-[A-Za-z0-9-]+$/i));

  if (isOrderLookupIntent) {
    const qTerm = rawText
      .replace(/^(?:tra\s*cứu|tra\s*cuu|kiểm\s*tra|kiem\s*tra|xem)?\s*(?:tiến\s*độ|tien\s*do|đơn\s*hàng|don\s*hang|phiếu\s*giao\s*hàng|phieu\s*giao\s*hang|phiếu\s*giao|phieu\s*giao)\s*[:\-]?\s*/i, "")
      .trim();

    try {
      let ordersRes;
      if (qTerm) {
        ordersRes = await query(
          `SELECT * FROM sales_orders
            WHERE order_code ILIKE $1 OR customer_name ILIKE $1 OR COALESCE(quote_code, '') ILIKE $1
            ORDER BY id DESC LIMIT 5`,
          [`%${qTerm}%`]
        );
        // Nếu người dùng nhập mã Phiếu giao PX..., tìm đơn từ phiếu giao đó
        if (ordersRes.rows.length === 0) {
          const sFind = await query(
            `SELECT order_code FROM sales_delivery_slips WHERE slip_code ILIKE $1 LIMIT 1`,
            [`%${qTerm}%`]
          );
          if (sFind.rows[0]?.order_code) {
            ordersRes = await query(`SELECT * FROM sales_orders WHERE order_code = $1 LIMIT 1`, [sFind.rows[0].order_code]);
          }
        }
      } else {
        ordersRes = await query(`SELECT * FROM sales_orders ORDER BY id DESC LIMIT 5`);
      }

      if (ordersRes.rows.length === 0) {
        return {
          recipientId: senderId,
          messageType: "TEXT",
          text: `🔍 Không tìm thấy Đơn đặt hàng nào khớp với "${qTerm || "yêu cầu"}".\n💡 Ví dụ: "Đơn hàng BV Chợ Rẫy" hoặc "Tiến độ SO26-CR-1001"`
        };
      }

      const orderCodes = ordersRes.rows.map((r: any) => r.order_code).filter(Boolean);
      const [slipsRes, rmasRes] = await Promise.all([
        query(`SELECT * FROM sales_delivery_slips WHERE order_code = ANY($1::text[]) ORDER BY id ASC`, [orderCodes]).catch(() => ({ rows: [] as any[] })),
        query(`SELECT * FROM rma_returns WHERE order_code = ANY($1::text[]) ORDER BY id DESC`, [orderCodes]).catch(() => ({ rows: [] as any[] }))
      ]);

      const buttons: Array<{ label: string; action: string; payload: string }> = [];
      const orderBlocks = ordersRes.rows.map((o: any, idx: number) => {
        const oSlips = slipsRes.rows.filter((s: any) => s.order_code === o.order_code);
        const oRmas = rmasRes.rows.filter((r: any) => r.order_code === o.order_code);
        const paid = Number(o.amount_paid) || 0;
        const total = Number(o.total_amount) || 0;
        const remain = Math.max(0, total - paid);

        const appStatus = o.is_credit_blocked
          ? "🔒 Đang khóa công nợ"
          : o.price_approval_status === "PENDING_APPROVAL"
          ? "🎁 Chờ duyệt giá 0đ"
          : o.approval_status === "APPROVED"
          ? "✅ Đã duyệt"
          : "⏳ Chờ duyệt đơn";

        if ((o.is_credit_blocked || o.price_approval_status === "PENDING_APPROVAL" || o.approval_status !== "APPROVED") && buttons.length < 4) {
          buttons.push({ label: `✅ Duyệt ${o.order_code}`, action: "approve", payload: `Duyệt ${o.order_code}` });
        }

        const slipLines = oSlips.length > 0
          ? oSlips.map((s: any) => {
              const ex = parseJsonSafeObj(s.extra_data);
              const st = String(ex.deliveryStatus || s.status || "").toUpperCase();
              const stepLabel =
                st === "CANCELLED"
                  ? "❌ Đã hủy"
                  : ex.isDelivered || st === "DELIVERED"
                  ? "✅ B3: Đã giao (Có POD)"
                  : st === "SHIPPED" || st === "DISPATCHED"
                  ? "🚚 B2: Kho đã xuất đi giao"
                  : "📦 B1: Chờ kho xuất";
              if (!ex.isDelivered && st !== "DELIVERED" && st !== "CANCELLED" && buttons.length < 4) {
                buttons.push({ label: `📸 Chốt Đã giao ${s.slip_code}`, action: "quick_cmd", payload: `Đã giao ${s.slip_code}` });
              }
              return `     • ${s.slip_code}: ${stepLabel}${s.invoice_number ? ` (HĐ: ${s.invoice_number})` : ""}`;
            }).join("\n")
          : "     • Chưa lập phiếu giao hàng (PX)";

        const rmaLine = oRmas.length > 0
          ? `\n   🔄 Trả hàng RMA: ${oRmas.map((r: any) => `${r.rma_code} (${fmtVnd(r.total_amount)} đ - ${r.status})`).join(", ")}`
          : "";

        return (
          `${idx + 1}. [${o.order_code}] ${o.customer_name}\n` +
          `   • Duyệt đơn: ${appStatus} | NVKD: ${o.sales_rep_name || "—"}\n` +
          `   • Giá trị: ${fmtVnd(total)} đ | Đã thu: ${fmtVnd(paid)} đ | Còn thu: ${fmtVnd(remain)} đ\n` +
          `   • Hóa đơn VAT: ${o.invoice_no ? `Số ${o.invoice_no} (${o.invoice_status})` : "Chưa xuất HĐ"}\n` +
          `   • Phiếu giao hàng (${oSlips.length} đợt):\n${slipLines}${rmaLine}`
        );
      }).join("\n\n");

      return {
        recipientId: senderId,
        messageType: "CARD",
        text: `🚚 KẾT QUẢ TRA CỨU TIẾN ĐỘ ĐƠN HÀNG & PHIẾU GIAO:\n━━━━━━━━━━━━━━━━━━━━━━\n${orderBlocks}`,
        buttons
      };
    } catch (e: any) {
      return {
        recipientId: senderId,
        messageType: "TEXT",
        text: `⚠️ Lỗi khi tra cứu tiến độ đơn hàng: ${e.message}`
      };
    }
  }

  // ==============================================================
  // INTENT 11: TRA CỨU CÔNG NỢ KHÁCH HÀNG & CẢNH BÁO QUÁ HẠN
  // Cú pháp: "Công nợ [Tên KH]", "Check nợ [Tên KH]", "Dư nợ"
  // ==============================================================
  const isDebtLookupIntent =
    lowerText === "công nợ" ||
    lowerText === "cong no" ||
    lowerText === "dư nợ" ||
    lowerText === "du no" ||
    lowerText.startsWith("công nợ ") ||
    lowerText.startsWith("cong no ") ||
    lowerText.startsWith("check nợ") ||
    lowerText.startsWith("check no") ||
    lowerText.startsWith("tra cứu công nợ") ||
    lowerText.startsWith("tra cuu cong no") ||
    lowerText.startsWith("dư nợ ") ||
    lowerText.startsWith("du no ");

  if (isDebtLookupIntent) {
    const custQuery = rawText
      .replace(/^(?:tra\s*cứu|tra\s*cuu|kiểm\s*tra|kiem\s*tra|check|xem)?\s*(?:công\s*nợ|cong\s*no|dư\s*nợ|du\s*no|nợ|no)\s*(?:khách\s*hàng|khach\s*hang|kh)?\s*[:\-]?\s*/i, "")
      .trim();

    try {
      let custRows: any[] = [];
      if (custQuery) {
        const cRes = await query(
          `SELECT id, customer_code, name, credit_limit, credit_term_days, assigned_rep
             FROM sales_customers
            WHERE name ILIKE $1 OR customer_code ILIKE $1 OR COALESCE(tax_code, '') ILIKE $1
            ORDER BY id ASC LIMIT 5`,
          [`%${custQuery}%`]
        );
        custRows = cRes.rows;
      } else {
        // Nếu không truyền tên KH: Lấy top 5 khách hàng đang có đơn chưa thanh toán lớn nhất
        const topRes = await query(
          `SELECT c.id, c.customer_code, c.name, c.credit_limit, c.credit_term_days, c.assigned_rep,
                  SUM(GREATEST(0, COALESCE(o.total_amount, 0) - COALESCE(o.amount_paid, 0))) AS open_amt
             FROM sales_orders o
             LEFT JOIN sales_customers c ON (o.customer_id = c.id OR LOWER(TRIM(o.customer_name)) = LOWER(TRIM(c.name)))
            WHERE COALESCE(o.payment_status, 'UNPAID') <> 'PAID'
              AND UPPER(COALESCE(o.delivery_status, '')) <> 'CANCELLED'
              AND UPPER(COALESCE(o.applied_price_policy, '')) <> 'STOCK'
            GROUP BY c.id, c.customer_code, c.name, c.credit_limit, c.credit_term_days, c.assigned_rep, o.customer_name
            ORDER BY open_amt DESC LIMIT 5`
        );
        custRows = topRes.rows.map((r: any) => ({
          id: r.id,
          customer_code: r.customer_code || "KH",
          name: r.name || "Khách hàng",
          credit_limit: r.credit_limit ?? 100000000,
          credit_term_days: r.credit_term_days ?? 30,
          assigned_rep: r.assigned_rep
        }));
      }

      if (custRows.length === 0) {
        return {
          recipientId: senderId,
          messageType: "TEXT",
          text: `💰 TRA CỨU CÔNG NỢ: Không tìm thấy khách hàng khớp với "${custQuery}".\n👉 Gõ "Công nợ" để xem danh sách các đơn vị đang có dư nợ cần thu.`
        };
      }

      const blocks: string[] = [];
      for (const c of custRows) {
        const ordRes = await query(
          `SELECT order_code, order_date, total_amount, COALESCE(amount_paid, 0) AS amount_paid,
                  delivery_status, invoice_no, is_credit_blocked
             FROM sales_orders
            WHERE (customer_id = $1 OR LOWER(TRIM(customer_name)) = LOWER(TRIM($2)))
              AND COALESCE(payment_status, 'UNPAID') <> 'PAID'
              AND UPPER(COALESCE(delivery_status, '')) <> 'CANCELLED'
              AND UPPER(COALESCE(applied_price_policy, '')) <> 'STOCK'
            ORDER BY id DESC`,
          [c.id || -1, c.name]
        );

        const limit = Number(c.credit_limit ?? 100000000);
        const termDays = Number(c.credit_term_days ?? 30);
        let deliveredDebt = 0;
        let pendingOrderDebt = 0;

        for (const o of ordRes.rows) {
          const unpaid = Math.max(0, (Number(o.total_amount) || 0) - (Number(o.amount_paid) || 0));
          if (["DELIVERED", "PARTIALLY_DELIVERED"].includes(String(o.delivery_status || "").toUpperCase())) {
            deliveredDebt += unpaid;
          } else {
            pendingOrderDebt += unpaid;
          }
        }

        const remainingCredit = Math.max(0, limit - deliveredDebt);
        const isOverLimit = deliveredDebt > limit;

        const openOrderSample = ordRes.rows.slice(0, 3).map((o: any) => {
          const unpaid = Math.max(0, (Number(o.total_amount) || 0) - (Number(o.amount_paid) || 0));
          return `     • ${o.order_code}: Còn phải thu ${fmtVnd(unpaid)} đ (${o.delivery_status === "DELIVERED" ? "Đã giao" : "Chưa giao hết"})`;
        }).join("\n");

        blocks.push(
          `🏥 [${c.customer_code || "KH"}] ${c.name}\n` +
          `   • Hạn mức tín dụng: ${fmtVnd(limit)} đ (${termDays} ngày)\n` +
          `   • Dư nợ thực tế (Hàng đã giao): ${fmtVnd(deliveredDebt)} đ ${isOverLimit ? "⚠️ [VƯỢT HẠN MỨC]" : "✅ [TRONG HẠN MỨC]"}\n` +
          `   • Giá trị đơn đang xử lý (Chưa giao): ${fmtVnd(pendingOrderDebt)} đ\n` +
          `   • Hạn mức còn lại: ${fmtVnd(remainingCredit)} đ\n` +
          (openOrderSample ? `   • Các đơn chưa tất toán (${ordRes.rows.length} đơn):\n${openOrderSample}` : `   • Không có công nợ tồn đọng.`)
        );
      }

      return {
        recipientId: senderId,
        messageType: "TEXT",
        text: `💰 BÁO CÁO ĐỐI CHIẾU CÔNG NỢ KHÁCH HÀNG:\n━━━━━━━━━━━━━━━━━━━━━━\n${blocks.join("\n\n")}`
      };
    } catch (e: any) {
      return {
        recipientId: senderId,
        messageType: "TEXT",
        text: `⚠️ Lỗi khi tra cứu công nợ: ${e.message}`
      };
    }
  }

  // ==============================================================
  // INTENT DEFAULT: HƯỚNG DẪN SỬ DỤNG / MENU LỆNH NHANH ĐẦY ĐỦ
  // ==============================================================
  return {
    recipientId: senderId,
    messageType: "CARD",
    text: `👋 XIN CHÀO! ĐÂY LÀ TRỢ LÝ ĐIỀU HÀNH DI ĐỘNG ZALO OA 4.0

Danh sách các nghiệp vụ tự động hỗ trợ Nhân sự & Ban Giám Đốc:

1. ⏳ Xem & Phê Duyệt Hồ Sơ 1-Chạm (Báo giá, Đơn 0đ, Công nợ, Nghỉ phép DXNP, PO, RMA):
   • Gõ: "Chờ duyệt" (Xem toàn bộ danh sách chờ duyệt kèm nút bấm)
   • Gõ: "Duyệt BG-...", "Duyệt 0đ SO26-...", "Duyệt nợ SO26-...", "Duyệt DX-...", "Duyệt PO26-...", "Duyệt RMA26-..."

2. ☀️ Bản Tin Điều Hành Đầu Ngày (Morning Digest):
   • Gõ: "Bản tin sáng" hoặc "Digest" (Tổng hợp chờ duyệt, lô cận date FEFO, tồn tối thiểu, công nợ)

3. 🚚 Tra Cứu Tiến Độ Đơn Hàng (SO) & Chốt Giao Hàng (POD):
   • Gõ: "Đơn hàng BV Chợ Rẫy" hoặc "Tiến độ SO26-..."
   • Gõ: "Đã giao PX26-..." (hoặc gửi ảnh biên bản kèm mã PX... để lưu POD & báo NVKD)

4. 💰 Tra Cứu Công Nợ & Gửi Thông Báo ZNS Khách Hàng:
   • Gõ: "Công nợ BV Chợ Rẫy" (Xem dư nợ đã giao, hạn mức còn lại)
   • Gõ: "ZNS PX26-..." (Phát thông báo giao hàng kèm Lô/HSD cho Bệnh viện)

5. 📄 Soạn Báo Giá & Hợp Đồng Tự Động (Kèm File PDF):
   • Gõ: "Báo giá BV Chợ Rẫy: 20 kit HBV, ck 12%"
   • Gõ: "Hợp đồng BG-TBR-..."

6. 📦 Tra Cứu Tồn Kho FEFO, Giữ Chỗ 48h, Khách Hàng & Daily:
   • Gõ: "Tồn kho KIT-HBV-100" | "Giữ chỗ 20 KIT-HBV cho BV Chợ Rẫy"
   • Gõ: "Khách hàng BV Chợ Rẫy" | "Daily: Nội dung công việc ngày"`,
    buttons: [
      { label: "⏳ Danh Sách Chờ Duyệt", action: "quick_cmd", payload: "Chờ duyệt" },
      { label: "☀️ Bản Tin Điều Hành Sáng", action: "quick_cmd", payload: "Bản tin sáng" },
      { label: "🚚 Tiến Độ Đơn Hàng SO", action: "quick_cmd", payload: "Đơn hàng" },
      { label: "💰 Báo Cáo Công Nợ KH", action: "quick_cmd", payload: "Công nợ" },
      { label: "📦 Kiểm Tra Tồn Kho FEFO", action: "quick_cmd", payload: "Tồn kho" }
    ]
  };
}

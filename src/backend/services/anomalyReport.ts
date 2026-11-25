import { query } from "@/backend/db/db";

/**
 * Báo cáo bất thường (hàng tuần): gom các thao tác / dữ liệu lệch quy trình để quản lý phát hiện sớm,
 * thay vì chờ người dùng báo lỗi (xem phân tích "PORTAL 5.1").
 * Chỉ ĐỌC dữ liệu. Mỗi mục: tiêu đề, giải thích, cách xử lý đúng và danh sách chứng từ liên quan.
 */
export type AnomalyRow = { ref: string; detail: string; actor?: string; at?: string };
export type AnomalySection = {
  key: string;
  title: string;
  severity: "high" | "medium" | "low";
  why: string;
  fix: string;
  rows: AnomalyRow[];
};
export type AnomalyReport = { from: string; to: string; days: number; generatedAt: string; total: number; sections: AnomalySection[] };

const SO_CODE_RE = "SO[0-9]{2}-[A-Z0-9]+-[0-9]+";
const MAX_ROWS = 50;
/** Phiếu giao đã hủy: cùng quy tắc với giao diện (status / deliveryStatus / cancelledAt). Phiếu hủy trước đây có thể chỉ
 *  ghi hủy trong extra_data, cột status vẫn "COMPLETED" -> bị tính như phiếu còn hiệu lực (SO26-NG-1101, PX2611-0063). */
const slipCancelled = (a: string) =>
  `(UPPER(COALESCE(${a}.status, '')) = 'CANCELLED' OR UPPER(COALESCE(${a}.extra_data->>'deliveryStatus', '')) = 'CANCELLED' OR COALESCE(${a}.extra_data->>'cancelledAt', '') <> '')`;

const fmt = (d: any) => {
  if (!d) return "";
  const x = new Date(d);
  if (isNaN(x.getTime())) return String(d);
  return x.toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
};

/** Hạn dùng lưu dạng chữ nhiều định dạng (2026-11-09, 14.10.2026, 14/10/2026): đổi về Date; null nếu không đọc được. */
export function parseExpiry(v: any): Date | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(s);
  if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  m = /^(\d{1,2})[./-](\d{4})$/.exec(s); // MM/YYYY -> cuối tháng
  if (m) return new Date(Number(m[2]), Number(m[1]), 0);
  return null;
}

async function safeRows(sql: string, params: any[] = []): Promise<any[]> {
  try {
    return (await query(sql, params)).rows || [];
  } catch (err: any) {
    console.error("[anomalyReport] Truy vấn lỗi:", err?.message || err);
    return [];
  }
}

export async function buildAnomalyReport(days = 7): Promise<AnomalyReport> {
  const d = Math.min(90, Math.max(1, Math.floor(days) || 7));
  const sections: AnomalySection[] = [];
  const since = `NOW() - INTERVAL '${d} days'`;

  // 1. Đơn bị sửa SAU khi đã xuất hóa đơn (vd SO26-CP-1177 tăng số lượng sau khi đã giao + xuất HĐ)
  {
    const rows = await safeRows(
      `WITH upd AS (
         SELECT substring(details from '${SO_CODE_RE}') AS code, created_at, actor_name, details
           FROM audit_logs
          WHERE action = 'UPDATE' AND created_at >= ${since} AND details ~ '${SO_CODE_RE}'
       ), inv AS (
         SELECT substring(details from '${SO_CODE_RE}') AS code, MIN(created_at) AS first_inv
           FROM audit_logs
          WHERE action IN ('PARTIAL_INVOICE', 'EDIT_INVOICE', 'UPDATE_INVOICE') AND details ~ '${SO_CODE_RE}'
          GROUP BY 1
       )
       SELECT upd.code, upd.created_at, upd.actor_name, LEFT(upd.details, 160) AS details
         FROM upd JOIN inv ON inv.code = upd.code AND upd.created_at > inv.first_inv
        ORDER BY upd.created_at DESC LIMIT ${MAX_ROWS}`
    );
    sections.push({
      key: "edited_after_invoice",
      title: "Đơn bị sửa sau khi đã xuất hóa đơn",
      severity: "high",
      why: "Sửa số lượng / giá sau khi đã giao và xuất HĐ làm lệch giữa SO, phiếu giao, hóa đơn và công nợ; đơn có hàng 0đ còn bị đưa về chờ BGĐ duyệt lại.",
      fix: "Khách đặt thêm: tạo SO mới. Sửa nhầm: liên hệ Kế toán trước khi sửa và để BGĐ duyệt lại.",
      rows: rows.map(r => ({ ref: r.code, detail: r.details, actor: r.actor_name, at: fmt(r.created_at) })),
    });
  }

  // 2. Phiếu giao vượt số lượng đặt trên SO (theo mã)
  {
    const rows = await safeRows(
      `WITH ord AS (
         SELECT o.order_code, COALESCE(it->>'productCode', it->>'product_code') AS code, SUM(COALESCE((it->>'quantity')::numeric, 0)) AS ordered
           FROM sales_orders o, jsonb_array_elements(CASE WHEN jsonb_typeof(o.items) = 'array' THEN o.items ELSE '[]'::jsonb END) it
          WHERE UPPER(COALESCE(o.delivery_status, '')) <> 'CANCELLED' AND UPPER(COALESCE(it->>'status', '')) <> 'CANCELLED'
          GROUP BY 1, 2
       ), slip AS (
         SELECT s.order_code, COALESCE(it->>'productCode', it->>'product_code') AS code, SUM(COALESCE((it->>'quantity')::numeric, 0)) AS slipped,
                string_agg(DISTINCT s.slip_code, ', ') AS slips, MAX(s.created_at) AS last_at
           FROM sales_delivery_slips s, jsonb_array_elements(CASE WHEN jsonb_typeof(s.items) = 'array' THEN s.items ELSE '[]'::jsonb END) it
          WHERE NOT ${slipCancelled("s")}
          GROUP BY 1, 2
       )
       SELECT slip.order_code, slip.code, ord.ordered, slip.slipped, slip.slips, slip.last_at
         FROM slip JOIN ord ON ord.order_code = slip.order_code AND ord.code = slip.code
        WHERE slip.slipped > ord.ordered
        ORDER BY slip.last_at DESC LIMIT ${MAX_ROWS}`
    );
    sections.push({
      key: "over_delivered",
      title: "Phiếu giao vượt số lượng đặt",
      severity: "high",
      why: "Tổng các phiếu giao (chưa hủy) lớn hơn số lượng SO: hàng xuất kho thừa hoặc phiếu trùng.",
      fix: "Kiểm tra phiếu trùng và hủy phiếu thừa (hàng tự hoàn kho); báo Kế toán nếu đã xuất HĐ.",
      rows: rows.map(r => ({ ref: r.order_code, detail: `${r.code}: đặt ${Number(r.ordered)}, đã lập phiếu ${Number(r.slipped)} (${r.slips})`, at: fmt(r.last_at) })),
    });
  }

  // 3. Phiếu giao lập trùng (cùng đơn, cùng hàng, cách nhau dưới 5 phút) trong kỳ
  {
    const rows = await safeRows(
      `SELECT a.order_code, a.slip_code AS slip_a, b.slip_code AS slip_b, a.creator_name, b.created_at,
              FALSE AS da_huy
         FROM sales_delivery_slips a
         JOIN sales_delivery_slips b ON b.order_code = a.order_code AND b.id > a.id
          AND b.created_at BETWEEN a.created_at AND a.created_at + INTERVAL '5 minutes'
          AND b.items = a.items
        WHERE b.created_at >= ${since}
          -- Một trong hai phiếu đã hủy = người dùng đã xử lý phiếu thừa: không cần cảnh báo nữa (SO26-TL-1110)
          AND NOT ${slipCancelled("a")} AND NOT ${slipCancelled("b")}
        ORDER BY b.created_at DESC LIMIT ${MAX_ROWS}`
    );
    sections.push({
      key: "duplicate_slips",
      title: "Phiếu giao lập trùng",
      severity: "medium",
      why: "Hai phiếu cùng đơn, cùng hàng lập cách nhau vài phút và CẢ HAI còn hiệu lực: thường do bấm lưu 2 lần hoặc lập lại khi mạng chậm — hàng bị xuất kho 2 lần.",
      fix: "Hủy phiếu thừa (hàng tự nhập lại kho). Lần sau bấm lưu một lần; chưa thấy phản hồi thì tải lại trang và kiểm tra danh sách phiếu trước khi lập lại.",
      rows: rows.map(r => ({ ref: r.order_code, detail: `${r.slip_a} và ${r.slip_b} — cả hai còn hiệu lực, CHƯA hủy phiếu thừa`, actor: r.creator_name, at: fmt(r.created_at) })),
    });
  }

  // 4. Phiếu giao bị hủy trong kỳ
  {
    const rows = await safeRows(
      `SELECT s.slip_code, s.order_code, COALESCE(s.extra_data->>'cancelledBy', s.creator_name) AS nguoi,
              COALESCE(s.extra_data->>'cancelReason', '') AS ly_do, s.updated_at
         FROM sales_delivery_slips s
        WHERE ${slipCancelled("s")} AND s.updated_at >= ${since}
        ORDER BY s.updated_at DESC LIMIT ${MAX_ROWS}`
    );
    sections.push({
      key: "cancelled_slips",
      title: "Phiếu giao bị hủy",
      severity: "low",
      why: "Hủy phiếu = hàng nhập lại kho. Hủy nhầm làm đơn bị thiếu giao.",
      fix: "Chỉ hủy khi không giao; muốn đổi ngày / lô / số lượng thì dùng \"Sửa\".",
      rows: rows.map(r => ({ ref: r.slip_code, detail: `Đơn ${r.order_code}${r.ly_do ? ` — lý do: ${r.ly_do}` : " — không ghi lý do"}`, actor: r.nguoi, at: fmt(r.updated_at) })),
    });
  }

  // 5. Đơn "Đã giao hoàn tất" nhưng các phiếu đã giao chưa đủ số lượng
  {
    const rows = await safeRows(
      `WITH ord AS (
         SELECT o.order_code, COALESCE(it->>'productCode', it->>'product_code') AS code, SUM(COALESCE((it->>'quantity')::numeric, 0)) AS ordered
           FROM sales_orders o, jsonb_array_elements(CASE WHEN jsonb_typeof(o.items) = 'array' THEN o.items ELSE '[]'::jsonb END) it
          WHERE UPPER(COALESCE(o.delivery_status, '')) = 'DELIVERED' AND UPPER(COALESCE(it->>'status', '')) <> 'CANCELLED'
          GROUP BY 1, 2
       ), dlv AS (
         SELECT s.order_code, COALESCE(it->>'productCode', it->>'product_code') AS code, SUM(COALESCE((it->>'quantity')::numeric, 0)) AS delivered
           FROM sales_delivery_slips s, jsonb_array_elements(CASE WHEN jsonb_typeof(s.items) = 'array' THEN s.items ELSE '[]'::jsonb END) it
          WHERE NOT ${slipCancelled("s")}
            AND (s.extra_data->>'isDelivered' = 'true'
                 OR UPPER(COALESCE(s.extra_data->>'deliveryStatus', '')) IN ('WAREHOUSE_DELIVERED', 'DELIVERED')
                 OR (COALESCE(s.extra_data->>'deliveryStatus', '') = '' AND s.extra_data->>'isDelivered' IS NULL))
          GROUP BY 1, 2
       )
       SELECT ord.order_code, string_agg(ord.code || ' còn ' || (ord.ordered - COALESCE(dlv.delivered, 0)), ', ') AS con_lai
         FROM ord LEFT JOIN dlv ON dlv.order_code = ord.order_code AND dlv.code = ord.code
        WHERE COALESCE(dlv.delivered, 0) < ord.ordered
          AND EXISTS (SELECT 1 FROM sales_delivery_slips s WHERE s.order_code = ord.order_code)
        GROUP BY ord.order_code ORDER BY 1 LIMIT ${MAX_ROWS}`
    );
    sections.push({
      key: "delivered_but_short",
      title: "Đơn \"Đã giao hoàn tất\" nhưng còn thiếu hàng",
      severity: "high",
      why: "Đơn đóng trong khi phiếu giao chưa đủ số lượng: không lập được phiếu đợt tiếp, khách thiếu hàng.",
      fix: "Kho lập phiếu đợt tiếp; nếu khách không lấy nữa thì NVKD bấm \"Hủy dòng\".",
      rows: rows.map(r => ({ ref: r.order_code, detail: r.con_lai })),
    });
  }

  // 6–7. Lô hết hạn còn tồn / hạn dùng không đọc được; 8. Số lô kit qPCR sai quy tắc IC
  {
    const lots = await safeRows(
      `SELECT product_code, lot_number, expiry_date, quantity_on_hand, warehouse_location
         FROM inventory_lots WHERE quantity_on_hand > 0 ORDER BY product_code, lot_number`
    );
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const expired: AnomalyRow[] = [];
    const badDate: AnomalyRow[] = [];
    const badLot: AnomalyRow[] = [];
    for (const l of lots) {
      const exp = String(l.expiry_date ?? "").trim();
      if (exp) {
        const dt = parseExpiry(exp);
        if (!dt) badDate.push({ ref: `${l.product_code} / ${l.lot_number}`, detail: `Hạn dùng "${exp}" không đọc được — tồn ${l.quantity_on_hand}` });
        else if (dt < today) expired.push({ ref: `${l.product_code} / ${l.lot_number}`, detail: `Hết hạn ${exp} — còn tồn ${l.quantity_on_hand} (${l.warehouse_location || "kho"})` });
      }
      const code = String(l.product_code || "").toUpperCase();
      if (/^(SQ|MQ)[A-Z]?-/.test(code)) {
        const segs = String(l.lot_number || "").toUpperCase().split(".").map(s => s.trim()).filter(Boolean);
        const icLike = segs.filter(s => s.includes("IC") && s !== "IC");
        if (icLike.length > 0) badLot.push({ ref: `${l.product_code} / ${l.lot_number}`, detail: `Đoạn "${icLike.join(", ")}" không đúng quy tắc (chỉ ghi ".IC" hoặc bỏ hẳn) — tồn ${l.quantity_on_hand}` });
      }
    }
    sections.push({
      key: "expired_stock",
      title: "Lô đã hết hạn còn tồn",
      severity: "medium",
      why: "Lô hết hạn không xuất được. Vật tư không có hạn dùng mà nhập ngày tạm cũng rơi vào đây.",
      fix: "Hàng thật hết hạn: xử lý hủy / cách ly theo quy trình. Vật tư không có hạn dùng: Tồn kho → Sửa lô → \"Không HSD\".",
      rows: expired.slice(0, MAX_ROWS),
    });
    sections.push({
      key: "unreadable_expiry",
      title: "Hạn dùng ghi sai định dạng",
      severity: "low",
      why: "Phần mềm không đọc được ngày nên không cảnh báo hết hạn / không sắp xếp FEFO đúng.",
      fix: "Sửa lô, chọn lại ngày bằng ô chọn ngày.",
      rows: badDate.slice(0, MAX_ROWS),
    });
    sections.push({
      key: "bad_kit_lot",
      title: "Số lô kit qPCR sai quy tắc",
      severity: "medium",
      why: "Phần mềm đọc quy cách (chia sẵn / IC / tube) từ số lô; ghi sai (NO-IC, ICNS...) làm lô không xuất được cho đơn đúng quy cách.",
      fix: "Sửa số lô trên PNK gốc theo quy tắc: \".C…\" = chia sẵn, \".IC\" = sẵn IC (không IC thì bỏ hẳn), mã tube T01/T02/...",
      rows: badLot.slice(0, MAX_ROWS),
    });
  }

  // 9. Nhập kho trong kỳ có hạn dùng quá gần ngày nhập (≤ 14 ngày) — thường là ngày nhập tạm cho vật tư không có hạn dùng
  {
    const txs = await safeRows(
      `SELECT transaction_code, date, performed_by, items FROM inventory_transactions
        WHERE transaction_type = 'INBOUND' AND COALESCE(created_at, date::timestamp) >= ${since}
        ORDER BY date DESC`
    );
    const rows: AnomalyRow[] = [];
    for (const t of txs) {
      const base = t.date ? new Date(t.date) : null;
      const items: any[] = Array.isArray(t.items) ? t.items : [];
      for (const it of items) {
        const exp = parseExpiry(it?.expiry_date || it?.expiryDate);
        if (!exp || !base) continue;
        const gapDays = Math.round((exp.getTime() - base.getTime()) / 86400000);
        if (gapDays <= 14) {
          rows.push({
            ref: t.transaction_code,
            detail: `${it?.product_code || it?.productCode || "?"} lô ${it?.lot_number || it?.lotNumber || "—"}: hạn dùng ${it?.expiry_date || it?.expiryDate} chỉ ${gapDays} ngày sau ngày nhập`,
            actor: t.performed_by,
            at: fmt(t.date),
          });
        }
      }
      if (rows.length >= MAX_ROWS) break;
    }
    sections.push({
      key: "short_expiry_inbound",
      title: "Nhập kho với hạn dùng quá gần (≤ 14 ngày)",
      severity: "low",
      why: "Thường là nhập ngày tạm cho vật tư không có hạn dùng — vài ngày sau lô bị coi là hết hạn.",
      fix: "Vật tư không có hạn dùng: tick \"K.HSD\" hoặc để trống khi nhập kho.",
      rows,
    });
  }

  // 10. SO trong kỳ có nhiều dòng giống hệt (cùng mã, cùng ghi chú, chưa có trình tự)
  {
    const rows = await safeRows(
      `SELECT o.order_code, o.sales_rep_name, o.created_at, COALESCE(it->>'productCode', it->>'product_code') AS code, count(*) AS so_dong
         FROM sales_orders o, jsonb_array_elements(CASE WHEN jsonb_typeof(o.items) = 'array' THEN o.items ELSE '[]'::jsonb END) it
        WHERE o.created_at >= ${since}
          AND UPPER(COALESCE(it->>'status', '')) <> 'CANCELLED'
          AND NULLIF(it->>'sequence', '') IS NULL
        GROUP BY 1, 2, 3, 4, COALESCE(it->>'notes', ''), COALESCE(it->>'unitPrice', it->>'price', '0')
       HAVING count(*) > 1
        ORDER BY o.created_at DESC LIMIT ${MAX_ROWS}`
    );
    sections.push({
      key: "identical_lines",
      title: "SO có nhiều dòng giống hệt nhau",
      severity: "low",
      why: "Nhiều dòng cùng mã, cùng giá, cùng ghi chú (thường là oligo chưa nhập trình tự): khó phân biệt khi giao và mua hàng.",
      fix: "Mỗi trình tự một dòng, nhập vào ô trình tự; cùng một hàng thì để 1 dòng và tăng số lượng.",
      rows: rows.map(r => ({ ref: r.order_code, detail: `${r.code}: ${r.so_dong} dòng giống hệt`, actor: r.sales_rep_name, at: fmt(r.created_at) })),
    });
  }

  // 11. Lỗi hệ thống được ghi lại trong kỳ: đồng bộ CSDL -> bản sao màn hình lỗi, lần lưu bị chặn
  //     (hai bản dữ liệu lệch nhau là gốc của đơn "ma", phiếu hủy vẫn bị tính, đơn khóa nợ hiện "Đã duyệt")
  {
    const rows = await safeRows(
      `SELECT action, module, details, actor_name, created_at
         FROM audit_logs
        WHERE created_at >= ${since}
          AND (action = 'SYNC_ERROR' OR (action = 'GUARD' AND module = 'STORAGE'
               -- chỉ cấp lại mã đề xuất trùng (không chặn gì): xem mục "Mã đề xuất được cấp lại" mức thấp
               AND NOT (details ILIKE '%cấp lại mã%' AND details NOT ILIKE '%chặn%' AND details NOT ILIKE '%giữ lại%')))
        ORDER BY created_at DESC LIMIT ${MAX_ROWS}`
    );
    sections.push({
      key: "system_errors",
      title: "Lỗi lưu / đồng bộ dữ liệu",
      severity: "high",
      why: "Máy chủ không đồng bộ được dữ liệu hoặc đã chặn một lần lưu bất thường: màn hình và cơ sở dữ liệu có thể đang lệch nhau.",
      fix: "Mở chứng từ liên quan kiểm tra lại; lỗi lặp lại thì báo Quản trị viên kèm thời điểm để xem nhật ký máy chủ.",
      rows: rows.map(r => ({
        ref: r.action === "SYNC_ERROR" ? "Đồng bộ" : "Chặn lưu",
        detail: String(r.details || "").slice(0, 300),
        actor: r.actor_name,
        at: fmt(r.created_at),
      })),
    });
  }

  // 12. Bản màn hình (app_storage) và CSDL lệch nhau — không phụ thuộc kỳ báo cáo.
  //     Hai bản được cập nhật riêng rẽ; lệch nhau là gốc của: đơn chỉ có trên màn hình (SO26-STOCK-1101..1106),
  //     đơn khóa công nợ hiện "Đã duyệt" (SO26-GS-1158..1163), phiếu đã hủy vẫn bị tính (PX2611-0063).
  {
    const rows = await safeRows(
      `WITH scr AS (
         SELECT COALESCE(NULLIF(x.e->>'order_code', ''), x.e->>'id') AS code, x.e->>'status' AS st,
                COALESCE(x.e->>'customerName', x.e->>'customer_name') AS cust, COALESCE(x.e->>'salesRepName', '') AS rep,
                NULLIF(x.e->>'linkedSalesOrderId', '') AS linked,
                COALESCE(x.e->>'isCreditBlocked', x.e->>'is_credit_blocked', 'false') = 'true' AS blk,
                COALESCE(x.e->>'priceApprovalStatus', x.e->>'price_approval_status', '') AS price_st
           FROM app_storage a, jsonb_array_elements(CASE WHEN jsonb_typeof(a.data) = 'array' THEN a.data ELSE '[]'::jsonb END) x(e)
          WHERE a.key = 'sales_factory_orders'
       ), slip_scr AS (
         SELECT x.e->>'id' AS code,
                (UPPER(COALESCE(x.e->>'status', '')) = 'CANCELLED' OR UPPER(COALESCE(x.e->>'deliveryStatus', '')) = 'CANCELLED'
                 OR COALESCE(x.e->>'cancelledAt', '') <> '') AS cancelled
           FROM app_storage a, jsonb_array_elements(CASE WHEN jsonb_typeof(a.data) = 'array' THEN a.data ELSE '[]'::jsonb END) x(e)
          WHERE a.key = 'sales_delivery_slips'
       )
       SELECT 'Đơn chỉ có trên màn hình, KHÔNG có trong CSDL' AS kind, scr.code AS ref,
              COALESCE(scr.cust, '') || ' — trạng thái màn hình: ' || COALESCE(scr.st, '?') AS detail, scr.rep AS actor
         FROM scr LEFT JOIN sales_orders o ON o.order_code = scr.code OR o.order_code = scr.linked
        WHERE o.id IS NULL AND scr.code ~ '^SO' AND COALESCE(scr.st, '') NOT IN ('Cancelled', 'CANCELLED', 'Rejected')
       UNION ALL
       SELECT 'Màn hình "đã duyệt" nhưng CSDL đang khóa công nợ / chờ duyệt giá', scr.code,
              COALESCE(scr.cust, '') || ' — màn hình: ' || COALESCE(scr.st, '?') || ', CSDL: ' ||
              CASE WHEN o.is_credit_blocked THEN 'khóa công nợ' ELSE 'chờ duyệt giá 0đ' END, scr.rep
         FROM scr JOIN sales_orders o ON o.order_code = scr.code
        WHERE scr.st IN ('Approved', 'Ready', 'Ordered')
          AND UPPER(COALESCE(o.approval_status, '')) <> 'APPROVED'
          -- Chỉ khi màn hình KHÔNG biết đơn đang bị chặn (màn hình có cờ khóa thì vẫn hiện "Khóa nợ" đúng, dù trạng thái lưu là Ready)
          AND ((o.is_credit_blocked AND NOT scr.blk)
               OR (o.price_approval_status = 'PENDING_APPROVAL' AND scr.price_st <> 'PENDING_APPROVAL'))
       UNION ALL
       SELECT 'CSDL đã hủy đơn nhưng màn hình vẫn còn hiệu lực', scr.code,
              COALESCE(scr.cust, '') || ' — màn hình: ' || COALESCE(scr.st, '?'), scr.rep
         FROM scr JOIN sales_orders o ON o.order_code = scr.code
        WHERE (UPPER(COALESCE(o.delivery_status, '')) = 'CANCELLED' OR UPPER(COALESCE(o.approval_status, '')) = 'CANCELLED')
          AND COALESCE(scr.st, '') NOT IN ('Cancelled', 'CANCELLED')
       UNION ALL
       SELECT 'Phiếu giao đã hủy trên màn hình nhưng CSDL còn hiệu lực', ss.code,
              'Đơn ' || COALESCE(sl.order_code, '?') || ' — phiếu vẫn được tính là đã xuất / đã giao', sl.creator_name
         FROM slip_scr ss JOIN sales_delivery_slips sl ON sl.slip_code = ss.code
        WHERE ss.cancelled
          AND NOT (UPPER(COALESCE(sl.status, '')) = 'CANCELLED' OR UPPER(COALESCE(sl.extra_data->>'deliveryStatus', '')) = 'CANCELLED'
                   OR COALESCE(sl.extra_data->>'cancelledAt', '') <> '')
       LIMIT ${MAX_ROWS}`
    );
    sections.push({
      key: "screen_db_mismatch",
      title: "Màn hình và CSDL lệch nhau",
      severity: "high",
      why: "Cùng một chứng từ nhưng màn hình và cơ sở dữ liệu ghi khác nhau: người xem màn hình thấy sai (đơn ma, đơn khóa nợ hiện đã duyệt, phiếu hủy vẫn tính).",
      fix: "Đơn chỉ có trên màn hình: NVKD mở đơn bấm Lưu lại. Các trường hợp khác: tải lại trang Đơn hàng; vẫn còn thì báo Quản trị viên kèm mã chứng từ.",
      rows: rows.map(r => ({ ref: r.ref, detail: `${r.kind}: ${r.detail}`, actor: r.actor || undefined })),
    });
  }

  // 13. Mã đơn đề xuất bị trùng và đã được máy chủ cấp lại (thông tin: dữ liệu không sai, người lập có thể đang giữ mã cũ)
  {
    const rows = await safeRows(
      `SELECT details, actor_name, created_at FROM audit_logs
        WHERE created_at >= ${since} AND action = 'GUARD' AND module = 'STORAGE' AND details ILIKE '%cấp lại mã%'
        ORDER BY created_at DESC LIMIT ${MAX_ROWS}`
    );
    sections.push({
      key: "proposal_recoded",
      title: "Mã đơn đề xuất được cấp lại",
      severity: "low",
      why: "Hai người lập đơn gần như cùng lúc ra cùng một mã; máy chủ giữ mã cho đơn lập trước, cấp số kế tiếp cho đơn sau (ghi trong lịch sử đơn).",
      fix: "Không cần sửa dữ liệu. Người lập dùng mã mới khi trao đổi; mã mới hiện ngay sau khi gửi đơn.",
      rows: rows.map(r => ({
        ref: (String(r.details).match(/[A-Z]+-\d{4}-\d+ -> [A-Z]+-\d{4}-\d+/) || ["Đề xuất"])[0].replace(" -> ", " → "),
        detail: String(r.details || "").replace(/^workspace_proposals:\s*/, "").slice(0, 300),
        actor: r.actor_name,
        at: fmt(r.created_at),
      })),
    });
  }

  const now = new Date();
  const from = new Date(now.getTime() - d * 86400000);
  const order = { high: 0, medium: 1, low: 2 } as const;
  sections.sort((a, b) => order[a.severity] - order[b.severity]);
  return {
    from: from.toISOString(),
    to: now.toISOString(),
    days: d,
    generatedAt: now.toISOString(),
    total: sections.reduce((s, x) => s + x.rows.length, 0),
    sections,
  };
}

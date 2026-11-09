import { NextRequest, NextResponse } from "next/server";
import { query, logAudit, ensurePersonnelTable, withTransaction, httpErrorStatus, HttpError } from "@/backend/db/db";
import { hashPassword, generateTemporaryPassword } from "@/backend/services/passwords";
import { getAuthorizedUser, isAdminUser, isAccountantUser, unauthorizedResponse, forbiddenResponse, setAuditActor } from "@/backend/services/authz";
import { hasPermission, inferSystemRoleFromPosition } from "@/backend/services/permissions";
import { stripCostFields } from "@/backend/services/costVisibility";
import { todayVN, toVNDateString, normalizeExcelDateToISO, formatVNDate } from "@/backend/services/dates";

/** Stock-changing actions and the permissions allowed to run them. */
const WRITE_PERMISSIONS: Record<string, string[]> = {
  inbound: ["warehouse.inbound"],
  update_inbound: ["warehouse.edit_inbound", "warehouse.inbound"],
  outbound: ["warehouse.outbound"],
  update_item: ["warehouse.inbound", "warehouse.edit_inbound", "warehouse.outbound"],
  reserve_stock: ["warehouse.reserve"],
  release_reservation: ["warehouse.reserve"],
  lot_recall: ["warehouse.inbound", "warehouse.outbound"],
  lot_release_quarantine: ["warehouse.inbound", "warehouse.outbound"],
  save_product_component: ["warehouse.inbound"],
  delete_product_component: ["warehouse.inbound"],
};
import { syncPersonnelToZaloBindings } from "@/backend/db/zaloDb";
import { generateDocumentCode } from "@/backend/services/codeGenerator";
import { syncCatalogSuppliersAndProducts, unmarkSupplierDeleted } from "@/backend/services/supplierCatalogSync";
import { resolveActualProductCategory } from "@/backend/services/catalogStore";
import { applyPOReceipt, reconcileHistoricalPOsWithInbound } from "@/backend/services/poReceipt";
import { isPcrKitProduct, packagingFormOfLot } from "@/frontend/utils/packagingForm";
import {
  addStock,
  removeStock,
  reserveStock,
  releaseReservation,
  quarantineLot,
  releaseLotQuarantine,
  ensureProduct,
  appendCommercialCatalogEntry,
  sortByProductCode,
  LOT_EXPIRY_ISO_SQL
} from "@/backend/services/inventoryLedger";

let lastOverviewSyncAt = 0;

export async function GET(req: NextRequest) {
  try {
    // Phiên phải còn hiệu lực (tài khoản chưa bị khóa, mật khẩu chưa đổi): proxy chỉ kiểm tra chữ ký cookie
    const authUser = await getAuthorizedUser(req);
    if (!authUser) return unauthorizedResponse();
    setAuditActor(authUser);
    const canSeeCost = isAdminUser(authUser) || hasPermission(authUser, "warehouse.view_cost_price");
    await ensurePersonnelTable();
    const { searchParams } = new URL(req.url);
    const action = searchParams.get("action") || "overview";

    // Tồn kho theo từng lô (số lô, HSD, vị trí) kèm hãng sản xuất / nhóm hàng / điều kiện bảo quản
    if (action === "lot_stock") {
      const r = await query(`
        SELECT l.id, l.product_code, l.lot_number, ${LOT_EXPIRY_ISO_SQL("l.expiry_date")} AS expiry_date, l.expiry_date AS expiry_raw,
               l.warehouse_location, l.quantity_on_hand,
               COALESCE(res.lot_reserved, 0)::numeric AS quantity_allocated,
               GREATEST(0, COALESCE(l.quantity_on_hand, 0) - COALESCE(res.lot_reserved, 0))::numeric AS available_quantity,
               COALESCE(i.quantity_allocated, 0)::numeric AS product_quantity_allocated,
               COALESCE(l.is_quarantined, false) AS is_quarantined, l.quarantine_reason, l.created_at, l.last_updated,
               COALESCE(p.name, i.product_name, l.product_code) AS product_name,
               p.category, p.manufacturer, p.unit, p.specification, p.storage_condition,
               COALESCE(NULLIF(l.unit_cost, 0), p.cost_price, 0) AS cost_price,
               l.unit_cost,
               i.shelf_position
          FROM inventory_lots l
          LEFT JOIN products p ON p.code = l.product_code
          LEFT JOIN inventory_items i ON i.product_code = l.product_code
          LEFT JOIN (
            SELECT product_code, LOWER(TRIM(lot_number)) AS norm_lot, SUM(COALESCE(quantity_reserved, 0)) AS lot_reserved
              FROM inventory_reservations
             WHERE status = 'ACTIVE' AND lot_number IS NOT NULL AND TRIM(lot_number) <> ''
             GROUP BY product_code, LOWER(TRIM(lot_number))
          ) res ON LOWER(TRIM(res.product_code)) = LOWER(TRIM(l.product_code)) AND res.norm_lot = LOWER(TRIM(l.lot_number))
         WHERE l.quantity_on_hand > 0
         ORDER BY l.product_code ASC, ${LOT_EXPIRY_ISO_SQL("l.expiry_date")} ASC NULLS LAST, l.id ASC
      `);
      const rows = r.rows;
      return NextResponse.json({ lots: canSeeCost ? rows : rows.map(({ cost_price, unit_cost, ...rest }: any) => rest), today: todayVN() });
    }

    // Tồn theo lô, lọc + đếm + chia trang trên máy chủ (hàng chục nghìn lô không phải tải hết về trình duyệt).
    // all=1: trả toàn bộ danh sách đang lọc (xuất Excel).
    if (action === "lot_stock_page") {
      const today = todayVN();
      const nearDays = Math.min(730, Math.max(1, parseInt(searchParams.get("near_days") || "90") || 90));
      const kw = String(searchParams.get("q") || "").trim();
      const manufacturer = String(searchParams.get("manufacturer") || "all");
      const category = String(searchParams.get("category") || "all");
      const location = String(searchParams.get("location") || "all");
      const cls = String(searchParams.get("cls") || "all");
      const productCode = String(searchParams.get("product_code") || "").trim();
      const all = searchParams.get("all") === "1";
      const size = Math.min(500, Math.max(10, parseInt(searchParams.get("size") || "100") || 100));
      const page = Math.max(1, parseInt(searchParams.get("page") || "1") || 1);
      const base = `
        WITH base AS (
          SELECT l.id, l.product_code, l.lot_number, ${LOT_EXPIRY_ISO_SQL("l.expiry_date")} AS expiry_date, l.expiry_date AS expiry_raw,
                 l.warehouse_location, l.quantity_on_hand,
                 COALESCE(l.is_quarantined, false) AS is_quarantined, l.quarantine_reason, l.created_at, l.last_updated,
                 COALESCE(p.name, i.product_name, l.product_code) AS product_name,
                 p.category, p.manufacturer, p.unit, p.specification, p.storage_condition,
                 COALESCE(NULLIF(l.unit_cost, 0), p.cost_price, 0) AS cost_price,
                 l.unit_cost,
                 i.shelf_position
            FROM inventory_lots l
            LEFT JOIN products p ON p.code = l.product_code
            LEFT JOIN inventory_items i ON i.product_code = l.product_code
           WHERE l.quantity_on_hand > 0
        ), k AS (
          SELECT b.*, d.left_days,
                 CASE WHEN d.left_days IS NULL THEN 'no_expiry' WHEN d.left_days < 0 THEN 'expired'
                      WHEN d.left_days <= $2::int THEN 'near' ELSE 'normal' END AS klass
            FROM base b
            CROSS JOIN LATERAL (SELECT CASE WHEN b.expiry_date ~ '^\\d{4}-\\d{2}-\\d{2}' THEN (LEFT(b.expiry_date, 10)::date - $1::date) END AS left_days) d
        )`;
      // bộ lọc (trừ phân loại hạn dùng) dùng chung cho danh sách và bộ đếm
      const where = `($3 = 'all' OR TRIM(COALESCE(manufacturer, '')) = $3)
        AND ($4 = 'all' OR TRIM(COALESCE(category, '')) = $4)
        AND ($5 = 'all' OR TRIM(COALESCE(warehouse_location, '')) = $5)
        AND ($6 = '' OR CONCAT_WS(' ', product_code, product_name, lot_number, manufacturer, shelf_position) ILIKE '%' || $6 || '%')
        AND ($7 = '' OR product_code = $7)`;
      const params = [today, nearDays, manufacturer, category, location, kw, productCode];
      const [rowsRes, countRes, optRes] = await Promise.all([
        query(
          `${base} SELECT *, COUNT(*) OVER () AS total_rows FROM k
            WHERE ${where} AND ($8 = 'all' OR klass = $8)
            ORDER BY product_code ASC, expiry_date ASC NULLS LAST, id ASC
            ${all ? "" : "LIMIT $9 OFFSET $10"}`,
          all ? [...params, cls] : [...params, cls, size, (page - 1) * size]
        ),
        query(`${base} SELECT klass, COUNT(*)::int AS n FROM k WHERE ${where} GROUP BY klass`, params),
        query(`SELECT
                 ARRAY(SELECT DISTINCT TRIM(p.manufacturer) FROM inventory_lots l JOIN products p ON p.code = l.product_code WHERE l.quantity_on_hand > 0 AND TRIM(COALESCE(p.manufacturer, '')) <> '' ORDER BY 1) AS manufacturers,
                 ARRAY(SELECT DISTINCT TRIM(p.category) FROM inventory_lots l JOIN products p ON p.code = l.product_code WHERE l.quantity_on_hand > 0 AND TRIM(COALESCE(p.category, '')) <> '' ORDER BY 1) AS categories,
                 ARRAY(SELECT DISTINCT TRIM(warehouse_location) FROM inventory_lots WHERE quantity_on_hand > 0 AND TRIM(COALESCE(warehouse_location, '')) <> '' ORDER BY 1) AS locations`),
      ]);
      const counts: Record<string, number> = { all: 0, normal: 0, near: 0, expired: 0, no_expiry: 0 };
      for (const r of countRes.rows) { counts[r.klass] = r.n; counts.all += r.n; }
      const total = Number(rowsRes.rows[0]?.total_rows || 0);
      const lots = rowsRes.rows.map(({ total_rows, cost_price, unit_cost, ...rest }: any) => (canSeeCost ? { ...rest, cost_price, unit_cost } : rest));
      return NextResponse.json({ lots, total, page, size, counts, options: optRes.rows[0], today, nearDays });
    }

    // Báo cáo Xuất – Nhập – Tồn theo kỳ: tồn đầu, nhập (mua / trả lại / khác), xuất, tồn cuối theo từng mã hàng
    if (action === "movement_report") {
      const from = String(searchParams.get("from") || "").slice(0, 10);
      const to = String(searchParams.get("to") || "").slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) {
        return NextResponse.json({ error: "Khoảng ngày không hợp lệ" }, { status: 400 });
      }
      // one row per (transaction, product line); classification of each movement
      const mv = await query(`
        SELECT t.transaction_code, t.transaction_type, t.reference_code, t.date, t.notes,
               COALESCE(e->>'product_code', e->>'productCode') AS product_code,
               COALESCE(NULLIF(e->>'quantity', ''), '0')::numeric AS qty
          FROM inventory_transactions t
          CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(t.items) = 'array' THEN t.items ELSE '[]'::jsonb END) e
         WHERE t.date >= $1::date
      `, [from]);
      const cur = await query(`
        SELECT i.product_code, COALESCE(p.name, i.product_name) AS product_name, p.unit, p.category, p.manufacturer, i.quantity_on_hand
          FROM inventory_items i LEFT JOIN products p ON p.code = i.product_code
      `);
      const kindOf = (m: any): string => {
        const notes = String(m.notes || "").toLowerCase();
        const code = String(m.transaction_code || "").toUpperCase();
        if (m.transaction_type === "OUTBOUND") {
          if (notes.includes("điều chỉnh") || notes.includes("kiểm kê")) return "adjust_out";
          return "out";
        }
        if (notes.includes("điều chỉnh") || notes.includes("kiểm kê")) return "adjust_in";
        if (code.includes("-HUY") || code.startsWith("TRK") || notes.includes("nhập lại") || notes.includes("trả hàng") || notes.includes("thu hồi")) return "return_in";
        if (String(m.reference_code || "").toUpperCase().startsWith("PO")) return "purchase_in";
        return "other_in";
      };
      const byCode: Record<string, any> = {};
      const ensure = (code: string) => {
        if (!byCode[code]) byCode[code] = { product_code: code, purchase_in: 0, return_in: 0, other_in: 0, adjust_in: 0, out: 0, adjust_out: 0, after_in: 0, after_out: 0 };
        return byCode[code];
      };
      for (const m of mv.rows) {
        const code = String(m.product_code || "").trim();
        if (!code) continue;
        const q = Number(m.qty) || 0;
        if (q === 0) continue;
        const k = kindOf(m);
        const isIn = k.endsWith("_in");
        const d = toVNDateString(m.date);
        const row = ensure(code);
        if (d > to) {
          if (isIn) row.after_in += q; else row.after_out += q;
        } else {
          row[k] += q;
        }
      }
      const rows = cur.rows.map((c: any) => {
        const m = byCode[c.product_code] || ensure(c.product_code);
        const totalIn = m.purchase_in + m.return_in + m.other_in + m.adjust_in;
        const totalOut = m.out + m.adjust_out;
        const closing = (Number(c.quantity_on_hand) || 0) - m.after_in + m.after_out;
        const opening = closing - totalIn + totalOut;
        return {
          product_code: c.product_code, product_name: c.product_name, unit: c.unit, category: c.category, manufacturer: c.manufacturer,
          opening, purchase_in: m.purchase_in, return_in: m.return_in, other_in: m.other_in, adjust_in: m.adjust_in,
          out: m.out, adjust_out: m.adjust_out, total_in: totalIn, total_out: totalOut, closing
        };
      });
      return NextResponse.json({ from, to, rows });
    }

    if (action === "lot_trace") {
      const lot = searchParams.get("lot_number") || "";
      const productCode = searchParams.get("product_code") || "";
      
      const [itemsRes, txRes, ordersRes, recallsRes] = await Promise.all([
        query("SELECT i.*, p.name as product_name, p.manufacturer, p.unit, p.specification, p.standard_price, p.cost_price FROM inventory_items i JOIN products p ON i.product_code = p.code WHERE i.lot_number ILIKE $1 OR i.product_code ILIKE $2", [`%${lot}%`, `%${productCode || lot}%`]),
        query("SELECT * FROM inventory_transactions WHERE items::text ILIKE $1 OR items::text ILIKE $2 ORDER BY date DESC LIMIT 50", [`%${lot}%`, `%${productCode || lot}%`]),
        query("SELECT id, order_code, customer_name, order_date, delivery_status, sales_rep_name, items, shipping_method, tracking_code, invoiced_delivery_slips FROM sales_orders WHERE items::text ILIKE $1 OR items::text ILIKE $2 ORDER BY order_date DESC LIMIT 50", [`%${lot}%`, `%${productCode || lot}%`]),
        query("SELECT * FROM lot_recalls WHERE lot_number ILIKE $1 OR product_code ILIKE $2 ORDER BY id DESC", [`%${lot}%`, `%${productCode || lot}%`]),
      ]);

      const distributedCustomers: any[] = [];
      ordersRes.rows.forEach((ord: any) => {
        let itms = ord.items;
        if (typeof itms === "string") {
          try { itms = JSON.parse(itms); } catch (e) { itms = []; }
        }
        if (Array.isArray(itms)) {
          itms.forEach((it: any) => {
            const itCode = it.productCode || it.product_code || "";
            const itLot = it.lot_number || it.lotNumber || "";
            const matchLot = !lot || itLot.toLowerCase().includes(lot.toLowerCase()) || !itLot;
            const matchCode = !productCode || itCode.toLowerCase().includes(productCode.toLowerCase()) || (lot && itCode.toLowerCase().includes(lot.toLowerCase()));
            if (matchLot && matchCode) {
              distributedCustomers.push({
                order_code: ord.order_code,
                customer_name: ord.customer_name,
                order_date: ord.order_date,
                delivery_status: ord.delivery_status,
                sales_rep_name: ord.sales_rep_name,
                product_code: itCode,
                product_name: it.productName || it.product_name || itCode,
                lot_number: itLot || lot || "LOT-TIÊU-CHUẨN",
                quantity: Number(it.quantity) || 1,
                unit_price: Number(it.unitPrice || it.unit_price) || 0,
                shipping_method: ord.shipping_method || "Xe lạnh chuyên dụng TBR",
                tracking_code: ord.tracking_code || "TBR-EXP-01"
              });
            }
          });
        }
      });

      const tracePayload = {
        lot_number: lot,
        product_code: productCode,
        inventory_items: itemsRes.rows,
        transactions: txRes.rows,
        distributed_customers: distributedCustomers,
        recalls: recallsRes.rows
      };
      return NextResponse.json(canSeeCost ? tracePayload : stripCostFields(tracePayload));
    }

    if (action === "product_components") {
      const parentCode = searchParams.get("product_code");
      let res;
      if (parentCode) {
        res = await query("SELECT * FROM product_components WHERE parent_product_code = $1 ORDER BY id ASC", [parentCode]);
      } else {
        res = await query("SELECT * FROM product_components ORDER BY parent_product_code ASC, id ASC");
      }
      return NextResponse.json({ product_components: res.rows });
    }

    if (action === "overview") {
      // Đồng bộ tự động 2 chiều giữa products / inventory_lots và inventory_items:
      // Chỉ chạy tối đa 5 phút / lần trên GET (và reset ngay khi có POST nhập/xuất kho) để tránh ghi bảng trên mọi lần mở trang
      if (Date.now() - lastOverviewSyncAt > 5 * 60_000) {
        lastOverviewSyncAt = Date.now();
        await query(`
          INSERT INTO inventory_items (product_id, product_code, product_name, quantity_on_hand, quantity_allocated, warehouse_location, shelf_position)
          SELECT p.id, p.code, p.name, 0, 0, 'Kho Trung Tâm', 'Chưa phân bổ kệ'
            FROM products p
           WHERE NOT EXISTS (SELECT 1 FROM inventory_items i WHERE i.product_code = p.code)
          ON CONFLICT (product_code) DO NOTHING
        `).catch(() => {});

        await query(`
          INSERT INTO inventory_items (product_code, product_name, quantity_on_hand, quantity_allocated, warehouse_location, shelf_position)
          SELECT l.product_code, MAX(COALESCE(p.name, l.product_code)), COALESCE(SUM(l.quantity_on_hand), 0)::int, 0,
                 COALESCE(MAX(l.warehouse_location), 'Kho Trung Tâm'), 'Chưa phân bổ kệ'
            FROM inventory_lots l
            LEFT JOIN products p ON p.code = l.product_code
           WHERE l.quantity_on_hand > 0
             AND NOT EXISTS (SELECT 1 FROM inventory_items i WHERE i.product_code = l.product_code)
           GROUP BY l.product_code
          ON CONFLICT (product_code) DO NOTHING
        `).catch(() => {});

        await query(`
          UPDATE inventory_items i
             SET quantity_on_hand = s.total_qty,
                 lot_number = COALESCE(s.earliest_lot, i.lot_number),
                 expiry_date = COALESCE(s.earliest_exp, i.expiry_date)
            FROM (
              SELECT product_code,
                     COALESCE(SUM(quantity_on_hand), 0)::int AS total_qty,
                     (ARRAY_AGG(NULLIF(lot_number, 'NO-LOT') ORDER BY ${LOT_EXPIRY_ISO_SQL("expiry_date")} ASC NULLS LAST, id ASC) FILTER (WHERE quantity_on_hand > 0))[1] AS earliest_lot,
                     (ARRAY_AGG(expiry_date ORDER BY ${LOT_EXPIRY_ISO_SQL("expiry_date")} ASC NULLS LAST, id ASC) FILTER (WHERE quantity_on_hand > 0))[1] AS earliest_exp
                FROM inventory_lots
               GROUP BY product_code
            ) s
           WHERE i.product_code = s.product_code
             AND (COALESCE(i.quantity_on_hand, -1) <> s.total_qty OR (i.lot_number IS NULL AND s.earliest_lot IS NOT NULL))
        `).catch(() => {});

        await reconcileHistoricalPOsWithInbound(query).catch(() => {});
      }

      // Chạy theo 2 đợt nhỏ thay vì bắn 12 câu lệnh song song cùng lúc để tránh nghẽn connection pool (max 25)
      const [items, transactions, products, reservations, openPOs] = await Promise.all([
        query(`
          SELECT i.*, p.category, p.unit, p.specification, p.standard_price, p.cost_price, p.min_stock_level, p.manufacturer, p.origin, p.storage_condition 
          FROM inventory_items i
          LEFT JOIN products p ON p.code = i.product_code
          ORDER BY (COALESCE(i.quantity_on_hand, 0) > 0) DESC, i.id ASC
        `),
        query(`
          SELECT id, transaction_code, transaction_type, reference_code, date, performed_by, warehouse_name, items,
                 LEFT(COALESCE(notes, ''), 600) AS notes, created_at
            FROM inventory_transactions
           ORDER BY date DESC, id DESC
           LIMIT 100
        `),
        query(`
          SELECT p.*, COALESCE(pc.component_count, 0) AS component_count
          FROM products p
          LEFT JOIN (
            SELECT parent_product_code, COUNT(*)::int AS component_count
              FROM product_components
             GROUP BY parent_product_code
          ) pc ON pc.parent_product_code = p.code
          ORDER BY
            COALESCE(pc.component_count, 0) DESC,
            CASE 
              WHEN p.category ILIKE '%TÁCH CHIẾT%' THEN 1
              WHEN p.category ILIKE '%SHPT%' THEN 2
              WHEN p.category ILIKE '%PCR%' THEN 3
              WHEN p.category ILIKE '%Sinh phẩm%' THEN 4
              WHEN p.category ILIKE '%Enzyme%' OR p.category ILIKE '%Hoá chất SHPT%' THEN 5
              WHEN p.category ILIKE '%Thiết bị%' THEN 6
              ELSE 7
            END,
            p.name ASC
        `),
        query("SELECT * FROM inventory_reservations ORDER BY id DESC"),
        query("SELECT id, po_code, supplier_id, supplier_name, order_date, expected_delivery_date, status, items, received_qty FROM procurement_orders WHERE status NOT IN ('COMPLETED', 'CANCELLED') ORDER BY id DESC"),
      ]);

      const [recallsRes, componentsRes, personnelRes, customersRes, suppliersRes, lotSummary] = await Promise.all([
        query("SELECT * FROM lot_recalls ORDER BY id DESC"),
        query("SELECT * FROM product_components ORDER BY parent_product_code ASC, id ASC"),
        query("SELECT employee_code, full_name, department, position, email, phone FROM personnel WHERE status = 'ACTIVE' ORDER BY id ASC"),
        query("SELECT id, customer_code, name, contact_person, phone, email, address, classification, region, province FROM sales_customers ORDER BY name ASC"),
        query("SELECT id, supplier_code, name, short_name, contact_person, phone, email, address, product_lines, payment_terms, rating FROM procurement_suppliers ORDER BY name ASC")
          .catch(() => query("SELECT id, supplier_code, name, contact_person, phone, email, address, product_lines, payment_terms, rating FROM procurement_suppliers ORDER BY name ASC"))
          .catch(() => ({ rows: [] as any[] })),
        query(`
          SELECT product_code,
                 COUNT(*) FILTER (WHERE quantity_on_hand > 0)::int AS lot_count,
                 COALESCE(SUM(quantity_on_hand), 0)::numeric AS lots_qty,
                 (ARRAY_AGG(lot_number ORDER BY exp ASC NULLS LAST, id ASC) FILTER (WHERE quantity_on_hand > 0))[1] AS earliest_lot,
                 (ARRAY_AGG(exp ORDER BY exp ASC NULLS LAST, id ASC) FILTER (WHERE quantity_on_hand > 0))[1] AS earliest_expiry
            FROM (SELECT l.*, ${LOT_EXPIRY_ISO_SQL("l.expiry_date")} AS exp FROM inventory_lots l) x
           GROUP BY product_code
        `).catch(() => ({ rows: [] as any[] })),
      ]);

      // Calculate incoming PO quantities per product code (Req 7: ATP calculation)
      const incomingByProduct: Record<string, { qty: number; pos: any[] }> = {};
      openPOs.rows.forEach((po: any) => {
        let poItems = po.items;
        if (typeof poItems === "string") {
          try { poItems = JSON.parse(poItems); } catch (e) { poItems = []; }
        }
        if (Array.isArray(poItems)) {
          poItems.forEach((pi: any) => {
            const code = pi.product_code || pi.code;
            if (code) {
              if (!incomingByProduct[code]) incomingByProduct[code] = { qty: 0, pos: [] };
              const q = Number(pi.quantity) || 0;
              incomingByProduct[code].qty += q;
              incomingByProduct[code].pos.push({
                po_code: po.po_code,
                supplier_name: po.supplier_name,
                expected_delivery_date: po.expected_delivery_date,
                status: po.status,
                quantity: q
              });
            }
          });
        }
      });

      const lotsByProduct = new Map<string, any>(lotSummary.rows.map((r: any) => [r.product_code, r]));

      // Phụ kiện thực nhận theo từng lô chính còn tồn, lấy từ các phiếu nhập kho có chứa components
      const [compRes, lotQtyRes] = await Promise.all([
        query(`
          SELECT el->>'product_code' AS product_code, el->>'lot_number' AS parent_lot, c AS comp
            FROM inventory_transactions t
            CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(t.items) = 'array' THEN t.items ELSE '[]'::jsonb END) el
            CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(el->'components') = 'array' THEN el->'components' ELSE '[]'::jsonb END) c
           WHERE t.transaction_type = 'INBOUND'
             AND jsonb_typeof(t.items) = 'array'
             AND t.items::text LIKE '%"components":[{%'
        `).catch(() => ({ rows: [] as any[] })),
        query("SELECT product_code, lot_number, SUM(quantity_on_hand)::numeric AS qty FROM inventory_lots WHERE quantity_on_hand > 0 GROUP BY product_code, lot_number")
          .catch(() => ({ rows: [] as any[] })),
      ]);
      const lotQty = new Map<string, number>(lotQtyRes.rows.map((r: any) => [`${r.product_code}|${r.lot_number}`, Number(r.qty) || 0]));
      const receivedComponents = new Map<string, Map<string, any>>();
      for (const r of compRes.rows) {
        const comp = r.comp || {};
        const parentLot = String(r.parent_lot || "");
        const onHand = lotQty.get(`${r.product_code}|${parentLot}`);
        if (onHand === undefined) continue; // lô chính đã xuất hết
        const perKit = Number(comp.quantity_per_kit) || 1;
        const received = Number(comp.received_qty ?? comp.total_qty);
        const key = `${comp.component_code}|${parentLot}|${comp.lot_number || ""}|${comp.serial_number || ""}`;
        const byProduct = receivedComponents.get(r.product_code) || new Map<string, any>();
        const prev = byProduct.get(key);
        byProduct.set(key, {
          component_code: comp.component_code,
          component_name: comp.component_name,
          specification: comp.specification || "",
          unit: comp.unit || "",
          quantity_per_kit: perKit,
          parent_lot: parentLot,
          // theo định mức của lượng lô chính còn tồn (phụ kiện không có sổ tồn riêng)
          total_quantity: perKit * onHand,
          received_quantity: (prev?.received_quantity || 0) + (Number.isFinite(received) ? received : 0),
          tracking_type: comp.tracking_type || "LOT",
          lot_number: comp.lot_number || "",
          serial_number: comp.serial_number || "",
          needs_serial: Boolean(comp.needs_serial),
          expiry_date: comp.expiry_date || "",
          storage_condition: comp.storage_condition || "",
          qc_status: comp.qc_status || "",
          notes: comp.notes || "",
        });
        receivedComponents.set(r.product_code, byProduct);
      }
      const itemQtyByProduct = new Map<string, number>();
      for (const it of items.rows) itemQtyByProduct.set(it.product_code, (itemQtyByProduct.get(it.product_code) || 0) + (Number(it.quantity_on_hand) || 0));

      // Attach incoming_po_qty & incoming_pos to items
      const enrichedItems = items.rows.map((it: any) => {
        const inc = incomingByProduct[it.product_code] || { qty: 0, pos: [] };
        const ls = lotsByProduct.get(it.product_code);
        const lotsQty = ls ? Number(ls.lots_qty) || 0 : null;
        return {
          ...it,
          incoming_po_qty: inc.qty,
          incoming_pos: inc.pos,
          lot_count: ls ? ls.lot_count : 0,
          earliest_lot: ls?.earliest_lot || null,
          earliest_expiry: ls?.earliest_expiry || null,
          lots_qty: lotsQty,
          received_components: Array.from(receivedComponents.get(it.product_code)?.values() || []),
          // chỉ so khi mã có sổ lô: tồn của mã phải bằng tổng tồn các lô
          lot_mismatch: ls && lotsQty !== itemQtyByProduct.get(it.product_code) ? { product_qty: itemQtyByProduct.get(it.product_code), lots_qty: lotsQty } : null,
        };
      });

      const overviewPayload = {
        items: enrichedItems,
        transactions: transactions.rows,
        products: products.rows,
        reservations: reservations.rows,
        incomingByProduct,
        lot_recalls: recallsRes.rows,
        product_components: componentsRes.rows,
        personnel: personnelRes.rows,
        customers: customersRes.rows,
        suppliers: suppliersRes.rows,
        // PO đang chờ nhập kho (còn dòng chưa nhận đủ) để chọn trên phiếu nhập kho & nhập kho bằng Excel
        pending_pos: openPOs.rows
          .filter((po: any) => !["DRAFT", "CANCELLED"].includes(String(po.status || "").toUpperCase()))
          .map((po: any) => {
            let its: any = po.items;
            if (typeof its === "string") { try { its = JSON.parse(its); } catch { its = []; } }
            const rq = po.received_qty || {};
            const lines = (Array.isArray(its) ? its : []).map((it: any, i: number) => {
              const ordered = Number(it?.quantity) || 0;
              const received = Number(rq[i] ?? rq[String(i)]) || 0;
              return {
                line_index: i,
                product_code: it?.product_code || "",
                product_name: String(it?.product_name || "").replace(/^\[[A-Z]{2}\d{2}-[^\]]+\]\s*/, ""),
                specification: it?.specification || "",
                unit: it?.unit || "Hộp",
                ordered,
                received,
                remaining: Math.max(0, ordered - received),
                unit_price: Number(it?.unit_price) || 0,
              };
            });
            return {
              id: po.id,
              po_code: po.po_code,
              supplier_id: po.supplier_id,
              supplier_name: po.supplier_name,
              status: po.status,
              order_date: po.order_date,
              expected_delivery_date: po.expected_delivery_date,
              lines,
            };
          })
          .filter((po: any) => po.lines.some((l: any) => l.remaining > 0)),
      };
      return NextResponse.json(canSeeCost ? overviewPayload : stripCostFields(overviewPayload));
    }

    return NextResponse.json({ error: "Hành động không hợp lệ" }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: httpErrorStatus(error) });
  }
}

export async function POST(req: NextRequest) {
  try {
    lastOverviewSyncAt = 0;
    const { searchParams } = new URL(req.url);
    const body = await req.json();
    const action = searchParams.get("action") || body?.action;

    const me = await getAuthorizedUser(req);
    setAuditActor(me);
    if (!me) return unauthorizedResponse();
    const needed = WRITE_PERMISSIONS[action || ""];
    const isAccountantAllowed = action === "update_inbound" && isAccountantUser(me);
    if (needed && !isAdminUser(me) && !isAccountantAllowed && !needed.some(k => hasPermission(me, k))) {
      // Phiếu giao hàng lập ở phân hệ Kinh doanh xuất / nhập kho cho đúng một đơn hàng đã có trong CSDL
      const ref = String(body?.reference_code || "").trim();
      const isOrderMovement = (action === "inbound" || action === "outbound") && ref !== "" && hasPermission(me, "sales.view") &&
        (await query("SELECT 1 FROM sales_orders WHERE order_code = $1 LIMIT 1", [ref])).rows.length > 0;
      if (!isOrderMovement) return forbiddenResponse("Bạn không có quyền thực hiện nghiệp vụ kho này.");
    }
    // Người thực hiện được ghi theo phiên đăng nhập (giao diện từng gửi tên thủ kho cố định)
    if (body && typeof body === "object" && !Array.isArray(body)) {
      const actorName = me.full_name || me.username;
      body.performed_by = actorName;
      body.actor = actorName;
      body.reported_by = actorName;
      body.released_by = actorName;
    }

    if (action === "inbound") {
      const { transaction_code, date, performed_by, reference_code, items, notes, warehouse_name, supplier_name, vat_invoice_no, inbound_reason } = body;
      if (!String(supplier_name || "").trim()) {
        return NextResponse.json({ error: "Vui lòng chọn hoặc nhập Tên Nhà Cung Cấp / Nguồn Hàng (*)." }, { status: 400 });
      }
      if (!String(date || "").trim()) {
        return NextResponse.json({ error: "Vui lòng nhập Ngày Nhập Kho (*)." }, { status: 400 });
      }
      if (!String(warehouse_name || "").trim()) {
        return NextResponse.json({ error: "Vui lòng chọn Kho Tiếp Nhận (*)." }, { status: 400 });
      }
      if (!String(performed_by || "").trim()) {
        return NextResponse.json({ error: "Vui lòng nhập Thủ Kho / Người Tiếp Nhận (*)." }, { status: 400 });
      }
      // M2: atomic sequence instead of Date.now().slice(-6)
      const code = transaction_code || (await generateDocumentCode({ docType: "PNK", tagMode: "GENERAL" }));
      const lines = sortByProductCode(
        (Array.isArray(items) ? items : []).filter((it: any) => it && (it.product_code || it.productCode)),
        (it: any) => it.product_code || it.productCode
      );
      if (lines.length === 0) {
        return NextResponse.json({ error: "Phiếu nhập kho phải có ít nhất 1 mặt hàng hợp lệ." }, { status: 400 });
      }
      for (const it of lines) {
        const pCode = String(it.product_code || it.productCode || "").trim();
        const pName = String(it.product_name || it.name || "").trim();
        if (!pCode || !pName) {
          return NextResponse.json({ error: `Dòng hàng "${pCode || pName || "SP"}" thiếu Mã Hàng hoặc Tên Sản Phẩm (*).` }, { status: 400 });
        }
        const qty = Number(it.quantity) || 0;
        if (!(qty > 0)) {
          return NextResponse.json({ error: `Mặt hàng "${pCode}" chưa nhập Số Lượng Nhập (> 0) (*).` }, { status: 400 });
        }
        const lot = String(it.lot_number || it.lotNumber || "").trim();
        if (!lot) {
          return NextResponse.json({ error: `Mặt hàng "${pCode}" chưa nhập Số Lô (LOT / Batch) (*).` }, { status: 400 });
        }
        const exp = String(it.expiry_date || it.expiryDate || "").trim();
        // Lô không bắt buộc có hạn sử dụng (thiết bị, vật tư hoặc lô K.HSD để trống EXP)
        if (!exp) {
          it.no_expiry = true;
        }
        const uPrice = Number(it.unit_price ?? it.cost_price ?? 0);
        if (!Number.isFinite(uPrice) || uPrice < 0) {
          return NextResponse.json({ error: `Mặt hàng "${pCode}" có Đơn Giá Nhập không hợp lệ.` }, { status: 400 });
        }
        const sCond = String(it.storage_condition || it.storageCondition || "").trim();
        if (!sCond) {
          it.storage_condition = "15–25°C (Nhiệt độ phòng - RT)";
        }
      }

      // H1/H2/H4: document + stock + lots + catalog in ONE transaction (all-or-nothing)
      await withTransaction(async (c) => {
        // Unique index on transaction_code turns a double submit into a 409 instead of double stock
        await c.query(
          `INSERT INTO inventory_transactions (transaction_code, transaction_type, reference_code, date, performed_by, warehouse_name, items, notes)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            code,
            "INBOUND",
            reference_code || vat_invoice_no || "N/A",
            normalizeExcelDateToISO(date, todayVN()),
            performed_by || "Thủ kho TBR",
            warehouse_name || "Kho Trung Tâm",
            // NCC / số HĐ của phiếu gắn vào từng dòng chưa có (phiếu nhập từ Excel trước đây chỉ gửi ở đầu phiếu
            // nên chi tiết phiếu / Thẻ kho / công nợ NCC không thấy NCC)
            JSON.stringify((Array.isArray(items) ? items : []).map((it: any) => (it && typeof it === "object") ? {
              ...it,
              supplier_name: String(it.supplier_name || "").trim() || String(supplier_name || "").trim(),
              ...(vat_invoice_no && !it.vat_invoice_no ? { vat_invoice_no } : {}),
            } : it)),
            notes || (supplier_name ? `Nhà cung cấp: ${supplier_name}` : "")
          ]
        );

        const catalogEntries: any[] = [];
        for (const item of lines) {
          const pCode = item.product_code || item.productCode;
          const resolvedItemCat = resolveActualProductCategory({
            code: pCode,
            name: item.product_name || item.name || pCode,
            category: item.category || "",
          });
          // Yêu cầu 2: Auto-insert into products if not existing (Master Data On-The-Fly) — race-free upsert
          const { id: prodId } = await ensureProduct(c, {
            code: pCode,
            name: item.product_name || item.name || pCode,
            category: resolvedItemCat,
            unit: item.unit || "Hộp",
            specification: item.specification || "",
            standard_price: Number(item.standard_price) || 0, // ĐỂ TRỐNG GIÁ BÁN (0) NẾU CHƯA THIẾT LẬP ĐỂ QUẢN LÝ ĐỊNH GIÁ
            cost_price: Number(item.cost_price) || Number(item.unit_price) || 0,
            manufacturer: item.manufacturer || item.brand || "TBR Phân Phối", // nhà cung cấp của phiếu nhập không phải hãng sản xuất
            origin: item.origin || "Nhập khẩu / Chính hãng",
            min_stock_level: item.min_stock_level || 10,
            storage_condition: item.storage_condition || item.storageCondition || null
          });

          // Đồng bộ sang Danh mục sản phẩm kinh doanh (sales_commercial_products) — appended atomically at the end
          catalogEntries.push({
            code: pCode,
            name: item.product_name || item.name || pCode,
            category: resolvedItemCat,
            brand: item.manufacturer || item.brand || "TBR Phân Phối",
            origin: item.origin || "Chính hãng",
            unit: item.unit || "Hộp",
            specification: item.specification || "",
            costPrice: Number(item.cost_price) || Number(item.unit_price) || 0,
            price: Number(item.standard_price) || 0, // 0 nếu chưa có giá để cảnh báo
            priceDealer1: Number(item.standard_price) ? Math.round(Number(item.standard_price) * 0.85) : 0,
            priceDealer2: Number(item.standard_price) ? Math.round(Number(item.standard_price) * 0.8) : 0,
            storageCondition: item.storage_condition || item.storageCondition || "",
            leadTime: "Có sẵn kho",
            notes: `Tự động tạo từ Nhập kho ${code}`
          });

          // H2: lot-aware upsert (no more overwriting lot_number / expiry_date of existing stock)
          const rawItemExp = item.expiry_date || item.expiryDate || "";
          await addStock(c, {
            productCode: pCode,
            productName: item.product_name || item.name || pCode,
            productId: prodId,
            qty: Number(item.quantity) || 0,
            lotNumber: item.lot_number || item.lotNumber || null,
            expiryDate: rawItemExp ? (normalizeExcelDateToISO(rawItemExp, String(rawItemExp).trim()) || null) : null,
            location: item.storage_location || warehouse_name || null,
            shelf: item.shelf_position || null,
            unitCost: Number(item.cost_price) || Number(item.unit_price) || 0,
          });
        }
        // app_storage row is locked last (global lock order) to avoid deadlocks between concurrent receipts
        for (const entry of catalogEntries) {
          await appendCommercialCatalogEntry(c, entry);
        }

        // Nếu phiếu nhập kho gắn với mã PO: chỉ đồng bộ số lượng thực nhận (received_qty) & trạng thái PO (không ghi đè đơn giá PO)
        if (reference_code && /^PO/i.test(String(reference_code).trim())) {
          await applyPOReceipt(
            c,
            String(reference_code).trim(),
            lines.map((it: any) => ({
              product_code: String(it.product_code || it.productCode || "").trim(),
              quantity: Number(it.quantity) || 0,
            })),
            code
          );
          const cleanInvNo = String(vat_invoice_no || "").trim();
          if (cleanInvNo && cleanInvNo.toUpperCase() !== "N/A") {
            const invDate = normalizeExcelDateToISO(date, todayVN());
            await c.query(
              `UPDATE procurement_orders
                  SET supplier_invoices = COALESCE(supplier_invoices, '[]'::jsonb) || $1::jsonb
                WHERE UPPER(TRIM(po_code)) = UPPER(TRIM($2))`,
              [JSON.stringify([{ invoice_no: cleanInvNo.slice(0, 100), invoice_date: invDate, inbound_code: code }]), String(reference_code).trim()]
            ).catch(() => {});
          }
        }
      });

      await logAudit("INBOUND", "WAREHOUSE", `Nhập kho theo phiếu ${code} (Tham chiếu: ${reference_code || vat_invoice_no || "N/A"})${inbound_reason ? ` - ${inbound_reason}` : ""}`);
      return NextResponse.json({ success: true, transaction_code: code });
    }

    if (action === "update_inbound") {
      const { id, transaction_code, date, performed_by, reference_code, items, notes, warehouse_name, supplier_name, vat_invoice_no } = body;
      const targetCode = String(transaction_code || "").trim();
      const targetId = id ? Number(id) : null;
      if (!targetCode && !targetId) {
        return NextResponse.json({ error: "Thiếu mã hoặc ID phiếu nhập kho cần chỉnh sửa" }, { status: 400 });
      }
      if (!String(supplier_name || "").trim()) {
        return NextResponse.json({ error: "Vui lòng chọn hoặc nhập Tên Nhà Cung Cấp / Nguồn Hàng (*)." }, { status: 400 });
      }
      if (!String(date || "").trim()) {
        return NextResponse.json({ error: "Vui lòng nhập Ngày Nhập Kho (*)." }, { status: 400 });
      }
      if (!String(warehouse_name || "").trim()) {
        return NextResponse.json({ error: "Vui lòng chọn Kho Tiếp Nhận (*)." }, { status: 400 });
      }
      if (!String(performed_by || "").trim()) {
        return NextResponse.json({ error: "Vui lòng nhập Thủ Kho / Người Tiếp Nhận (*)." }, { status: 400 });
      }
      const newItems = (Array.isArray(items) ? items : []).filter((it: any) => it && (it.product_code || it.productCode));
      if (newItems.length === 0) {
        return NextResponse.json({ error: "Phiếu nhập kho phải có ít nhất 1 mặt hàng hợp lệ" }, { status: 400 });
      }
      for (const it of newItems) {
        const pCode = String(it.product_code || it.productCode || "").trim();
        const pName = String(it.product_name || it.name || "").trim();
        if (!pCode || !pName) {
          return NextResponse.json({ error: `Dòng hàng "${pCode || pName || "SP"}" thiếu Mã Hàng hoặc Tên Sản Phẩm (*).` }, { status: 400 });
        }
        const qty = Number(it.quantity) || 0;
        if (!(qty > 0)) {
          return NextResponse.json({ error: `Mặt hàng "${pCode}" chưa nhập Số Lượng Nhập (> 0) (*).` }, { status: 400 });
        }
        const lot = String(it.lot_number || it.lotNumber || "").trim();
        if (!lot) {
          return NextResponse.json({ error: `Mặt hàng "${pCode}" chưa nhập Số Lô (LOT / Batch) (*).` }, { status: 400 });
        }
        const exp = String(it.expiry_date || it.expiryDate || "").trim();
        // Lô không bắt buộc có hạn sử dụng (thiết bị, vật tư hoặc lô K.HSD để trống EXP)
        if (!exp) {
          it.no_expiry = true;
        }
        const uPrice = Number(it.unit_price ?? it.cost_price ?? 0);
        if (!Number.isFinite(uPrice) || uPrice < 0) {
          return NextResponse.json({ error: `Mặt hàng "${pCode}" có Đơn Giá Nhập không hợp lệ.` }, { status: 400 });
        }
        const sCond = String(it.storage_condition || it.storageCondition || "").trim();
        if (!sCond) {
          it.storage_condition = "15–25°C (Nhiệt độ phòng - RT)";
        }
      }

      await query("ALTER TABLE inventory_lots ADD COLUMN IF NOT EXISTS unit_cost NUMERIC DEFAULT 0").catch(() => {});

      let finalTxCode = targetCode;
      await withTransaction(async (c) => {
        const txRes = await c.query(
          `SELECT * FROM inventory_transactions
            WHERE ($1::int IS NOT NULL AND id = $1::int)
               OR ($2::text != '' AND transaction_code = $2::text)
            ORDER BY id DESC LIMIT 1 FOR UPDATE`,
          [Number.isFinite(targetId) ? targetId : null, targetCode]
        );
        const existingTx = txRes.rows[0];
        if (!existingTx) {
          throw new HttpError(404, "Không tìm thấy phiếu nhập kho cần chỉnh sửa");
        }
        if (existingTx.transaction_type !== "INBOUND") {
          throw new HttpError(400, "Chỉ hỗ trợ chỉnh sửa/bổ sung chứng từ Phiếu Nhập Kho (INBOUND)");
        }
        finalTxCode = targetCode || existingTx.transaction_code;

        let oldItems: any[] = [];
        try {
          oldItems = typeof existingTx.items === "string" ? JSON.parse(existingTx.items || "[]") : (Array.isArray(existingTx.items) ? existingTx.items : []);
        } catch {
          oldItems = [];
        }

        const matchedOldIndices = new Set<number>();

        for (const item of newItems) {
          const pCode = String(item.product_code || item.productCode || "").trim();
          const pName = String(item.product_name || item.name || pCode).trim();
          const newQty = Number(item.quantity) || 0;
          const newLot = String(item.lot_number || item.lotNumber || "").trim();
          const rawExp = item.expiry_date || item.expiryDate || "";
          const newExp = rawExp ? (normalizeExcelDateToISO(rawExp, String(rawExp).trim()) || null) : null;
          const newLoc = String(item.storage_location || warehouse_name || existingTx.warehouse_name || "Kho Trung Tâm").trim();
          const newShelf = String(item.shelf_position || "Chưa phân bổ kệ").trim();
          const newStorageCond = String(item.storage_condition || item.storageCondition || "").trim();
          const newUnitCost = Number(item.cost_price ?? item.unit_price ?? 0) || 0;

          const resolvedItemCat = resolveActualProductCategory({
            code: pCode,
            name: pName,
            category: item.category || "",
          });

          const { id: prodId } = await ensureProduct(c, {
            code: pCode,
            name: pName,
            category: resolvedItemCat,
            unit: item.unit || "Hộp",
            specification: item.specification || "",
            standard_price: Number(item.standard_price) || 0,
            cost_price: newUnitCost,
            manufacturer: item.manufacturer || item.brand || "TBR Phân Phối",
            origin: item.origin || "Nhập khẩu / Chính hãng",
            min_stock_level: item.min_stock_level || 10,
            storage_condition: newStorageCond || undefined
          });

          if (newStorageCond || newUnitCost > 0) {
            await c.query(
              `UPDATE products
                  SET storage_condition = CASE WHEN $1::text != '' THEN $1::text ELSE storage_condition END,
                      cost_price = CASE WHEN $2::numeric > 0 THEN $2::numeric ELSE cost_price END
                WHERE code = $3`,
              [newStorageCond, newUnitCost, pCode]
            );
          }

          // Match with an old item line (by _orig_product_code + _orig_lot_number or product_code)
          const origCode = String(item._orig_product_code || pCode).trim();
          const origLot = String(item._orig_lot_number ?? "").trim();
          let matchedOldIdx = oldItems.findIndex((o, idx) =>
            !matchedOldIndices.has(idx) &&
            String(o.product_code || o.productCode || "").trim() === origCode &&
            String(o.lot_number || o.lotNumber || "").trim() === origLot
          );
          if (matchedOldIdx === -1) {
            matchedOldIdx = oldItems.findIndex((o, idx) =>
              !matchedOldIndices.has(idx) &&
              String(o.product_code || o.productCode || "").trim() === origCode
            );
          }

          if (matchedOldIdx !== -1) {
            matchedOldIndices.add(matchedOldIdx);
            const oldItem = oldItems[matchedOldIdx];
            const oldQty = Number(oldItem.quantity) || 0;
            const oldLot = String(oldItem.lot_number || oldItem.lotNumber || "").trim() || "NO-LOT";
            const targetLot = newLot || "NO-LOT";
            const qtyDiff = newQty - oldQty;

            await c.query(
              `UPDATE inventory_items
                  SET quantity_on_hand = GREATEST(0, COALESCE(quantity_on_hand, 0) + $1),
                      shelf_position = COALESCE($2, shelf_position),
                      warehouse_location = COALESCE($3, warehouse_location),
                      lot_number = CASE WHEN $4::text != '' THEN $4::text ELSE lot_number END,
                      expiry_date = CASE WHEN $5::text IS NOT NULL THEN $5::text ELSE expiry_date END,
                      last_updated = CURRENT_TIMESTAMP
                WHERE product_code = $6`,
              [qtyDiff, newShelf || null, newLoc || null, newLot, newExp, pCode]
            );

            const lotRows = await c.query(
              `SELECT id, lot_number, warehouse_location, quantity_on_hand FROM inventory_lots WHERE product_code = $1 ORDER BY id ASC FOR UPDATE`,
              [pCode]
            );
            const matchedLotRow =
              lotRows.rows.find((r: any) => String(r.lot_number || "").trim().toLowerCase() === oldLot.toLowerCase()) ||
              lotRows.rows.find((r: any) => String(r.lot_number || "").trim().toLowerCase() === targetLot.toLowerCase()) ||
              lotRows.rows[0];

            if (matchedLotRow) {
              const conflictRow = lotRows.rows.find(
                (r: any) => r.id !== matchedLotRow.id && r.lot_number === targetLot && r.warehouse_location === newLoc
              );
              if (conflictRow) {
                await c.query(
                  `UPDATE inventory_lots
                      SET quantity_on_hand = GREATEST(0, COALESCE(quantity_on_hand, 0) + $1),
                          expiry_date = COALESCE($2, expiry_date),
                          unit_cost = CASE WHEN $3::numeric > 0 THEN $3::numeric ELSE unit_cost END,
                          last_updated = CURRENT_TIMESTAMP
                    WHERE id = $4`,
                  [Number(matchedLotRow.quantity_on_hand || 0) + qtyDiff, newExp, newUnitCost, conflictRow.id]
                );
                await c.query(`DELETE FROM inventory_lots WHERE id = $1`, [matchedLotRow.id]);
              } else {
                await c.query(
                  `UPDATE inventory_lots
                      SET lot_number = $1,
                          expiry_date = COALESCE($2, expiry_date),
                          warehouse_location = COALESCE($3, warehouse_location),
                          quantity_on_hand = GREATEST(0, COALESCE(quantity_on_hand, 0) + $4),
                          unit_cost = CASE WHEN $5::numeric > 0 THEN $5::numeric ELSE unit_cost END,
                          last_updated = CURRENT_TIMESTAMP
                    WHERE id = $6`,
                  [targetLot, newExp, newLoc, qtyDiff, newUnitCost, matchedLotRow.id]
                );
              }
            } else if (newQty > 0) {
              await addStock(c, {
                productCode: pCode,
                productName: pName,
                productId: prodId,
                qty: newQty,
                lotNumber: newLot || null,
                expiryDate: newExp,
                location: newLoc,
                shelf: newShelf,
                unitCost: newUnitCost,
              });
            }
          } else {
            // Newly added line on existing Inbound Slip
            await addStock(c, {
              productCode: pCode,
              productName: pName,
              productId: prodId,
              qty: newQty,
              lotNumber: newLot || null,
              expiryDate: newExp,
              location: newLoc,
              shelf: newShelf,
              unitCost: newUnitCost,
            });
          }
        }

        // If any old item was removed during editing, deduct its old quantity safely
        for (let idx = 0; idx < oldItems.length; idx++) {
          if (matchedOldIndices.has(idx)) continue;
          const removed = oldItems[idx];
          const rCode = String(removed.product_code || removed.productCode || "").trim();
          const rQty = Number(removed.quantity) || 0;
          const rLot = String(removed.lot_number || removed.lotNumber || "").trim();
          if (rCode && rQty > 0) {
            await removeStock(c, {
              productCode: rCode,
              productName: removed.product_name || rCode,
              qty: rQty,
              lotNumber: rLot || null,
              allowInsufficient: true,
            });
          }
        }

        // Clean internal _orig_* tracking fields before saving items JSON (and preserve existing cost if user had cost stripped)
        const canUserEditCost = isAdminUser(me) || isAccountantUser(me) || hasPermission(me, "warehouse.view_cost_price");
        const cleanItems = newItems.map((it: any) => {
          const copy = { ...it };
          if (!canUserEditCost && !(Number(copy.unit_price) > 0)) {
            const origCode = String(copy._orig_product_code || copy.product_code || copy.productCode || "").trim();
            const origLot = String(copy._orig_lot_number ?? "").trim();
            const oldMatch =
              oldItems.find((o: any) => String(o.product_code || o.productCode || "").trim() === origCode && String(o.lot_number || o.lotNumber || "").trim() === origLot) ||
              oldItems.find((o: any) => String(o.product_code || o.productCode || "").trim() === origCode);
            const prevPrice = Number(oldMatch?.unit_price ?? oldMatch?.cost_price ?? 0);
            if (prevPrice > 0) {
              copy.unit_price = prevPrice;
              copy.cost_price = prevPrice;
            }
          }
          delete copy._orig_product_code;
          delete copy._orig_lot_number;
          delete copy._orig_qty;
          return copy;
        });

        const finalRefCode = reference_code || vat_invoice_no || existingTx.reference_code || "N/A";
        await c.query(
          `UPDATE inventory_transactions
              SET transaction_code = $1,
                  reference_code = $2,
                  date = $3,
                  performed_by = $4,
                  warehouse_name = $5,
                  items = $6,
                  notes = $7
            WHERE id = $8`,
          [
            finalTxCode,
            finalRefCode,
            normalizeExcelDateToISO(date, existingTx.date || todayVN()),
            performed_by || existingTx.performed_by || "Thủ kho TBR",
            warehouse_name || existingTx.warehouse_name || "Kho Trung Tâm",
            JSON.stringify(cleanItems),
            notes ?? existingTx.notes ?? (supplier_name ? `Nhà cung cấp: ${supplier_name}` : ""),
            existingTx.id
          ]
        );

        // Nếu phiếu nhập liên kết với PO: chỉ cập nhật số hóa đơn VAT (nếu có) và số lượng nhận (nếu mới gắn mã PO), KHÔNG ghi đè đơn giá PO
        if (/^PO/i.test(String(finalRefCode).trim())) {
          const poCodeRef = String(finalRefCode).trim();
          const wasLinkedToSamePo =
            String(existingTx.reference_code || "").trim().toUpperCase() === poCodeRef.toUpperCase();
          if (!wasLinkedToSamePo) {
            await applyPOReceipt(
              c,
              poCodeRef,
              cleanItems.map((ci: any) => ({
                product_code: String(ci.product_code || ci.productCode || "").trim(),
                quantity: Number(ci.quantity) || 0,
              })),
              finalTxCode
            );
          }
          const poRes = await c.query(
            `SELECT id, supplier_invoices FROM procurement_orders WHERE UPPER(TRIM(po_code)) = UPPER(TRIM($1)) FOR UPDATE`,
            [poCodeRef]
          );
          if (poRes.rows.length > 0) {
            const poRow = poRes.rows[0];
            let invList: any[] = [];
            try {
              invList = typeof poRow.supplier_invoices === "string" ? JSON.parse(poRow.supplier_invoices || "[]") : (Array.isArray(poRow.supplier_invoices) ? poRow.supplier_invoices : []);
            } catch {
              invList = [];
            }
            const cleanInvNo = String(vat_invoice_no || "").trim();
            if (cleanInvNo && cleanInvNo !== "N/A" && !invList.some((x: any) => String(x?.invoice_no || "").trim() === cleanInvNo)) {
              invList.push({
                invoice_no: cleanInvNo,
                invoice_date: normalizeExcelDateToISO(date, todayVN()),
                inbound_code: finalTxCode
              });
              await c.query(
                `UPDATE procurement_orders
                    SET supplier_invoices = $1::jsonb,
                        version = COALESCE(version, 0) + 1
                  WHERE id = $2`,
                [JSON.stringify(invList), poRow.id]
              );
            }
          }
        }
      });

      await logAudit("UPDATE_INBOUND", "WAREHOUSE", `Chỉnh sửa / bổ sung thông tin Phiếu Nhập Kho ${finalTxCode} (Tham chiếu: ${reference_code || vat_invoice_no || "N/A"}, NCC: ${supplier_name || "—"})`);
      return NextResponse.json({ success: true, transaction_code: finalTxCode });
    }

    if (action === "outbound") {
      const { transaction_code, date, performed_by, reference_code, items, notes, warehouse_name, allow_insufficient_stock } = body;
      const code = transaction_code || (await generateDocumentCode({ docType: "PXK", tagMode: "GENERAL" }));
      const lines = sortByProductCode(
        (Array.isArray(items) ? items : []).filter((it: any) => it && (it.product_code || it.productCode) && Number(it.quantity) > 0),
        (it: any) => it.product_code || it.productCode
      );

      // H1: stock is checked and deducted on LOCKED rows inside one transaction (no TOCTOU, no GREATEST(0,…) masking).
      // Deduct with lot precision (FEFO when no lot is given); quarantined lots are never shipped.
      const shortfalls: string[] = [];
      await withTransaction(async (c) => {
        for (const item of lines) {
          const pCode = item.product_code || item.productCode;
          const res = await removeStock(c, {
            productCode: pCode,
            productName: item.product_name || item.productName || pCode,
            qty: Number(item.quantity) || 0,
            lotNumber: item.lot_number || item.lotNumber || null,
            allowInsufficient: Boolean(allow_insufficient_stock),
            orderCode: reference_code || null // fulfils this order's own reservations first
          });
          if (res.shortfall > 0) shortfalls.push(`${item.product_name || pCode}: thiếu ${res.shortfall}`);
        }
        const finalNotes = shortfalls.length > 0
          ? `${notes || ""} [XUẤT VƯỢT TỒN — ${shortfalls.join("; ")}]`.trim()
          : notes;
        await c.query(
          `INSERT INTO inventory_transactions (transaction_code, transaction_type, reference_code, date, performed_by, warehouse_name, items, notes)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [code, "OUTBOUND", reference_code, normalizeExcelDateToISO(date, todayVN()), performed_by || "Thủ kho TBR", warehouse_name || "Kho Trung Tâm", JSON.stringify(items || []), finalNotes]
        );
      });

      await logAudit("OUTBOUND", "WAREHOUSE", `Xuất kho theo phiếu ${code} (Đơn hàng: ${reference_code || "N/A"})${shortfalls.length ? ` — XUẤT VƯỢT TỒN: ${shortfalls.join("; ")}` : ""}`);
      return NextResponse.json({ success: true, transaction_code: code, shortfalls });
    }

    if (action === "update_item") {
      const {
        product_code,
        old_lot_number,
        lot_number,
        expiry_date,
        cost_price,
        storage_condition,
        shelf_position,
        warehouse_location
      } = body;
      if (!product_code) {
        return NextResponse.json({ error: "Thiếu mã sản phẩm (product_code)" }, { status: 400 });
      }
      await query("ALTER TABLE inventory_lots ADD COLUMN IF NOT EXISTS unit_cost NUMERIC DEFAULT 0").catch(() => {});
      await withTransaction(async (c) => {
        await c.query(
          `UPDATE inventory_items
              SET shelf_position = COALESCE($1, shelf_position),
                  warehouse_location = COALESCE($2, warehouse_location),
                  lot_number = CASE WHEN $3::text IS NOT NULL THEN $3::text ELSE lot_number END,
                  expiry_date = CASE WHEN $4::text IS NOT NULL THEN $4::text ELSE expiry_date END,
                  last_updated = CURRENT_TIMESTAMP
            WHERE product_code = $5`,
          [
            shelf_position ?? null,
            warehouse_location ?? null,
            lot_number !== undefined ? String(lot_number).trim() : null,
            expiry_date !== undefined ? normalizeExcelDateToISO(expiry_date, String(expiry_date).trim()) : null,
            product_code
          ]
        );

        if (storage_condition !== undefined || cost_price !== undefined) {
          const parsedCost = cost_price !== undefined && cost_price !== null && String(cost_price) !== "" ? Number(cost_price) : null;
          await c.query(
            `UPDATE products
                SET storage_condition = CASE WHEN $1::text IS NOT NULL THEN $1::text ELSE storage_condition END,
                    cost_price = CASE WHEN $2::numeric IS NOT NULL AND $2::numeric >= 0 THEN $2::numeric ELSE cost_price END
              WHERE code = $3`,
            [
              storage_condition !== undefined ? String(storage_condition).trim() : null,
              parsedCost,
              product_code
            ]
          );
        }

        const targetOldLot = old_lot_number ? String(old_lot_number).trim() : "";
        const newLot = lot_number !== undefined ? (String(lot_number).trim() || "NO-LOT") : null;
        const newExp = expiry_date !== undefined ? (normalizeExcelDateToISO(expiry_date, String(expiry_date).trim()) || null) : null;
        const newLoc = warehouse_location ? String(warehouse_location).trim() : null;
        const newUnitCost = cost_price !== undefined && cost_price !== null && String(cost_price) !== "" ? Number(cost_price) : null;

        const existingLots = await c.query(
          `SELECT id, lot_number, warehouse_location FROM inventory_lots WHERE product_code = $1 ORDER BY id ASC`,
          [product_code]
        );
        if (existingLots.rows.length > 0) {
          const matchedLotRow =
            existingLots.rows.find((r: any) => String(r.lot_number || "").trim().toLowerCase() === targetOldLot.toLowerCase()) ||
            existingLots.rows[0];
          const targetLotVal = newLot || matchedLotRow.lot_number;
          const targetLocVal = newLoc || matchedLotRow.warehouse_location;
          const conflictRow = existingLots.rows.find(
            (r: any) => r.id !== matchedLotRow.id && r.lot_number === targetLotVal && r.warehouse_location === targetLocVal
          );
          if (conflictRow) {
            await c.query(
              `UPDATE inventory_lots
                  SET expiry_date = CASE WHEN $1::text IS NOT NULL THEN $1::text ELSE expiry_date END,
                      unit_cost = CASE WHEN $2::numeric IS NOT NULL AND $2::numeric >= 0 THEN $2::numeric ELSE unit_cost END,
                      last_updated = CURRENT_TIMESTAMP
                WHERE id = $3`,
              [newExp, newUnitCost, conflictRow.id]
            );
          } else {
            await c.query(
              `UPDATE inventory_lots
                  SET lot_number = COALESCE($1, lot_number),
                      expiry_date = CASE WHEN $2::text IS NOT NULL THEN $2::text ELSE expiry_date END,
                      warehouse_location = COALESCE($3, warehouse_location),
                      unit_cost = CASE WHEN $4::numeric IS NOT NULL AND $4::numeric >= 0 THEN $4::numeric ELSE unit_cost END,
                      last_updated = CURRENT_TIMESTAMP
                WHERE id = $5`,
              [newLot, newExp, newLoc, newUnitCost, matchedLotRow.id]
            );
          }
        } else if (newLot && newLot !== "NO-LOT") {
          const itemRow = await c.query(`SELECT quantity_on_hand, warehouse_location FROM inventory_items WHERE product_code = $1 LIMIT 1`, [product_code]);
          const qtyOnHand = Number(itemRow.rows[0]?.quantity_on_hand) || 0;
          if (qtyOnHand > 0) {
            await c.query(
              `INSERT INTO inventory_lots (product_code, lot_number, expiry_date, warehouse_location, quantity_on_hand, unit_cost)
               VALUES ($1, $2, $3, $4, $5, $6)
               ON CONFLICT DO NOTHING`,
              [product_code, newLot, newExp, newLoc || itemRow.rows[0]?.warehouse_location || "Kho Trung Tâm", qtyOnHand, newUnitCost || 0]
            );
          }
        }
      });
      await logAudit("UPDATE_ITEM", "INVENTORY", `Cập nhật thông tin lô & bảo quản cho ${product_code}: Lô ${lot_number || "—"}, HSD ${expiry_date || "—"}, Bảo quản ${storage_condition || "—"}, Kệ ${shelf_position || "—"}`);
      return NextResponse.json({ success: true });
    }

    if (action === "reserve_stock") {
      const { order_code, customer_name, sales_rep_name, product_code, product_name, lot_number, quantity_reserved, hold_until_date, notes } = body;
      const orderCode = order_code || (await generateDocumentCode({ docType: "RES", tagMode: "GENERAL" }));
      // H5: conditional allocation (must fit into on_hand - allocated) + reservation row, atomically
      const id = await withTransaction((c) =>
        reserveStock(c, {
          orderCode,
          customerName: customer_name,
          salesRepName: sales_rep_name,
          productCode: product_code,
          productName: product_name,
          lotNumber: lot_number || null,
          qty: Number(quantity_reserved) || 1,
          holdUntil: hold_until_date || null,
          notes
        })
      );

      await logAudit("RESERVE_STOCK", "INVENTORY", `Kho giữ ${quantity_reserved} SP (Lô: ${lot_number || 'N/A'}) cho Sales ${sales_rep_name} (KH: ${customer_name})`);
      return NextResponse.json({ success: true, id });
    }

    if (action === "release_reservation") {
      const { reservation_id, reason, actor } = body;
      // H5: CAS on status = 'ACTIVE'; quantity comes from the DB, never from the client. Double-click = no-op.
      const result = await withTransaction((c) =>
        releaseReservation(c, Number(reservation_id), actor || "Thủ kho TBR", reason || "Giải phóng lại cho kho")
      );

      if (result.released) {
        await logAudit("RELEASE_RESERVATION", "INVENTORY", `Giải phóng giữ chỗ ID #${reservation_id} (${result.quantity} ${result.product_code})`);
      }
      return NextResponse.json({ success: true, already_released: !result.released });
    }

    if (action === "lot_recall") {
      const { recall_code, product_code, product_name, lot_number, reason, severity, quarantine_stock, reported_by, affected_orders } = body;
      const code = recall_code || (await generateDocumentCode({ docType: "REC", tagMode: "GENERAL" }));
      await withTransaction(async (c) => {
        await c.query(
          `INSERT INTO lot_recalls (recall_code, product_code, product_name, lot_number, reason, severity, status, quarantine_stock, affected_orders, reported_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [code, product_code, product_name, lot_number, reason, severity || "HIGH", "ACTIVE", quarantine_stock !== false, JSON.stringify(affected_orders || []), reported_by || "QC Manager"]
        );

        if (quarantine_stock !== false && product_code) {
          // H2: quarantine exactly the recalled lot (plus unknown-lot stock, conservatively)
          await quarantineLot(c, product_code, lot_number, `[THU HỒI SỰ CỐ ${code}]: ${reason}`);
        }
      });

      await logAudit("LOT_RECALL", "INVENTORY", `Kích hoạt lệnh thu hồi Lô ${lot_number} cho sản phẩm ${product_code} (${reason})`);
      return NextResponse.json({ success: true, recall_code: code });
    }

    // Phase 3: Smart Excel Importer Engine (Requirement 16)
    if (action === "import_excel") {
      await ensurePersonnelTable();
      const { rows, contact_rows, detected_type } = body;
      // M2: fallback codes for rows without a code. Date.now().slice(-4) produced identical codes for rows
      // processed in the same millisecond, so later rows silently overwrote / were dropped by ON CONFLICT.
      const importBatchStamp = Date.now().toString(36).toUpperCase();
      let importAutoSeq = 0;
      const autoCode = (prefix: string) => `${prefix}-${importBatchStamp}-${++importAutoSeq}`;
      const safeRows = Array.isArray(rows) ? rows : [];
      const safeContactRows = Array.isArray(contact_rows) ? contact_rows : [];
      if (safeRows.length === 0 && safeContactRows.length === 0) {
        return NextResponse.json({ error: "Không có dữ liệu hợp lệ để nạp" }, { status: 400 });
      }

      const sample = rows[0] || {};
      const keys = Object.keys(sample).map(k => k.toLowerCase().trim());

      // 1. Precise Detection Engine: Prioritize Personnel/Accounts over other entities
      const isPersonnel = 
        keys.some(k => k.includes("mã nhân viên") || k.includes("tên đăng nhập") || k.includes("mật khẩu") || k.includes("username") || k.includes("employee_code") || k.includes("mã nv") || k.includes("tài khoản")) ||
        (keys.some(k => k.includes("vai trò") || k.includes("role")) && keys.some(k => k.includes("phòng ban") || k.includes("chức vụ")));

      const isInbound = 
        keys.some(k => k.includes("số lô") || k.includes("hạn sử dụng") || k.includes("hạn dùng") || k.includes("số lượng nhập") || k.includes("mã phiếu nhập") || k.includes("vị trí kho kệ"));

      const isPO = 
        keys.some(k => k.includes("mã đơn po") || k.includes("mã po") || k.includes("số po") || k.includes("po_code") || k.includes("po_number"));

      const isSupplier = 
        keys.some(k => k.includes("mã nhà cung cấp") || k.includes("mã ncc") || k.includes("tên nhà cung cấp") || k.includes("supplier_code"));

      const isProduct = 
        keys.some(k => k.includes("mã sku") || k.includes("giá niêm yết") || k.includes("giá đại lý") || (k.includes("giá vốn") && !k.includes("công nợ")));

      const isCustomer = 
        keys.some(k => k.includes("khách hàng") || k.includes("customer") || k.includes("mã kh") || k.includes("hạn mức công nợ"));

      const VALID_IMPORT_TYPES = ["USERS_PERSONNEL", "CUSTOMERS", "PRODUCTS", "INBOUND_LOT", "PURCHASE_ORDERS", "SUPPLIERS"];
      let detectedType = "UNKNOWN";
      if (detected_type && VALID_IMPORT_TYPES.includes(detected_type)) {
        // Người dùng đã chọn loại dữ liệu: không đoán lại theo tiêu đề cột (file sản phẩm có cột "Số lô"
        // từng bị hiểu nhầm thành phiếu nhập kho và cộng tồn)
        detectedType = detected_type;
      } else if (isPersonnel) {
        detectedType = "USERS_PERSONNEL";
      } else if (isInbound) {
        detectedType = "INBOUND_LOT";
      } else if (isPO) {
        detectedType = "PURCHASE_ORDERS";
      } else if (isSupplier) {
        detectedType = "SUPPLIERS";
      } else if (isProduct) {
        detectedType = "PRODUCTS";
      } else if (isCustomer) {
        detectedType = "CUSTOMERS";
      }

      // Nạp tài khoản / nhân sự (kèm vai trò và mật khẩu) chỉ dành cho quản trị viên; nạp lô nhập kho cần quyền nhập kho
      if (detectedType === "USERS_PERSONNEL" && !isAdminUser(me)) {
        return forbiddenResponse("Chỉ Quản trị viên mới được nạp tài khoản / nhân sự từ Excel.");
      }
      if (detectedType === "INBOUND_LOT" && !isAdminUser(me) && !hasPermission(me, "warehouse.inbound")) {
        return forbiddenResponse("Bạn không có quyền nhập kho từ Excel.");
      }
      if (detectedType === "CUSTOMERS" && !isAdminUser(me) && !hasPermission(me, "sales.view") && !hasPermission(me, "sales.create_order")) {
        return forbiddenResponse("Bạn không có quyền nạp dữ liệu khách hàng từ Excel.");
      }
      if (detectedType === "PRODUCTS" && !isAdminUser(me) && !hasPermission(me, "warehouse.inbound") && !hasPermission(me, "procurement.view") && !hasPermission(me, "sales.view") && !hasPermission(me, "sales.create_order")) {
        return forbiddenResponse("Bạn không có quyền nạp danh mục sản phẩm từ Excel.");
      }
      if ((detectedType === "PURCHASE_ORDERS" || detectedType === "SUPPLIERS") && !isAdminUser(me) && !hasPermission(me, "procurement.view") && !hasPermission(me, "procurement.create_po")) {
        return forbiddenResponse("Bạn không có quyền nạp dữ liệu mua sắm / nhà cung cấp từ Excel.");
      }

      let importedCount = 0;
      const initialCredentials: { username: string; full_name: string; password: string }[] = [];
      const importWarnings: string[] = [];

      // Universal flexible value extractor for any row
      const createGetVal = (r: Record<string, any>) => {
        const rowKeys = Object.keys(r || {});
        return (candidates: string[], defaultValue = ""): string => {
          for (const c of candidates) {
            if (r[c] !== undefined && r[c] !== null && String(r[c]).trim() !== "") {
              return String(r[c]).replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
            }
          }
          for (const cand of candidates) {
            const cleanCand = cand.toLowerCase().replace(/[\s\(\)\*\_]/g, "");
            for (const rk of rowKeys) {
              const cleanRk = rk.toLowerCase().replace(/[\s\(\)\*\_]/g, "");
              if (cleanRk === cleanCand && r[rk] !== undefined && r[rk] !== null && String(r[rk]).trim() !== "") {
                return String(r[rk]).replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
              }
            }
          }
          return defaultValue;
        };
      };

      if (detectedType === "CUSTOMERS") {
        // Group contact_rows by customer_code (case-insensitive & trimmed)
        const contactsMap: Record<string, any[]> = {};
        if (Array.isArray(contact_rows)) {
          contact_rows.forEach((cr) => {
            const getCrVal = createGetVal(cr);
            const rawCode = getCrVal(["Mã khách hàng (*)", "Mã khách hàng", "Mã KH", "customer_code"]).toUpperCase();
            if (rawCode) {
              if (!contactsMap[rawCode]) contactsMap[rawCode] = [];
              const name = getCrVal(["Họ và tên người liên hệ (*)", "Họ và tên (*)", "Họ và tên", "Người liên hệ", "name"]);
              if (name) {
                const isPrimaryStr = getCrVal(["Đầu mối liên hệ chính?", "Là đầu mối chính?", "Người liên hệ chính (Có/Không)", "Người liên hệ chính", "is_primary"]).toLowerCase();
                const isPrimary = isPrimaryStr.includes("có") || isPrimaryStr.includes("yes") || isPrimaryStr === "true" || contactsMap[rawCode].length === 0;
                contactsMap[rawCode].push({
                  id: `CT-${rawCode}-${contactsMap[rawCode].length + 1}`,
                  name,
                  position: getCrVal(["Chức vụ / Vị trí", "Chức vụ", "Vị trí", "position"]),
                  department: getCrVal(["Khoa / Phòng ban", "Phòng ban", "Khoa", "department"]),
                  phone: getCrVal(["Số điện thoại (*)", "Số điện thoại", "SĐT", "phone"]),
                  email: getCrVal(["Email", "email"]),
                  role_type: getCrVal(["Vai trò quyết định", "Vai trò", "role_type"], "Kỹ thuật / Quyết định mua"),
                  is_primary: isPrimary,
                  notes: getCrVal(["Ghi chú cá nhân", "Ghi chú", "notes"])
                });
              }
            }
          });
        }

        // Support Row-Grouping (Phương án 2) in case rows contains duplicate customer_code with multiple contacts
        const uniqueCustomers: Record<string, any> = {};
        const codeByName: Record<string, string> = {};
        for (const r of rows) {
          const getRVal = createGetVal(r);
          let cCode = getRVal(["Mã khách hàng (*)", "Mã khách hàng", "Mã KH", "customer_code"]);
          if (!cCode) {
            const nameKey = getRVal(["Tên khách hàng / Đơn vị (*)", "Tên khách hàng / Cơ quan (*)", "Tên khách hàng (*)", "Tên khách hàng", "name"]).toLowerCase();
            if (nameKey && codeByName[nameKey]) {
              cCode = codeByName[nameKey];
            } else {
              const existingByName = nameKey
                ? await query("SELECT customer_code FROM sales_customers WHERE LOWER(TRIM(name)) = $1 AND customer_code IS NOT NULL LIMIT 1", [nameKey])
                : { rows: [] as any[] };
              cCode = existingByName.rows[0]?.customer_code || autoCode("KH");
              if (nameKey) codeByName[nameKey] = cCode;
            }
          }
          const upperCode = cCode.toUpperCase();
          if (!uniqueCustomers[upperCode]) {
            uniqueCustomers[upperCode] = { ...r, customer_code: cCode, contacts: contactsMap[upperCode] ? [...contactsMap[upperCode]] : [] };
          }
          // If row itself has contact information and it's not already in contacts
          const rowContactName = getRVal(["Họ và tên người liên hệ (*)", "Họ và tên (*)", "Người liên hệ", "contact_person"]);
          if (rowContactName) {
            const existing = uniqueCustomers[upperCode].contacts;
            if (!existing.some((c: any) => c.name.toLowerCase() === rowContactName.toLowerCase())) {
              existing.push({
                id: `CT-${upperCode}-${existing.length + 1}`,
                name: rowContactName,
                position: getRVal(["Chức vụ / Vị trí", "Chức vụ", "contact_position"]),
                department: getRVal(["Khoa / Phòng ban", "Phòng ban"], "Chuyên môn"),
                phone: getRVal(["Số điện thoại (*)", "Số điện thoại", "SĐT", "phone"]),
                email: getRVal(["Email", "email"]),
                role_type: getRVal(["Vai trò quyết định", "Vai trò"], "Kỹ thuật / Quyết định mua"),
                is_primary: existing.length === 0,
                notes: getRVal(["Ghi chú cá nhân", "Ghi chú"])
              });
            }
          }
        }

        let totalContactsCount = 0;
        for (const upperCode of Object.keys(uniqueCustomers)) {
          const r = uniqueCustomers[upperCode];
          const getRVal = createGetVal(r);
          const cCode = r.customer_code;
          // Ô trống -> null: khi khách hàng đã tồn tại thì giữ nguyên giá trị cũ, chỉ dùng mặc định khi tạo mới
          const orNull = (v: string) => (v === "" ? null : v);
          const numOrNull = (v: string) => {
            if (v === "") return null;
            const n = Number(String(v).replace(/[^\d-]/g, "")); // giá VNĐ là số nguyên: bỏ dấu phân cách hàng nghìn
            return Number.isFinite(n) ? n : null;
          };
          const cName = orNull(getRVal(["Tên khách hàng / Đơn vị (*)", "Tên khách hàng / Cơ quan (*)", "Tên khách hàng (*)", "Tên khách hàng", "name"]));
          const cGroup = orNull(getRVal(["Nhóm khách hàng", "Phân loại khách hàng", "classification"]));
          const industry = getRVal(["Ngành hàng", "Ngành hàng (*)", "Nhóm ngành hàng", "Nhóm ngành hàng (*)", "Phân nhóm ngành hàng", "industry"]);
          const taxCode = orNull(getRVal(["Mã số thuế", "tax_code"]));
          const address = orNull(getRVal(["Địa chỉ", "Địa chỉ giao hàng & thanh toán", "address"]));
          const creditLimit = numOrNull(getRVal(["Hạn mức công nợ (VNĐ)", "Hạn mức nợ (VNĐ)", "credit_limit"]));
          const termDays = numOrNull(getRVal(["Thời hạn nợ tối đa (Ngày)", "Thời hạn nợ tối đa (ngày)", "credit_term_days"]));
          const repName = orNull(getRVal(["NVKD phụ trách", "sales_rep_name"]));
          const customerNotes = orNull(getRVal(["Ghi chú chung", "Ghi chú khách hàng", "Ghi chú", "notes"]));

          const contactsList = r.contacts || [];
          totalContactsCount += contactsList.length;

          // Region & Province extraction with auto-inference
          let region = getRVal(["Khu vực (*)", "Khu vực", "Miền", "region"]);
          let province = getRVal(["Tỉnh / Thành phố (*)", "Tỉnh / Thành phố", "Tỉnh/Thành phố", "Tỉnh thành", "Tỉnh", "province"]);
          
          if (!region && province) {
            const pNorm = province.toLowerCase();
            const northProvinces = ["hà nội", "hải phòng", "quảng ninh", "bắc ninh", "hải dương", "hưng yên", "hà nam", "nam định", "thái bình", "ninh bình", "vĩnh phúc", "phú thọ", "thái nguyên", "bắc giang", "tuyên quang", "lạng sơn", "cao bằng", "hà giang", "bắc kạn", "lào cai", "yên bái", "điện biên", "lai châu", "sơn la", "hòa bình"];
            const centralProvinces = ["thanh hóa", "nghệ an", "hà tĩnh", "quảng bình", "quảng trị", "thừa thiên huế", "huế", "đà nẵng", "quảng nam", "quảng ngãi", "bình định", "phú yên", "khánh hòa", "nha trang", "ninh thuận", "bình thuận", "kon tum", "gia lai", "đắk lắk", "đắc lắc", "đắk nông", "lâm đồng", "đà lạt"];
            const southProvinces = ["hồ chí minh", "tp.hcm", "tphcm", "sài gòn", "bà rịa", "vũng tàu", "bình dương", "bình phước", "đồng nai", "tây ninh", "long an", "tiền giang", "bến tre", "vĩnh long", "trà vinh", "hậu giang", "sóc trăng", "đồng tháp", "an giang", "kiên giang", "bạc liêu", "cà mau", "cần thơ"];
            if (northProvinces.some(np => pNorm.includes(np))) region = "Miền Bắc";
            else if (centralProvinces.some(cp => pNorm.includes(cp))) region = "Miền Trung";
            else if (southProvinces.some(sp => pNorm.includes(sp))) region = "Miền Nam";
          }

          // Resolve primary contact for backward-compatible top-level columns
          const primaryContact = contactsList.find((c: any) => c.is_primary) || contactsList[0] || {};
          const contactPerson = primaryContact.name || r["Người liên hệ"] || r["contact_person"] || null;
          const contactPos = primaryContact.position || r["Chức vụ"] || r["contact_position"] || null;
          const phone = primaryContact.phone || r["Số điện thoại"] || r["phone"] || null;
          const email = primaryContact.email || r["Email"] || r["email"] || null;

          const custRes = await query(
            `INSERT INTO sales_customers (customer_code, name, classification, industry, tax_code, contact_person, contact_position, phone, email, address, credit_limit, credit_term_days, sales_rep_name, notes, contacts, region, province)
             VALUES ($1, COALESCE($2, 'Khách hàng mới'), COALESCE($3, 'Bệnh viện / Viện nghiên cứu'), $4, $5, $6, $7, $8, $9, $10,
                     COALESCE($11::numeric, 500000000), COALESCE($12::int, 30), COALESCE($13, 'NVKD'), $14, $15::jsonb, $16, $17)
             ON CONFLICT (customer_code) DO UPDATE
             SET name = COALESCE($2, sales_customers.name),
                 classification = COALESCE($3, sales_customers.classification),
                 industry = COALESCE($4, sales_customers.industry),
                 tax_code = COALESCE($5, sales_customers.tax_code),
                 contact_person = COALESCE($6, sales_customers.contact_person),
                 contact_position = COALESCE($7, sales_customers.contact_position),
                 phone = COALESCE($8, sales_customers.phone),
                 email = COALESCE($9, sales_customers.email),
                 address = COALESCE($10, sales_customers.address),
                 credit_limit = COALESCE($11, sales_customers.credit_limit),
                 credit_term_days = COALESCE($12, sales_customers.credit_term_days),
                 sales_rep_name = COALESCE($13, sales_customers.sales_rep_name),
                 notes = COALESCE($14, sales_customers.notes),
                 contacts = CASE WHEN jsonb_array_length($15::jsonb) > 0 THEN $15::jsonb ELSE sales_customers.contacts END,
                 region = COALESCE($16, sales_customers.region),
                 province = COALESCE($17, sales_customers.province)
             RETURNING id`,
            [cCode, cName, cGroup, industry || null, taxCode, contactPerson, contactPos, phone, email, address, creditLimit, termDays, repName, customerNotes, JSON.stringify(contactsList), region || null, province || null]
          );

          const customerId = custRes.rows[0]?.id;

          // Sync into customer_contacts relational table
          if (customerId && contactsList.length > 0) {
            await query("DELETE FROM customer_contacts WHERE customer_code = $1 OR customer_id = $2", [cCode, customerId]);
            for (const c of contactsList) {
              await query(
                `INSERT INTO customer_contacts (customer_code, customer_id, name, position, department, phone, email, role_type, is_primary, notes)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
                [cCode, customerId, c.name, c.position || null, c.department || null, c.phone || null, c.email || null, c.role_type || null, !!c.is_primary, c.notes || null]
              );
            }
          }

          importedCount++;
        }
        await logAudit("IMPORT_EXCEL", "CUSTOMERS", `Nạp thành công ${importedCount} khách hàng với ${totalContactsCount} người liên hệ từ Excel`);
        return NextResponse.json({ 
          success: true, 
          imported_count: importedCount, 
          contacts_count: totalContactsCount,
          message: `Nạp thành công ${importedCount} khách hàng với tổng cộng ${totalContactsCount} đầu mối liên hệ!`
        });
      } else if (detectedType === "PRODUCTS") {
        // Ô trống -> null: sản phẩm đã có giữ nguyên giá / thông tin cũ (trước đây bị ghi đè thành 0 / mặc định)
        const orNull = (v: string) => (v === "" ? null : v);
        const numOrNull = (v: string) => {
          if (v === "") return null;
          const s = String(v).trim();
          if (!s || /^([-—]+|n\/?a|none|null|chưa có|chua co|liên hệ|lien he|không|khong)$/i.test(s)) return null;
          // Số Excel đọc ra (265000000 hoặc 265000000.5) giữ nguyên; chữ có dấu phân cách hàng nghìn
          // (265.000.000 / 265,000,000) thì bỏ dấu. Trước đây luôn bỏ mọi dấu, nên "26500000.0" thành 265000000.
          const n = /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : Number(s.replace(/[^\d-]/g, ""));
          return Number.isFinite(n) ? n : null;
        };
        const MAX_MIN_STOCK = 1_000_000;
        const PRICE_COLS = ["Giá vốn nhập (VNĐ)", "Giá vốn", "cost_price", "Giá vốn (VNĐ)"];
        const STD_PRICE_COLS = ["Giá niêm yết End-User (VNĐ)", "Giá niêm yết", "standard_price", "Giá bán"];
        const MIN_STOCK_COLS = ["Mức tồn tối thiểu", "min_stock_level", "Tồn tối thiểu"];

        // Kiểm tra cả file trước khi ghi: một ô sai (ví dụ dán nhầm giá 2.650.000.000 vào "Mức tồn tối thiểu")
        // trước đây làm lệnh ghi lỗi giữa chừng ("out of range for type integer"), các dòng trước đã ghi, các dòng
        // sau thì không, và không biết dòng nào sai.
        const rowErrors: string[] = [];
        rows.forEach((r: any, i: number) => {
          const getVal = createGetVal(r);
          const sku = getVal(["Mã SKU (*)", "Mã SKU", "code", "Mã hàng", "SKU"]) || "(không mã)";
          const where = `Dòng ${i + 2} (${sku})`; // dòng 1 của sheet là tiêu đề
          const minRaw = getVal(MIN_STOCK_COLS);
          const minStock = numOrNull(minRaw);
          if (minRaw !== "" && (minStock === null || !Number.isInteger(minStock) || minStock < 0 || minStock > MAX_MIN_STOCK)) {
            rowErrors.push(`${where}: "Mức tồn tối thiểu" = ${minRaw} không hợp lệ (phải là số nguyên từ 0 đến ${MAX_MIN_STOCK.toLocaleString("vi-VN")})`);
          }
          for (const [label, cols] of [["Giá vốn nhập", PRICE_COLS], ["Giá niêm yết", STD_PRICE_COLS]] as [string, string[]][]) {
            const raw = getVal(cols);
            const n = numOrNull(raw);
            if (raw !== "" && (n === null || n < 0)) rowErrors.push(`${where}: "${label}" = ${raw} không phải số tiền hợp lệ`);
          }
        });
        if (rowErrors.length > 0) {
          const shown = rowErrors.slice(0, 20);
          return NextResponse.json({
            error: `File có ${rowErrors.length} ô dữ liệu không hợp lệ, CHƯA nhập dòng nào. Sửa các dòng sau rồi nạp lại:\n${shown.join("\n")}${rowErrors.length > shown.length ? `\n... và ${rowErrors.length - shown.length} lỗi khác` : ""}`,
            row_errors: rowErrors,
          }, { status: 400 });
        }

        for (const r of safeRows) {
          const getVal = createGetVal(r);
          // Hỗ trợ cả file Excel không có dòng tiêu đề chuẩn (cột __EMPTY..__EMPTY_12 theo đúng thứ tự mẫu 13 cột)
          const isHeaderlessAbtRow = r["__EMPTY"] !== undefined && r["__EMPTY_1"] !== undefined && !getVal(["Mã SKU (*)", "Mã SKU", "code", "Mã hàng", "SKU"]);
          const rawCode = isHeaderlessAbtRow ? String(r["__EMPTY"] || "").trim() : getVal(["Mã SKU (*)", "Mã SKU", "code", "Mã hàng", "SKU", "CODE"]);
          const pCode = String(rawCode || autoCode("SKU")).trim();
          const pName = orNull(isHeaderlessAbtRow ? String(r["__EMPTY_1"] || "").trim() : getVal(["Tên sản phẩm (*)", "Tên sản phẩm", "Tên Hàng Hóa Thương Mại", "name", "Tên hàng", "Tên hàng hóa, dịch vụ", "PRODUCT"]));
          const supplierCol = orNull(getVal(["Nhà cung cấp (*)", "Nhà cung cấp", "Nhà Cung Cấp", "supplier", "Đơn vị cung cấp"]));
          // Hãng sản xuất và Nhà cung cấp là hai thông tin khác nhau: không lấy cái này điền cho cái kia
          const brand = orNull(isHeaderlessAbtRow ? String(r["__EMPTY_2"] || "").trim() : getVal(["Hãng sản xuất (*)", "Hãng sản xuất", "Hãng Sản Xuất", "manufacturer", "Hãng SX", "Hãng", "Brand"]));
          const rawCat = orNull(isHeaderlessAbtRow ? String(r["__EMPTY_3"] || "").trim() : getVal([
            "Nhóm ngành hàng (*)", "Nhóm ngành hàng", "Phân Loại Chính", "Phân loại ngành hàng",
            "Phân loại", "category", "Category", "Ngành hàng", "Nhóm hàng", "Danh mục",
            "Danh mục (Category)", "Danh mục (PCR Kit/..)", "Chủng loại", "CHỦNG LOẠI", "Loại Kit"
          ]));
          const cat = resolveActualProductCategory({ code: pCode, name: pName || pCode, category: rawCat || "" });
          const spec = orNull(isHeaderlessAbtRow ? String(r["__EMPTY_4"] || "").trim() : getVal(["Quy cách đóng gói", "specification", "Quy cách", "SIZE"]));
          const unit = orNull(isHeaderlessAbtRow ? String(r["__EMPTY_5"] || "").trim() : getVal(["Đơn vị tính", "unit", "ĐVT"]));
          const cost = numOrNull(isHeaderlessAbtRow ? String(r["__EMPTY_6"] ?? "") : getVal(PRICE_COLS));
          const stdPrice = numOrNull(isHeaderlessAbtRow ? String(r["__EMPTY_7"] ?? "") : getVal(STD_PRICE_COLS));
          const dealer1Price = numOrNull(isHeaderlessAbtRow ? String(r["__EMPTY_8"] ?? "") : getVal(["Giá Đại lý Cấp 1 (VNĐ)", "Giá Dealer Cấp 1 (VNĐ)", "Giá Dealer 1"]));
          const dealer2Price = numOrNull(isHeaderlessAbtRow ? String(r["__EMPTY_9"] ?? "") : getVal(["Giá Đại lý Cấp 2 (VNĐ)", "Giá Dealer Cấp 2 (VNĐ)", "Giá Dealer 2"]));
          const minStock = numOrNull(isHeaderlessAbtRow ? String(r["__EMPTY_10"] ?? "") : getVal(MIN_STOCK_COLS));
          const prodNotes = orNull(isHeaderlessAbtRow ? String(r["__EMPTY_11"] || "").trim() : getVal(["Ghi chú", "Ghi chú kỹ thuật", "THÔNG TIN KỸ THUẬT", "notes"]));
          const storageCondition = (isHeaderlessAbtRow ? String(r["__EMPTY_12"] || "").trim() : getVal([
            "Điều kiện bảo quản chuẩn (*)", 
            "Điều kiện bảo quản chuẩn", 
            "Điều kiện bảo quản tiêu chuẩn", 
            "Điều kiện nhiệt độ bảo quản",
            "Điều kiện bảo quản", 
            "Nhiệt độ bảo quản chuẩn", 
            "Nhiệt độ bảo quản", 
            "storage_condition"
          ])) || null;

          // Giá phải ép kiểu ::numeric: "COALESCE($8, 0)" khiến PostgreSQL suy tham số là integer theo số 0,
          // nên giá từ 2.147.483.648 đ trở lên (ví dụ 2.650.000.000) báo "out of range for type integer".
          await query(
            `INSERT INTO products (code, name, manufacturer, category, specification, unit, cost_price, standard_price, min_stock_level, storage_condition)
             VALUES ($1::text, COALESCE($2::text, $1::text), COALESCE($3, 'TBR'), COALESCE($4, 'Vật tư y tế'), $5, COALESCE($6, 'Hộp'),
                     COALESCE($7::numeric, 0), COALESCE($8::numeric, 0), COALESCE($9::int, 10), $10::text)
             ON CONFLICT (code) DO UPDATE
             SET name = COALESCE($2, products.name),
                 manufacturer = COALESCE($3, products.manufacturer),
                 category = COALESCE($4, products.category),
                 specification = COALESCE($5, products.specification),
                 unit = COALESCE($6, products.unit),
                 cost_price = COALESCE($7, products.cost_price),
                 standard_price = COALESCE($8, products.standard_price),
                 min_stock_level = COALESCE($9, products.min_stock_level),
                 storage_condition = COALESCE($10::text, products.storage_condition)`,
            [pCode, pName, brand, cat, spec, unit, cost, stdPrice, minStock, storageCondition]
          );

          // Ensure inventory item & heal placeholder name if it was created as "Sản phẩm <SKU>"
          await query(
            `INSERT INTO inventory_items (product_code, product_name, quantity_on_hand, quantity_allocated, warehouse_location, shelf_position)
             VALUES ($1, $2, 0, 0, 'Kho Trung Tâm', 'Chưa phân bổ kệ')
             ON CONFLICT (product_code) DO UPDATE
             SET product_name = CASE
                   WHEN (inventory_items.product_name IS NULL OR inventory_items.product_name = '' OR LOWER(inventory_items.product_name) = LOWER(inventory_items.product_code) OR inventory_items.product_name ILIKE 'Sản phẩm %')
                        AND EXCLUDED.product_name <> '' AND EXCLUDED.product_name NOT ILIKE 'Sản phẩm %'
                   THEN EXCLUDED.product_name
                   ELSE inventory_items.product_name
                 END`,
            [pCode, pName || pCode]
          );

          // Đồng bộ sang catalog_items (ghi đè tên/quy cách/hãng nếu đang là placeholder, giữ nguyên giá nếu để trống)
          await appendCommercialCatalogEntry({ query } as any, {
            code: pCode,
            name: pName || pCode,
            category: cat || "Hàng Thương Mại",
            brand: brand || "TBR Phân Phối",
            supplier: supplierCol || "",
            origin: "Chính hãng",
            unit: unit || "Hộp",
            specification: spec || "",
            costPrice: cost ?? 0,
            price: stdPrice ?? 0,
            priceDealer1: dealer1Price ?? (stdPrice ? Math.round(stdPrice * 0.85) : 0),
            priceDealer2: dealer2Price ?? (stdPrice ? Math.round(stdPrice * 0.8) : 0),
            storageCondition: storageCondition || "",
            leadTime: "Có sẵn kho",
            notes: prodNotes || "",
            overwriteCatalogMeta: true,
          });
          importedCount++;
        }

        // Process Sheet 2: Định mức phụ kiện / linh kiện BOM đính kèm nếu có
        let componentsImportedCount = 0;
        if (Array.isArray(contact_rows) && contact_rows.length > 0) {
          const bomByParent = new Map<string, Set<string>>();
          for (const cr of contact_rows) {
            const getCrVal = createGetVal(cr);
            const parentSku = String(getCrVal(["Mã SKU cha (*)", "Mã SKU cha", "Mã sản phẩm chính (*)", "Mã hàng chính", "parent_product_code"]) || "").trim();
            const compCode = String(getCrVal(["Mã phụ kiện / Thành phần (*)", "Mã phụ kiện / Thành phần", "Mã phụ kiện", "Mã thành phần", "component_code"]) || "").trim();
            const compName = String(getCrVal(["Tên phụ kiện / Thành phần (*)", "Tên phụ kiện / Thành phần", "Tên phụ kiện", "Tên thành phần", "component_name"], compCode) || "").trim();
            
            if (parentSku && compCode) {
              const spec = String(getCrVal(["Quy cách", "specification"]) || "").trim();
              const unit = String(getCrVal(["Đơn vị tính", "ĐVT", "unit"], "Cái") || "Cái").trim();
              const qtyPerKit = Number(getCrVal(["Định mức theo bộ (*)", "Định mức theo bộ", "quantity_per_kit"])) || 1;
              const trackingType = getCrVal(["Hình thức quản lý (LOT/SERIAL)", "Hình thức quản lý", "tracking_type"]).toUpperCase().includes("SERIAL") ? "SERIAL" : "LOT";
              const storageCond = String(getCrVal(["Điều kiện bảo quản tiêu chuẩn", "Điều kiện bảo quản", "storage_condition"]) || "").trim();
              const notes = String(getCrVal(["Ghi chú", "notes"]) || "").trim();

              const pKey = parentSku.toUpperCase();
              if (!bomByParent.has(pKey)) bomByParent.set(pKey, new Set());
              bomByParent.get(pKey)!.add(compCode.toUpperCase());

              const existComp = await query(
                `SELECT id FROM product_components WHERE UPPER(TRIM(parent_product_code)) = UPPER(TRIM($1)) AND UPPER(TRIM(component_code)) = UPPER(TRIM($2))`,
                [parentSku, compCode]
              );

              if (existComp.rows.length > 0) {
                await query(
                  `UPDATE product_components 
                   SET parent_product_code = $1, component_code = $2, component_name = $3, specification = $4, unit = $5, quantity_per_kit = $6, 
                       tracking_type = $7, storage_condition = $8, notes = $9
                   WHERE id = $10`,
                  [parentSku, compCode, compName, spec, unit, qtyPerKit, trackingType, storageCond, notes, existComp.rows[0].id]
                );
              } else {
                await query(
                  `INSERT INTO product_components (parent_product_code, component_code, component_name, specification, unit, quantity_per_kit, tracking_type, storage_condition, notes)
                   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
                  [parentSku, compCode, compName, spec, unit, qtyPerKit, trackingType, storageCond, notes]
                );
              }
              componentsImportedCount++;
            }
          }
          // Dọn các dòng phụ kiện cũ bị thừa/lệch của những mã cha có khai báo lại trong Sheet 2
          for (const [parentUpper, validCompCodes] of bomByParent.entries()) {
            const validList = Array.from(validCompCodes);
            if (validList.length > 0) {
              await query(
                `DELETE FROM product_components
                  WHERE UPPER(TRIM(parent_product_code)) = $1
                    AND NOT (UPPER(TRIM(component_code)) = ANY($2::text[]))`,
                [parentUpper, validList]
              );
            }
          }
        }

        await syncCatalogSuppliersAndProducts();

        const auditMsg = componentsImportedCount > 0 
          ? `Nạp thành công ${importedCount} sản phẩm & ${componentsImportedCount} định mức phụ kiện (BOM) từ Excel`
          : `Nạp thành công ${importedCount} sản phẩm & bảng giá từ Excel`;
        await logAudit("IMPORT_EXCEL", "PRODUCTS", auditMsg);

        return NextResponse.json({ 
          success: true, 
          imported_count: importedCount, 
          components_count: componentsImportedCount,
          message: componentsImportedCount > 0 
            ? `Nạp thành công ${importedCount} sản phẩm cùng ${componentsImportedCount} phụ kiện định mức (BOM)!` 
            : `Nạp thành công ${importedCount} sản phẩm & bảng giá!`
        });
      } else if (detectedType === "INBOUND_LOT") {
        const parsedInbound: any[] = [];
        // Trang phụ kiện (sheet 2): mỗi dòng gắn với dòng ở trang 1 có cùng Mã SP chính + Số lô chính
        const compRows: any[] = Array.isArray(contact_rows) ? contact_rows : [];
        const usedComponentRows = new Set<number>();
        const componentErrors: string[] = [];
        const COMP_PARENT_CODE = ["Mã sản phẩm chính (*)", "Mã sản phẩm chính", "Mã hàng chính", "Mã sản phẩm", "parent_product_code"];
        const COMP_PARENT_LOT = ["Số Lô chính (*)", "Số Lô chính", "parent_lot_number"];
        const COMP_RECEIVED = ["Số lượng thực nhận", "received_quantity"];
        // M2: one atomic code for rows without an explicit "Mã Phiếu Nhập" (was Date.now().slice(-6) per row)
        let batchInboundCode: string | null = null;
        const [allProductsRes, allBomRes] = await Promise.all([
          query("SELECT code, name, specification, unit, manufacturer, cost_price, storage_condition FROM products"),
          query("SELECT * FROM product_components ORDER BY id"),
        ]);
        const catalogProdMap = new Map<string, any>();
        for (const pr of allProductsRes.rows) {
          if (pr.code) catalogProdMap.set(String(pr.code).trim().toLowerCase(), pr);
        }
        const bomByParentMap = new Map<string, any[]>();
        for (const bc of allBomRes.rows) {
          const pk = String(bc.parent_product_code || "").trim().toUpperCase();
          if (!pk) continue;
          const arr = bomByParentMap.get(pk) || [];
          arr.push(bc);
          bomByParentMap.set(pk, arr);
        }

        for (const r of rows) {
          const getVal = createGetVal(r);
          const pCode = getVal(["Mã SP", "Mã sản phẩm (*)", "Mã sản phẩm", "Mã hàng", "Mã SKU (*)", "Mã SKU", "product_code", "sku", "code"]);
          const catalogProd = pCode ? catalogProdMap.get(pCode.trim().toLowerCase()) || null : null;
          const pName = getVal(["Tên hàng hóa / Sinh phẩm (*)", "Tên sản phẩm (*)", "Tên hàng hóa", "Tên sản phẩm", "Tên SP", "product_name"], catalogProd?.name || pCode);
          const spec = getVal(["Quy cách đóng gói", "Quy cách", "specification"], catalogProd?.specification || "");
          const unit = getVal(["Đơn vị tính", "Đơn vị tính (ĐVT)", "ĐVT", "unit"], catalogProd?.unit || "Hộp");
          const lot = getVal(["Số Lô (Lot)", "Số Lô (LOT) (*)", "Số Lô (LOT)", "Số Lô sản xuất (*)", "Số Lô", "Lô", "Lot", "lot_number"], "");
          const rawExpDate = getVal(["Hạn dùng (Date)", "Hạn sử dụng (EXP) (*)", "Hạn sử dụng (EXP)", "Hạn sử dụng (*)", "Hạn sử dụng", "Hạn dùng", "Date", "expiry_date"]);
          const expDate = normalizeExcelDateToISO(rawExpDate, "");
          const rawMfgDate = getVal(["Ngày sản xuất (MFG)", "Ngày sản xuất", "mfg_date"]);
          const mfgDate = normalizeExcelDateToISO(rawMfgDate, rawMfgDate);
          const qtyRaw = getVal(["Số lượng", "Số lượng nhập (*)", "Số lượng nhập", "SL", "quantity"]);
          const qty = Number(String(qtyRaw || "0").replace(/[^\d.-]/g, "")) || 0;
          const unitCostRaw = getVal(["Giá trị / Đơn giá đầu kỳ", "Đơn giá đầu kỳ", "Giá đầu kỳ", "Giá trị đầu kỳ", "Đơn giá nhập (VNĐ)", "Đơn giá nhập", "Đơn giá", "Giá vốn", "unit_cost", "cost_price", "unitCost", "costPrice", "price"]);
          const unitCost = unitCostRaw !== "" ? (Number(String(unitCostRaw).replace(/[^\d.-]/g, "")) || 0) : (Number(catalogProd?.cost_price) || 0);
          const totalAmt = Number(getVal(["Thành tiền (VNĐ)", "Thành tiền"])) || (qty * unitCost);
          const storageConditionRaw = getVal(["Nhiệt độ bảo quản", "Điều kiện nhiệt độ bảo quản", "Điều kiện bảo quản", "storage_condition"]);
          const storageCondition = storageConditionRaw || catalogProd?.storage_condition || "15–25°C (Nhiệt độ phòng - RT)";
          const shelf = getVal(["Khu vực / Vị trí kho", "Vị trí tủ / kệ lưu trữ", "Vị trí kho / Tủ lưu trữ", "Vị trí kệ kho", "Vị trí kho", "shelf_position"], "Chưa phân bổ kệ");
          const qcStatus = getVal(["Kiểm nhận / Tình trạng QC", "Tình trạng QC", "qc_status"], "Đạt chuẩn 100% (Nguyên niêm phong & COA)");
          let inboundCode = getVal(["Mã Phiếu Nhập (PNK)", "Mã phiếu nhập", "transaction_code"]);
          if (!inboundCode) {
            batchInboundCode = batchInboundCode || (await generateDocumentCode({ docType: "PNK", tagMode: "GENERAL" }));
            inboundCode = batchInboundCode;
          }
          const rawInboundDate = getVal(["Ngày Nhập Kho (*)", "Ngày Nhập Kho", "Ngày nhập", "inbound_date"], todayVN());
          const inboundDate = normalizeExcelDateToISO(rawInboundDate, todayVN());
          const inboundReason = getVal(["Loại hình / Lý do nhập", "Lý do nhập"], "Nhập mua hàng theo PO từ NCC");
          const poCode = getVal(["Mã Đơn Đặt Hàng (PO)", "Mã Đơn Đặt Hàng (PO) Tham Chiếu", "Mã PO", "reference_code"]);
          const vatInvoice = getVal(["Số Hóa Đơn VAT / Tờ khai HQ", "Số Hóa Đơn VAT / Tờ Khai Hải Quan", "Số Hóa Đơn VAT", "vat_invoice_no"]);
          // Nhà cung cấp chỉ ghi lên phiếu nhập; Nhãn hiệu / Hãng sản xuất là thông tin của sản phẩm
          const supplier = getVal(["Nhà Cung Cấp", "Nhà cung cấp / Nguồn hàng", "supplier_name"]);
          const brandName = getVal(["Nhãn hiệu", "Hãng sản xuất", "manufacturer"], catalogProd?.manufacturer || "");
          const warehouse = getVal(["Kho Tiếp Nhận", "Kho lưu trữ", "Khu vực kho"], "Kho Trung Tâm");
          const performedBy = getVal(["Thủ Kho / Người Tiếp Nhận", "Người tiếp nhận"], "Thủ kho TBR");
          const shippingUnit = getVal(["Đơn vị vận chuyển / Giao hàng", "Đơn vị vận chuyển"]);
          const notes = getVal(["Ghi chú", "Ghi chú chứng từ / Chất lượng", "notes"]);

          if (pCode && qty > 0) {
            if (!String(pName || "").trim()) {
              return NextResponse.json({ error: `Dòng Excel mã "${pCode}" thiếu Tên sản phẩm (*).` }, { status: 400 });
            }
            if (!String(lot || "").trim()) {
              return NextResponse.json({ error: `Dòng Excel mã "${pCode}" chưa nhập Số Lô (LOT) (*).` }, { status: 400 });
            }
            // Lô hàng không bắt buộc có HSD (để trống hoặc ghi "Không có HSD")
            // Cho phép để trống đơn giá / giá bán và điều kiện bảo quản khi nhập kho đầu kỳ bằng Excel
            if (!Number.isFinite(unitCost) || unitCost < 0) {
              return NextResponse.json({ error: `Dòng Excel mã "${pCode}" (lô ${lot}) có Đơn giá không hợp lệ.` }, { status: 400 });
            }
            // Product master, catalog sync and stock are written in the transaction below (H1/H2/H4)
            // Resolve child components (BOM) from Sheet 2 or database
            let itemComponents: any[] = [];
            const label = `${pCode} lô ${lot}`;
            compRows.forEach((cr: any, idx: number) => {
              const g = createGetVal(cr);
              const parentLot = g(COMP_PARENT_LOT);
              if (g(COMP_PARENT_CODE).toUpperCase() !== pCode.toUpperCase() || (parentLot && parentLot !== lot)) return;
              const compCode = g(["Mã thành phần / Phụ kiện (*)", "Mã thành phần / Phụ kiện", "Mã thành phần", "component_code"]);
              if (!compCode) return;
              usedComponentRows.add(idx);
              // Số lượng phụ kiện = Định mức theo bộ × Số lượng của lô chính, trừ khi file ghi số thực nhận khác
              const perKit = Number(g(["Định mức theo bộ", "Định mức theo bộ (*)", "quantity_per_kit"])) || 1;
              const expected = perKit * qty;
              const receivedRaw = g(COMP_RECEIVED);
              let received = expected;
              if (receivedRaw !== "") {
                const n = Number(String(receivedRaw).replace(",", "."));
                if (!Number.isFinite(n) || n < 0) {
                  componentErrors.push(`Trang phụ kiện dòng ${idx + 2} (${compCode} của ${label}): "Số lượng thực nhận" = ${receivedRaw} không hợp lệ`);
                  return;
                }
                received = n;
                if (n !== expected) {
                  importWarnings.push(`${compCode} của ${label}: thực nhận ${n}, định mức ${perKit} × ${qty} = ${expected} (${n > expected ? "thừa" : "thiếu"} ${Math.abs(n - expected)})`);
                }
              }
              const tracking = g(["Hình thức quản lý (LOT/SERIAL)", "Hình thức quản lý", "tracking_type"]).toUpperCase().includes("SERIAL") ? "SERIAL" : "LOT";
              const lotOrSerial = g(["Số Lô (LOT) / Serial (S/N)", "Số Serial (S/N)", "lot_number", "serial_number"]);
              if (tracking === "SERIAL" && !lotOrSerial) {
                importWarnings.push(`${compCode} của ${label}: quản lý theo Serial nhưng chưa có số S/N, cần bổ sung`);
              }
              itemComponents.push({
                component_code: compCode,
                component_name: g(["Tên thành phần / Phụ kiện (*)", "Tên thành phần / Phụ kiện", "Tên thành phần", "component_name"], compCode),
                specification: g(["Quy cách", "specification"]),
                unit: g(["Đơn vị tính", "ĐVT", "unit"], "Cái"),
                quantity_per_kit: perKit,
                expected_qty: expected,
                received_qty: received,
                total_qty: received,
                deviation_qty: received - expected,
                tracking_type: tracking,
                // để trống Số lô phụ kiện = cùng lô với sản phẩm chính
                lot_number: tracking === "LOT" ? (lotOrSerial || lot) : "",
                serial_number: tracking === "SERIAL" ? lotOrSerial : "",
                needs_serial: tracking === "SERIAL" && !lotOrSerial,
                expiry_date: normalizeExcelDateToISO(g(["Hạn dùng (EXP)", "Hạn dùng", "expiry_date"]), g(["Hạn dùng (EXP)", "Hạn dùng", "expiry_date"])) || expDate,
                storage_condition: g(["Nhiệt độ bảo quản riêng", "storage_condition"]) || storageCondition,
                qc_status: g(["Tình trạng QC", "qc_status"]) || qcStatus,
                notes: g(["Ghi chú", "notes"]),
              });
            });

            // Kit PCR (ABT) lô chia sẵn (".C" trong số lô): không kèm phụ kiện, không tự lấy theo định mức
            // (giống form nhập kho; trước đây file Excel vẫn tự gắn phụ kiện cho lô chia sẵn).
            const isPrealiquotPcrLot =
              isPcrKitProduct({ code: pCode, manufacturer: catalogProd?.manufacturer || brandName }) &&
              packagingFormOfLot(lot) === "PREALIQUOT";
            if (isPrealiquotPcrLot && itemComponents.length > 0) {
              importWarnings.push(`${label}: lô chia sẵn (.C) không kèm phụ kiện, nhưng trang phụ kiện có ${itemComponents.length} dòng cho lô này (vẫn ghi theo file, vui lòng kiểm tra)`);
            }

            // Không có dòng nào ở trang phụ kiện cho lô này: lấy theo định mức (BOM), số lượng = định mức × SL lô chính.
            // Phụ kiện quản lý theo Serial để trống S/N (trước đây hệ thống tự sinh số giả "SN-<mã>-<lô>-1").
            if (itemComponents.length === 0 && !isPrealiquotPcrLot) {
              const bomComps = bomByParentMap.get(pCode.toUpperCase()) || [];
              itemComponents = bomComps.map((bc: any) => {
                const perKit = Number(bc.quantity_per_kit) || 1;
                const tracking = String(bc.tracking_type || "").toUpperCase() === "SERIAL" ? "SERIAL" : "LOT";
                if (tracking === "SERIAL") {
                  importWarnings.push(`${bc.component_code} của ${label}: lấy theo định mức, quản lý theo Serial nên cần bổ sung số S/N`);
                }
                return {
                  component_code: bc.component_code,
                  component_name: bc.component_name,
                  specification: bc.specification || "",
                  unit: bc.unit || "Cái",
                  quantity_per_kit: perKit,
                  expected_qty: perKit * qty,
                  received_qty: perKit * qty,
                  total_qty: perKit * qty,
                  deviation_qty: 0,
                  tracking_type: tracking,
                  lot_number: tracking === "LOT" ? lot : "",
                  serial_number: "",
                  needs_serial: tracking === "SERIAL",
                  from_bom: true,
                  expiry_date: expDate,
                  storage_condition: bc.storage_condition || storageCondition,
                  qc_status: qcStatus,
                  notes: bc.notes || ""
                };
              });
            }

            // Collected first; all writes happen below in ONE transaction, sorted by product code
            parsedInbound.push({
              pCode, pName, spec, unit, lot, expDate, qty, unitCost, storageCondition, shelf, warehouse, supplier, brandName, r,
              inboundCode, inboundDate, performedBy, poCode,
              reference: poCode || vatInvoice || lot,
              txNote: `Nhập kho theo Lô ${lot} (HSD: ${expDate ? formatVNDate(expDate, expDate) : "Không có HSD"})${supplier ? ` - NCC: ${supplier}` : ""}${inboundReason ? ` - Lý do: ${inboundReason}` : ""}${notes ? ` - Ghi chú: ${notes}` : ""}`,
              txItem: {
                product_code: pCode,
                product_name: pName,
                quantity: qty,
                unit: unit,
                specification: spec,
                unit_price: unitCost,
                total_amount: totalAmt,
                lot_number: lot,
                expiry_date: expDate,
                no_expiry: !expDate,
                manufacture_date: mfgDate,
                storage_condition: storageCondition,
                shelf_position: shelf,
                qc_status: qcStatus,
                shipping_unit: shippingUnit,
                notes: notes,
                components: itemComponents
              }
            });
            importedCount++;
          }
        }

        // Dòng phụ kiện đã điền Số lô chính / Số lượng thực nhận nhưng không khớp lô nào ở trang 1: báo để kiểm tra
        compRows.forEach((cr: any, idx: number) => {
          if (usedComponentRows.has(idx)) return;
          const g = createGetVal(cr);
          const parentLot = g(COMP_PARENT_LOT);
          if (parentLot || g(COMP_RECEIVED) !== "") {
            importWarnings.push(`Trang phụ kiện dòng ${idx + 2} (${g(COMP_PARENT_CODE)} lô ${parentLot || "?"}): không khớp lô nào ở trang 1 nên không được ghi`);
          }
        });
        if (componentErrors.length > 0) {
          return NextResponse.json({
            error: `Trang phụ kiện có ${componentErrors.length} ô không hợp lệ, CHƯA nhập dòng nào:\n${componentErrors.slice(0, 20).join("\n")}`,
            row_errors: componentErrors,
          }, { status: 400 });
        }

        // H1/H2/H4/M2: whole file is imported atomically. Rows sharing a "Mã Phiếu Nhập" become ONE document
        // (the unique index on transaction_code would otherwise reject the 2nd row); re-importing the same
        // file is rejected with 409 instead of doubling stock.
        try {
          await withTransaction(async (c) => {
            const docs = new Map<string, { reference: string; date: string; performedBy: string; warehouse: string; items: any[]; notes: string[] }>();
            const catalogEntries: any[] = [];
            for (const p of sortByProductCode(parsedInbound, (x: any) => x.pCode)) {
              const resolvedInboundCat = resolveActualProductCategory({
                code: p.pCode,
                name: p.pName,
                category: p.r?.["Nhóm ngành hàng (*)"] || p.r?.["Nhóm ngành hàng"] || p.r?.["Phân loại"] || p.r?.["Phân Loại Chính"] || "",
              });
              // Auto-insert product into master catalog if new (race-free)
              const { id: prodId } = await ensureProduct(c, {
                code: p.pCode,
                name: p.pName,
                category: resolvedInboundCat,
                unit: p.unit,
                specification: p.spec,
                standard_price: Number(p.r["Giá niêm yết"]) || Number(p.r["Giá bán"]) || 0, // Để trống (0) nếu chưa có giá
                cost_price: p.unitCost,
                manufacturer: p.brandName || "TBR Phân Phối",
                origin: "Chính hãng / Tiêu chuẩn ISO",
                min_stock_level: 10,
                storage_condition: p.storageCondition
              });

              // Đồng bộ sang Danh mục sản phẩm kinh doanh (appended atomically at the end)
              catalogEntries.push({
                code: p.pCode,
                name: p.pName,
                category: resolvedInboundCat,
                brand: p.brandName || "TBR Phân Phối",
                origin: "Chính hãng",
                unit: p.unit || "Hộp",
                specification: p.spec || "",
                costPrice: p.unitCost || 0,
                price: Number(p.r["Giá niêm yết"]) || Number(p.r["Giá bán"]) || 0,
                priceDealer1: (Number(p.r["Giá niêm yết"]) || 0) * 0.85,
                priceDealer2: (Number(p.r["Giá niêm yết"]) || 0) * 0.8,
                storageCondition: p.storageCondition,
                leadTime: "Có sẵn kho",
                notes: `Tự động tạo từ Excel ${p.inboundCode}`
              });

              // H2: lot-aware stock upsert
              await addStock(c, {
                productCode: p.pCode,
                productName: p.pName,
                productId: prodId,
                qty: p.qty,
                lotNumber: p.lot,
                expiryDate: p.expDate || null,
                location: p.warehouse || null,
                shelf: p.shelf || null,
                unitCost: p.unitCost || 0,
              });

              const doc = docs.get(p.inboundCode) || { reference: p.reference, date: p.inboundDate, performedBy: p.performedBy, warehouse: p.warehouse, items: [] as any[], notes: [] as string[] };
              doc.items.push(p.txItem);
              doc.notes.push(p.txNote);
              docs.set(p.inboundCode, doc);
            }

            // Log Inbound transaction(s) with comprehensive metadata (truncate joined notes so 1000-row imports don't create 150KB note blobs)
            for (const [docCode, doc] of docs) {
              const summaryNote = doc.notes.length > 10
                ? `${doc.notes.slice(0, 10).join(" | ")} ... (và ${doc.notes.length - 10} lô hàng khác trong phiếu ${docCode})`
                : doc.notes.join(" | ");
              await c.query(
                `INSERT INTO inventory_transactions (transaction_code, transaction_type, reference_code, date, performed_by, warehouse_name, items, notes)
                 VALUES ($1, 'INBOUND', $2, $3, $4, $5, $6, $7)`,
                [docCode, doc.reference, normalizeExcelDateToISO(doc.date, todayVN()), doc.performedBy, doc.warehouse, JSON.stringify(doc.items), summaryNote]
              );
            }
            for (const entry of catalogEntries) {
              await appendCommercialCatalogEntry(c, entry);
            }
            // Dòng có Mã PO: cộng số thực nhận & đồng bộ đơn giá vào đúng dòng của PO đó
            const byPo = new Map<string, { inboundCode: string; lines: { product_code: string; quantity: number; unit_price?: number }[] }>();
            for (const p of parsedInbound) {
              const pc = String(p.poCode || "").trim();
              if (!pc) continue;
              const g = byPo.get(pc) || { inboundCode: p.inboundCode, lines: [] as { product_code: string; quantity: number; unit_price?: number }[] };
              g.lines.push({ product_code: p.pCode, quantity: Number(p.qty) || 0, unit_price: Number(p.unitCost) || 0 });
              byPo.set(pc, g);
            }
            for (const [pc, g] of byPo) {
              await applyPOReceipt(c, pc, g.lines, g.inboundCode);
            }
            if (Array.isArray(contact_rows) && contact_rows.length > 0) {
              for (const cr of contact_rows) {
                const getCrVal = createGetVal(cr);
                const parentSku = getCrVal(["Mã sản phẩm chính (*)", "Mã SKU cha (*)", "Mã SKU cha", "Mã hàng chính", "Mã sản phẩm", "parent_product_code"]);
                const compCode = getCrVal(["Mã thành phần / Phụ kiện (*)", "Mã phụ kiện / Thành phần (*)", "Mã phụ kiện / Thành phần", "Mã phụ kiện", "Mã thành phần", "component_code"]);
                const compName = getCrVal(["Tên thành phần / Phụ kiện (*)", "Tên phụ kiện / Thành phần (*)", "Tên phụ kiện / Thành phần", "Tên phụ kiện", "Tên thành phần", "component_name"], compCode);
                if (parentSku && compCode) {
                  const spec = getCrVal(["Quy cách", "specification"]);
                  const unit = getCrVal(["Đơn vị tính", "ĐVT", "unit"], "Cái");
                  const qtyPerKit = Number(getCrVal(["Định mức theo bộ (*)", "Định mức theo bộ", "quantity_per_kit"])) || 1;
                  const trackingType = getCrVal(["Hình thức quản lý (LOT/SERIAL)", "Hình thức quản lý", "tracking_type"]).toUpperCase().includes("SERIAL") ? "SERIAL" : "LOT";
                  const storageCond = getCrVal(["Nhiệt độ bảo quản riêng", "Điều kiện bảo quản tiêu chuẩn", "Điều kiện bảo quản", "storage_condition"]);
                  const compNotes = getCrVal(["Ghi chú", "notes"]);
                  const existComp = await c.query(
                    `SELECT id FROM product_components WHERE parent_product_code = $1 AND component_code = $2`,
                    [parentSku, compCode]
                  );
                  if (existComp.rows.length > 0) {
                    await c.query(
                      `UPDATE product_components
                       SET component_name = $1, specification = $2, unit = $3, quantity_per_kit = $4,
                           tracking_type = $5, storage_condition = $6, notes = $7
                       WHERE id = $8`,
                      [compName, spec, unit, qtyPerKit, trackingType, storageCond, compNotes, existComp.rows[0].id]
                    );
                  } else {
                    await c.query(
                      `INSERT INTO product_components (parent_product_code, component_code, component_name, specification, unit, quantity_per_kit, tracking_type, storage_condition, notes)
                       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
                      [parentSku, compCode, compName, spec, unit, qtyPerKit, trackingType, storageCond, compNotes]
                    );
                  }
                }
              }
            }
          });
        } catch (e: any) {
          if (e?.code === "23505") {
            throw new HttpError(409, "Mã phiếu nhập trong file đã tồn tại trên hệ thống (file có thể đã được nạp trước đó). Không có dữ liệu nào được ghi.");
          }
          throw e;
        }
        await syncCatalogSuppliersAndProducts();
        await logAudit("IMPORT_EXCEL", "INVENTORY", `Nạp thành công ${importedCount} dòng nhập kho theo Lô/HSD từ Excel`);
      } else if (detectedType === "PURCHASE_ORDERS") {
        for (const r of rows) {
          const getVal = createGetVal(r);
          const poCode = getVal(["Mã đơn PO (*)", "Mã đơn PO", "po_code", "Số PO"]) || autoCode("PO-IMP");
          const supplier = getVal(["Nhà cung cấp (*)", "Nhà cung cấp", "supplier_name", "Tên nhà cung cấp"], "Nhà cung cấp quốc tế");
          const orderDate = normalizeExcelDateToISO(getVal(["Ngày đặt hàng (*)", "Ngày đặt hàng", "order_date"], todayVN()), todayVN());
          const expDelivRaw = getVal(["Hạn giao dự kiến (*)", "Hạn giao dự kiến", "expected_delivery_date"]);
          const expDeliv = expDelivRaw ? (normalizeExcelDateToISO(expDelivRaw, "") || null) : null;
          const pCode = getVal(["Mã sản phẩm SKU (*)", "Mã sản phẩm SKU", "Mã SKU", "product_code"]);
          const pName = getVal(["Tên sản phẩm (*)", "Tên sản phẩm", "product_name"], pCode);
          const qty = Number(getVal(["Số lượng đặt mua (*)", "Số lượng", "quantity"])) || 1;
          const uPrice = Number(getVal(["Đơn giá mua (VNĐ)", "Đơn giá", "unit_price"])) || 0;
          const note = getVal(["Ghi chú giao hàng", "Ghi chú", "notes"], "Nhập từ file Excel PO TBR");

          const items = [{ product_code: pCode, product_name: pName, quantity: qty, unit_price: uPrice, total: qty * uPrice }];
          const totalAmt = qty * uPrice;

          await query(
            `INSERT INTO procurement_orders (po_code, supplier_name, order_date, expected_delivery_date, items, total_amount, status, notes)
             VALUES ($1, $2, $3, $4, $5, $6, 'CONFIRMED', $7)
             ON CONFLICT (po_code) DO NOTHING`,
            [poCode, supplier, orderDate, expDeliv, JSON.stringify(items), totalAmt, note]
          );
          importedCount++;
        }
        await syncCatalogSuppliersAndProducts();
        await logAudit("IMPORT_EXCEL", "PROCUREMENT", `Nạp thành công ${importedCount} dòng đơn đặt hàng PO từ Excel`);
      } else if (detectedType === "SUPPLIERS") {
        for (const r of rows) {
          const getVal = createGetVal(r);
          const sCode = getVal(["Mã NCC (*)", "Mã NCC", "Mã nhà cung cấp", "supplier_code"]) || autoCode("NCC");
          const orNull = (v: string) => (v === "" ? null : v);
          const sName = orNull(getVal(["Tên nhà cung cấp (*)", "Tên nhà cung cấp", "name"]));
          const contact = orNull(getVal(["Người liên hệ", "contact_person", "Người liên hệ (*)"]));
          const phone = orNull(getVal(["Số điện thoại", "phone", "SĐT", "Điện thoại"]));
          const email = orNull(getVal(["Email", "email"]));
          const address = orNull(getVal(["Địa chỉ", "address"]));
          const lines = orNull(getVal(["Ngành hàng cung ứng", "product_lines"]));
          const terms = orNull(getVal(["Điều khoản thanh toán", "payment_terms"]));
          const ratingRaw = getVal(["Đánh giá", "rating"]);
          const rating = ratingRaw !== "" && Number.isFinite(Number(ratingRaw)) ? Number(ratingRaw) : null;

          if (sName) {
            await unmarkSupplierDeleted(sName);
          }

          // Ô trống giữ nguyên thông tin nhà cung cấp đã có
          await query(
            `INSERT INTO procurement_suppliers (supplier_code, name, contact_person, phone, email, address, product_lines, payment_terms, rating)
             VALUES ($1, COALESCE($2, 'Nhà cung cấp mới'), $3, $4, $5, $6, COALESCE($7, 'Sinh phẩm & Thiết bị y tế'), COALESCE($8, 'Công nợ 30 ngày'), COALESCE($9, 5))
             ON CONFLICT (supplier_code) DO UPDATE
             SET name = COALESCE($2, procurement_suppliers.name),
                 contact_person = COALESCE($3, procurement_suppliers.contact_person),
                 phone = COALESCE($4, procurement_suppliers.phone),
                 email = COALESCE($5, procurement_suppliers.email),
                 address = COALESCE($6, procurement_suppliers.address),
                 product_lines = COALESCE($7, procurement_suppliers.product_lines),
                 payment_terms = COALESCE($8, procurement_suppliers.payment_terms),
                 rating = COALESCE($9, procurement_suppliers.rating)`,
            [sCode, sName, contact, phone, email, address, lines, terms, rating]
          );
          importedCount++;
        }
        await syncCatalogSuppliersAndProducts();
        await logAudit("IMPORT_EXCEL", "SUPPLIERS", `Nạp thành công ${importedCount} nhà cung cấp từ Excel`);
      } else if (detectedType === "USERS_PERSONNEL") {
        try {
          await query("ALTER TABLE users DROP CONSTRAINT IF EXISTS users_email_key");
          await query("DROP INDEX IF EXISTS users_email_key");
        } catch (e: any) {
          console.warn("Could not drop users_email_key:", e?.message);
        }

        for (const r of rows) {
          // Helper to get value matching keys flexibly
          const getVal = (candidates: string[]): string => {
            for (const c of candidates) {
              if (r[c] !== undefined && r[c] !== null && String(r[c]).trim() !== "") {
                return String(r[c]).replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
              }
            }
            // Case/accent/symbol insensitive lookup
            const rowKeys = Object.keys(r);
            for (const cand of candidates) {
              const cleanCand = cand.toLowerCase().replace(/[\s\(\)\*\_]/g, "");
              for (const rk of rowKeys) {
                const cleanRk = rk.toLowerCase().replace(/[\s\(\)\*\_]/g, "");
                if (cleanRk === cleanCand && r[rk] !== undefined && r[rk] !== null && String(r[rk]).trim() !== "") {
                  return String(r[rk]).replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
                }
              }
            }
            return "";
          };

          const empCode = getVal(["Mã nhân viên (*)", "Mã nhân viên", "employee_code", "MaNV", "Mã NV"]) || autoCode("NV-TBR");
          const fullName = getVal(["Họ và tên (*)", "Họ và tên", "full_name", "name", "Họ tên"]) || "Nhân viên TBR";
          let username = getVal(["Tên đăng nhập (*)", "Tên đăng nhập", "username", "TenDangNhap"]);
          const email = getVal(["Email (*)", "Email", "email"]) || (username ? `${username}@tbr.vn` : "");
          if (!username) {
            const emailPart = email.split("@")[0];
            username = emailPart || empCode.toLowerCase().replace(/[^a-z0-9]/g, "");
          }
          // Mật khẩu chỉ được đặt khi file có cột mật khẩu; tài khoản đã có giữ nguyên mật khẩu hiện tại
          const providedPassword = getVal(["Mật khẩu khởi tạo", "Mật khẩu", "password"]);
          const deptRaw = getVal(["Phòng ban (*)", "Phòng ban", "department"]) || "Kinh Doanh";
          const normalizeDept = (dStr: string): string => {
            const s = dStr.toLowerCase().trim();
            if (s.includes("ứng dụng") || s.includes("kỹ thuật") || s.includes("application") || s === "app") return "Kỹ Thuật & Ứng Dụng";
            if (s.includes("mua hàng") || s.includes("cung ứng") || s.includes("procurement") || s.includes("purchasing")) return "Mua Hàng & Cung Ứng";
            if (s.includes("kho")) return "Kho Vận";
            if (s.includes("kế toán") || s.includes("tài chính")) return "Kế Toán";
            if (s.includes("giám đốc") || s.includes("bod")) return "Ban Giám Đốc";
            if (s.includes("pháp chế") || s.includes("legal")) return "Pháp Chế";
            if (s.includes("marketing") || s.includes("mkt")) return "Marketing";
            if (s.includes("chất lượng") || s.includes("qa") || s.includes("qc") || s.includes("iso")) return "QA / QC";
            if (s.includes("hành chính") || s.includes("nhân sự") || s.includes("hr")) return "Hành Chính Nhân Sự";
            if (s.includes("kinh doanh") || s.includes("sales")) return "Kinh Doanh";
            return dStr || "Kinh Doanh";
          };
          const dept = normalizeDept(deptRaw);
          const position = getVal(["Chức vụ / Vị trí (*)", "Chức vụ / Vị trí", "Chức vụ", "Vị trí", "position"]) || "Nhân viên";
          
          const rawRole = getVal([
            "Vai trò hệ thống (*)", 
            "Vai trò hệ thống", 
            "Vai trò (*)", 
            "Vai trò", 
            "Phân quyền", 
            "role", 
            "Role"
          ]);

          const role = inferSystemRoleFromPosition(dept, position, rawRole);

          const phone = getVal(["Số điện thoại", "phone", "SĐT", "Điện thoại"]);
          const statusRaw = (getVal(["Trạng thái", "status"]) || "ACTIVE").toUpperCase();
          const status = statusRaw.includes("NGHỈ") || statusRaw.includes("INACTIVE") ? "INACTIVE" : "ACTIVE";
          const isActive = status === "ACTIVE";

          // 1. Upsert into personnel table (Master Data - Single Source of Truth)
          try {
            await ensurePersonnelTable();
            await query(
              `INSERT INTO personnel (employee_code, full_name, department, position, email, phone, status)
               VALUES ($1, $2, $3, $4, $5, $6, $7)
               ON CONFLICT (employee_code) DO UPDATE 
               SET full_name = EXCLUDED.full_name,
                   department = EXCLUDED.department,
                   position = EXCLUDED.position,
                   email = EXCLUDED.email,
                   phone = EXCLUDED.phone,
                   status = EXCLUDED.status`,
              [empCode, fullName, dept, position, email, phone, status]
            );
          } catch (persErr: any) {
            console.error("Warning: personnel upsert failed, continuing:", persErr.message);
          }

          // 2. Upsert into users table (account, with username matching employee_code).
          // New accounts get the file's password or a random temporary one (never the shared "123456");
          // any password set here must be changed at first login.
          const initialPassword = providedPassword || generateTemporaryPassword();
          const userRes = await query(
            `INSERT INTO users (username, password_hash, full_name, role, department, email, is_active, must_change_password)
             VALUES ($1, $2, $3, $4, $5, $6, $7, true)
             ON CONFLICT (username) DO UPDATE
             SET password_hash = CASE WHEN $8::boolean THEN EXCLUDED.password_hash ELSE users.password_hash END,
                 must_change_password = CASE WHEN $8::boolean THEN true ELSE users.must_change_password END,
                 session_version = CASE WHEN $8::boolean THEN COALESCE(users.session_version, 0) + 1 ELSE users.session_version END,
                 full_name = EXCLUDED.full_name,
                 role = EXCLUDED.role,
                 department = EXCLUDED.department,
                 email = COALESCE(NULLIF(EXCLUDED.email, ''), users.email),
                 is_active = EXCLUDED.is_active
             RETURNING (xmax = 0) AS inserted`,
            [empCode, hashPassword(initialPassword), fullName, role, dept, email, isActive, providedPassword !== ""]
          );
          if (userRes.rows[0]?.inserted && !providedPassword) {
            initialCredentials.push({ username: empCode, full_name: fullName, password: initialPassword });
          }

          importedCount++;
        }

        // 3. Automatically sync to Zalo bindings directly from personnel
        await syncPersonnelToZaloBindings().catch((e) => console.error("[IMPORT_EXCEL] Zalo bindings sync failed:", e));

        await logAudit("IMPORT_EXCEL", "USERS_PERSONNEL", `Nạp thành công ${importedCount} tài khoản & hồ sơ nhân sự liên kết từ Excel`);
      } else {
        return NextResponse.json({ error: "Không nhận diện được định dạng file Excel phù hợp với các mẫu chuẩn TBR." }, { status: 400 });
      }

      return NextResponse.json({
        success: true,
        detected_type: detectedType,
        imported_count: importedCount,
        initial_credentials: initialCredentials,
        warnings: importWarnings,
        message: `Đã nhập thành công ${importedCount} bản ghi (${detectedType}) vào hệ thống!` + (detectedType === "USERS_PERSONNEL"
          ? " Tên đăng nhập là Mã nhân viên (ví dụ NV-TBR-001, gõ TBR001 cũng được); lần đăng nhập đầu phải đổi mật khẩu."
          : "")
      });
    }

    if (action === "lot_release_quarantine") {
      const { lot_number, product_code, released_by, reason } = body;
      await withTransaction(async (c) => {
        if (product_code) {
          await releaseLotQuarantine(c, product_code, lot_number);
        }
        await c.query(
          `UPDATE lot_recalls 
           SET status = 'RESOLVED', action_taken = COALESCE(action_taken, '') || ' • Giải tỏa cách ly bởi ' || $1 || ' (' || $2 || ')'
           WHERE lot_number = $3 AND product_code = $4`,
          [released_by || "QC Quản lý", reason || "Đã kiểm nghiệm đạt chuẩn", lot_number, product_code]
        );
      });
      await logAudit("RELEASE_QUARANTINE", "INVENTORY", `Giải tỏa cách ly Lô ${lot_number} (${product_code})`);
      return NextResponse.json({ success: true });
    }

    if (action === "save_product_component") {
      const { id, parent_product_code, component_code, component_name, specification, unit, quantity_per_kit, tracking_type, storage_condition, is_mandatory, notes } = body;
      if (!parent_product_code || !component_code || !component_name) {
        return NextResponse.json({ error: "Vui lòng nhập đầy đủ Mã sản phẩm chính, Mã thành phần và Tên thành phần" }, { status: 400 });
      }

      if (id) {
        await query(`
          UPDATE product_components 
          SET parent_product_code = $1, component_code = $2, component_name = $3, specification = $4, unit = $5,
              quantity_per_kit = $6, tracking_type = $7, storage_condition = $8, is_mandatory = $9, notes = $10
          WHERE id = $11
        `, [
          parent_product_code, component_code, component_name, specification || "", unit || "Cái",
          Number(quantity_per_kit) || 1, tracking_type || "LOT", storage_condition || "",
          is_mandatory !== false, notes || "", Number(id)
        ]);
        await logAudit("UPDATE_COMPONENT", "BOM", `Cập nhật thành phần ${component_name} (${component_code}) của mã chính ${parent_product_code}`);
      } else {
        await query(`
          INSERT INTO product_components (parent_product_code, component_code, component_name, specification, unit, quantity_per_kit, tracking_type, storage_condition, is_mandatory, notes)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        `, [
          parent_product_code, component_code, component_name, specification || "", unit || "Cái",
          Number(quantity_per_kit) || 1, tracking_type || "LOT", storage_condition || "",
          is_mandatory !== false, notes || ""
        ]);
        await logAudit("SAVE_COMPONENT", "BOM", `Thêm mới thành phần ${component_name} (${component_code}) cho mã chính ${parent_product_code}`);
      }
      return NextResponse.json({ success: true });
    }

    if (action === "delete_product_component") {
      const { id } = body;
      if (!id) {
        return NextResponse.json({ error: "Thiếu ID thành phần" }, { status: 400 });
      }
      await query("DELETE FROM product_components WHERE id = $1", [Number(id)]);
      await logAudit("DELETE_COMPONENT", "BOM", `Xóa thành phần cấu thành ID #${id}`);
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Hành động POST không hợp lệ" }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: httpErrorStatus(error) });
  }
}



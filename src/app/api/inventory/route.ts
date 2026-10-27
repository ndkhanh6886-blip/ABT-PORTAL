import { NextRequest, NextResponse } from "next/server";
import { query, logAudit, ensurePersonnelTable, withTransaction, httpErrorStatus, HttpError } from "@/backend/db/db";
import { hashPassword } from "@/backend/services/passwords";
import { getAuthorizedUser, isAdminUser, unauthorizedResponse, forbiddenResponse, setAuditActor } from "@/backend/services/authz";
import { hasPermission, inferSystemRoleFromPosition } from "@/backend/services/permissions";
import { stripCostFields } from "@/backend/services/costVisibility";
import { todayVN, toVNDateString } from "@/backend/services/dates";

/** Stock-changing actions and the permissions allowed to run them. */
const WRITE_PERMISSIONS: Record<string, string[]> = {
  inbound: ["warehouse.inbound"],
  outbound: ["warehouse.outbound"],
  update_item: ["warehouse.inbound", "warehouse.outbound"],
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
      await query("ALTER TABLE inventory_lots ADD COLUMN IF NOT EXISTS unit_cost NUMERIC DEFAULT 0").catch(() => {});
      await query(`
        INSERT INTO inventory_lots (product_code, lot_number, expiry_date, warehouse_location, quantity_on_hand, is_quarantined, quarantine_reason)
        SELECT i.product_code,
               COALESCE(NULLIF(TRIM(i.lot_number), ''), 'NO-LOT'),
               i.expiry_date,
               COALESCE(NULLIF(i.warehouse_location, ''), 'Kho Trung Tâm'),
               GREATEST(COALESCE(i.quantity_on_hand, 0), 0),
               COALESCE(i.is_quarantined, false),
               i.quarantine_reason
          FROM inventory_items i
         WHERE COALESCE(i.quantity_on_hand, 0) > 0
           AND NOT EXISTS (SELECT 1 FROM inventory_lots l WHERE l.product_code = i.product_code)
        ON CONFLICT DO NOTHING
      `).catch(() => {});
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
          LEFT JOIN LATERAL (
            SELECT * FROM inventory_items i0 WHERE i0.product_code = l.product_code ORDER BY i0.id ASC LIMIT 1
          ) i ON TRUE
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
      await query("ALTER TABLE inventory_lots ADD COLUMN IF NOT EXISTS unit_cost NUMERIC DEFAULT 0").catch(() => {});
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
      const [items, transactions, products, reservations, openPOs, recallsRes, componentsRes, personnelRes, customersRes] = await Promise.all([
        query(`
          SELECT i.*, p.category, p.unit, p.specification, p.standard_price, p.cost_price, p.min_stock_level, p.manufacturer, p.origin, p.storage_condition 
          FROM inventory_items i
          -- nối theo mã (có chỉ mục), id chỉ dùng khi không khớp mã: "id OR mã" làm phép nối quét chéo hai bảng
          LEFT JOIN LATERAL (
            SELECT * FROM products p0
             WHERE p0.code = i.product_code OR (i.product_id IS NOT NULL AND p0.id = i.product_id)
             ORDER BY (p0.code = i.product_code) DESC
             LIMIT 1
          ) p ON TRUE
          ORDER BY i.id ASC
        `),
        query("SELECT * FROM inventory_transactions ORDER BY date DESC, id DESC LIMIT 100"),
        query(`
          SELECT p.*, 
            (SELECT count(*) FROM product_components pc WHERE pc.parent_product_code = p.code) as component_count
          FROM products p 
          ORDER BY 
            (SELECT count(*) FROM product_components pc WHERE pc.parent_product_code = p.code) DESC,
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
        query("SELECT id, po_code, supplier_name, expected_delivery_date, status, items FROM procurement_orders WHERE status NOT IN ('COMPLETED', 'CANCELLED')"),
        query("SELECT * FROM lot_recalls ORDER BY id DESC"),
        query("SELECT * FROM product_components ORDER BY parent_product_code ASC, id ASC"),
        query("SELECT employee_code, full_name, department, position, email, phone FROM personnel WHERE status = 'ACTIVE' ORDER BY id ASC"),
        query("SELECT id, customer_code, name, contact_person, phone, email, address, classification, region, province, contacts FROM sales_customers ORDER BY name ASC"),
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

      // Mỗi mã: số lô còn tồn, lô hết hạn sớm nhất (FEFO), tổng tồn các lô (đối chiếu với tồn của mã)
      const lotSummary = await query(`
        SELECT product_code,
               COUNT(*) FILTER (WHERE quantity_on_hand > 0)::int AS lot_count,
               COALESCE(SUM(quantity_on_hand), 0)::numeric AS lots_qty,
               (ARRAY_AGG(lot_number ORDER BY exp ASC NULLS LAST, id ASC) FILTER (WHERE quantity_on_hand > 0))[1] AS earliest_lot,
               (ARRAY_AGG(exp ORDER BY exp ASC NULLS LAST, id ASC) FILTER (WHERE quantity_on_hand > 0))[1] AS earliest_expiry
          FROM (SELECT l.*, ${LOT_EXPIRY_ISO_SQL("l.expiry_date")} AS exp FROM inventory_lots l) x
         GROUP BY product_code
      `).catch(() => ({ rows: [] as any[] }));
      const lotsByProduct = new Map<string, any>(lotSummary.rows.map((r: any) => [r.product_code, r]));
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
    const { searchParams } = new URL(req.url);
    const body = await req.json();
    const action = searchParams.get("action") || body?.action;

    const me = await getAuthorizedUser(req);
    setAuditActor(me);
    if (!me) return unauthorizedResponse();
    const needed = WRITE_PERMISSIONS[action || ""];
    if (needed && !isAdminUser(me) && !needed.some(k => hasPermission(me, k))) {
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
      // M2: atomic sequence instead of Date.now().slice(-6)
      const code = transaction_code || (await generateDocumentCode({ docType: "PNK", tagMode: "GENERAL" }));
      const lines = sortByProductCode(
        (Array.isArray(items) ? items : []).filter((it: any) => it && (it.product_code || it.productCode)),
        (it: any) => it.product_code || it.productCode
      );

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
            date || todayVN(),
            performed_by || "Thủ kho TBR",
            warehouse_name || "Kho Trung Tâm",
            JSON.stringify(items || []),
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
            manufacturer: item.manufacturer || item.brand || item.supplier_name || "TBR Phân Phối",
            origin: item.origin || "Nhập khẩu / Chính hãng",
            min_stock_level: item.min_stock_level || 10,
            storage_condition: item.storage_condition || item.storageCondition || null
          });

          // Đồng bộ sang Danh mục sản phẩm kinh doanh (sales_commercial_products) — appended atomically at the end
          catalogEntries.push({
            code: pCode,
            name: item.product_name || item.name || pCode,
            category: resolvedItemCat,
            brand: item.manufacturer || item.brand || supplier_name || "TBR Phân Phối",
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
          await addStock(c, {
            productCode: pCode,
            productName: item.product_name || item.name || pCode,
            productId: prodId,
            qty: Number(item.quantity) || 0,
            lotNumber: item.lot_number || item.lotNumber || null,
            expiryDate: item.expiry_date || item.expiryDate || null,
            location: item.storage_location || warehouse_name || null,
            shelf: item.shelf_position || null,
            unitCost: Number(item.cost_price) || Number(item.unit_price) || 0,
          });
        }
        // app_storage row is locked last (global lock order) to avoid deadlocks between concurrent receipts
        for (const entry of catalogEntries) {
          await appendCommercialCatalogEntry(c, entry);
        }
      });

      await logAudit("INBOUND", "WAREHOUSE", `Nhập kho theo phiếu ${code} (Tham chiếu: ${reference_code || vat_invoice_no || "N/A"})${inbound_reason ? ` - ${inbound_reason}` : ""}`);
      return NextResponse.json({ success: true, transaction_code: code });
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
          [code, "OUTBOUND", reference_code, date || todayVN(), performed_by || "Thủ kho TBR", warehouse_name || "Kho Trung Tâm", JSON.stringify(items || []), finalNotes]
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
            expiry_date !== undefined ? String(expiry_date).trim() : null,
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
        const newExp = expiry_date !== undefined ? (String(expiry_date).trim() || null) : null;
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
      if (!Array.isArray(rows) || rows.length === 0) {
        return NextResponse.json({ error: "Không có dữ liệu hợp lệ để nạp" }, { status: 400 });
      }

      const sample = rows[0] || {};
      const keys = Object.keys(sample).map(k => k.toLowerCase().trim());

      // 1. Precise Detection Engine: Prioritize Personnel/Accounts over other entities
      const isPersonnel = 
        keys.some(k => k.includes("mã nhân viên") || k.includes("tên đăng nhập") || k.includes("mật khẩu") || k.includes("username") || k.includes("employee_code") || k.includes("mã nv") || k.includes("tài khoản")) ||
        (keys.some(k => k.includes("vai trò") || k.includes("role")) && keys.some(k => k.includes("phòng ban") || k.includes("chức vụ")));

      const isInbound = 
        keys.some(k => k.includes("số lô") || k.includes("hạn sử dụng") || k.includes("hạn dùng") || k.includes("nhiệt độ bảo quản") || k.includes("vị trí kho kệ"));

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
      if (detectedType === "PRODUCTS" && !isAdminUser(me) && !hasPermission(me, "warehouse.inbound") && !hasPermission(me, "procurement.view")) {
        return forbiddenResponse("Bạn không có quyền nạp danh mục sản phẩm từ Excel.");
      }
      if ((detectedType === "PURCHASE_ORDERS" || detectedType === "SUPPLIERS") && !isAdminUser(me) && !hasPermission(me, "procurement.view") && !hasPermission(me, "procurement.create_po")) {
        return forbiddenResponse("Bạn không có quyền nạp dữ liệu mua sắm / nhà cung cấp từ Excel.");
      }

      let importedCount = 0;

      // Universal flexible value extractor for any row
      const createGetVal = (r: Record<string, any>) => {
        const rowKeys = Object.keys(r || {});
        return (candidates: string[], defaultValue = ""): string => {
          for (const c of candidates) {
            if (r[c] !== undefined && r[c] !== null && String(r[c]).trim() !== "") {
              return String(r[c]).trim();
            }
          }
          for (const cand of candidates) {
            const cleanCand = cand.toLowerCase().replace(/[\s\(\)\*\_]/g, "");
            for (const rk of rowKeys) {
              const cleanRk = rk.toLowerCase().replace(/[\s\(\)\*\_]/g, "");
              if (cleanRk === cleanCand && r[rk] !== undefined && r[rk] !== null && String(r[rk]).trim() !== "") {
                return String(r[rk]).trim();
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
                     COALESCE($11, 500000000), COALESCE($12, 30), COALESCE($13, 'NVKD'), $14, $15::jsonb, $16, $17)
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
        for (const r of rows) {
          const getVal = createGetVal(r);
          const pCode = getVal(["Mã SKU (*)", "Mã SKU", "code", "Mã hàng", "SKU"]) || autoCode("SKU");
          // Ô trống -> null: sản phẩm đã có giữ nguyên giá / thông tin cũ (trước đây bị ghi đè thành 0 / mặc định)
          const orNull = (v: string) => (v === "" ? null : v);
          const numOrNull = (v: string) => {
            if (v === "") return null;
            const n = Number(String(v).replace(/[^\d-]/g, "")); // giá VNĐ là số nguyên: bỏ dấu phân cách hàng nghìn
            return Number.isFinite(n) ? n : null;
          };
          const pName = orNull(getVal(["Tên sản phẩm (*)", "Tên sản phẩm", "Tên Hàng Hóa Thương Mại", "name", "Tên hàng", "Tên hàng hóa, dịch vụ"]));
          const supplierCol = orNull(getVal(["Nhà cung cấp (*)", "Nhà cung cấp", "Nhà Cung Cấp", "supplier", "Đơn vị cung cấp"]));
          const brand = orNull(getVal(["Hãng sản xuất (*)", "Hãng sản xuất", "Hãng Sản Xuất", "manufacturer", "Hãng SX", "Hãng", "Brand"])) || supplierCol;
          const rawCat = orNull(getVal([
            "Nhóm ngành hàng (*)", "Nhóm ngành hàng", "Phân Loại Chính", "Phân loại ngành hàng",
            "Phân loại", "category", "Category", "Ngành hàng", "Nhóm hàng", "Danh mục",
            "Danh mục (Category)", "Danh mục (PCR Kit/..)", "Chủng loại", "CHỦNG LOẠI", "Loại Kit"
          ]));
          const cat = resolveActualProductCategory({ code: pCode, name: pName || pCode, category: rawCat || "" });
          const spec = orNull(getVal(["Quy cách đóng gói", "specification", "Quy cách"]));
          const unit = orNull(getVal(["Đơn vị tính", "unit", "ĐVT"]));
          const cost = numOrNull(getVal(["Giá vốn nhập (VNĐ)", "Giá vốn", "cost_price", "Giá vốn (VNĐ)"]));
          const stdPrice = numOrNull(getVal(["Giá niêm yết End-User (VNĐ)", "Giá niêm yết", "standard_price", "Giá bán"]));
          const minStock = numOrNull(getVal(["Mức tồn tối thiểu", "min_stock_level", "Tồn tối thiểu"]));
          const storageCondition = getVal([
            "Điều kiện bảo quản chuẩn (*)", 
            "Điều kiện bảo quản chuẩn", 
            "Điều kiện bảo quản tiêu chuẩn", 
            "Điều kiện bảo quản", 
            "Nhiệt độ bảo quản chuẩn", 
            "Nhiệt độ bảo quản", 
            "storage_condition"
          ]) || null;

          await query(
            `INSERT INTO products (code, name, manufacturer, category, specification, unit, cost_price, standard_price, min_stock_level, storage_condition)
             VALUES ($1::text, COALESCE($2::text, $1::text), COALESCE($3, 'TBR'), COALESCE($4, 'Vật tư y tế'), $5, COALESCE($6, 'Hộp'),
                     COALESCE($7, 0), COALESCE($8, 0), COALESCE($9, 10), $10::text)
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

          // Ensure inventory item
          await query(
            `INSERT INTO inventory_items (product_code, product_name, quantity_on_hand, quantity_allocated, warehouse_location, shelf_position)
             VALUES ($1, $2, 0, 0, 'Kho Trung Tâm', 'Chưa phân bổ kệ')
             ON CONFLICT (product_code) DO NOTHING`,
            [pCode, pName || pCode]
          );

          // Đồng bộ sang catalog_items (nếu để trống Giá vốn hoặc Giá bán thì giữ nguyên giá đã lưu trước đó)
          await appendCommercialCatalogEntry({ query } as any, {
            code: pCode,
            name: pName || pCode,
            category: cat || "Hàng Thương Mại",
            brand: brand || supplierCol || "TBR Phân Phối",
            supplier: supplierCol || brand || "",
            origin: "Chính hãng",
            unit: unit || "Hộp",
            specification: spec || "",
            costPrice: cost ?? 0,
            price: stdPrice ?? 0,
            priceDealer1: stdPrice ? Math.round(stdPrice * 0.85) : 0,
            priceDealer2: stdPrice ? Math.round(stdPrice * 0.8) : 0,
            storageCondition: storageCondition || "",
            leadTime: "Có sẵn kho",
          });
          importedCount++;
        }

        // Process Sheet 2: Định mức phụ kiện / linh kiện BOM đính kèm nếu có
        let componentsImportedCount = 0;
        if (Array.isArray(contact_rows) && contact_rows.length > 0) {
          for (const cr of contact_rows) {
            const getCrVal = createGetVal(cr);
            const parentSku = getCrVal(["Mã SKU cha (*)", "Mã SKU cha", "Mã sản phẩm chính (*)", "Mã hàng chính", "parent_product_code"]);
            const compCode = getCrVal(["Mã phụ kiện / Thành phần (*)", "Mã phụ kiện / Thành phần", "Mã phụ kiện", "Mã thành phần", "component_code"]);
            const compName = getCrVal(["Tên phụ kiện / Thành phần (*)", "Tên phụ kiện / Thành phần", "Tên phụ kiện", "Tên thành phần", "component_name"], compCode);
            
            if (parentSku && compCode) {
              const spec = getCrVal(["Quy cách", "specification"]);
              const unit = getCrVal(["Đơn vị tính", "ĐVT", "unit"], "Cái");
              const qtyPerKit = Number(getCrVal(["Định mức theo bộ (*)", "Định mức theo bộ", "quantity_per_kit"])) || 1;
              const trackingType = getCrVal(["Hình thức quản lý (LOT/SERIAL)", "Hình thức quản lý", "tracking_type"]).toUpperCase().includes("SERIAL") ? "SERIAL" : "LOT";
              const storageCond = getCrVal(["Điều kiện bảo quản tiêu chuẩn", "Điều kiện bảo quản", "storage_condition"]);
              const notes = getCrVal(["Ghi chú", "notes"]);

              const existComp = await query(
                `SELECT id FROM product_components WHERE parent_product_code = $1 AND component_code = $2`,
                [parentSku, compCode]
              );

              if (existComp.rows.length > 0) {
                await query(
                  `UPDATE product_components 
                   SET component_name = $1, specification = $2, unit = $3, quantity_per_kit = $4, 
                       tracking_type = $5, storage_condition = $6, notes = $7
                   WHERE id = $8`,
                  [compName, spec, unit, qtyPerKit, trackingType, storageCond, notes, existComp.rows[0].id]
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
        // M2: one atomic code for rows without an explicit "Mã Phiếu Nhập" (was Date.now().slice(-6) per row)
        let batchInboundCode: string | null = null;
        for (const r of rows) {
          const getVal = createGetVal(r);
          const pCode = getVal(["Mã SP", "Mã sản phẩm (*)", "Mã sản phẩm", "Mã hàng", "Mã SKU (*)", "Mã SKU", "product_code", "sku", "code"]);
          const catalogProd = pCode
            ? (await query("SELECT code, name, specification, unit, manufacturer, cost_price, storage_condition FROM products WHERE LOWER(TRIM(code)) = LOWER(TRIM($1)) LIMIT 1", [pCode])).rows[0]
            : null;
          const pName = getVal(["Tên hàng hóa / Sinh phẩm (*)", "Tên sản phẩm (*)", "Tên hàng hóa", "Tên sản phẩm", "Tên SP", "product_name"], catalogProd?.name || pCode);
          const spec = getVal(["Quy cách đóng gói", "Quy cách", "specification"], catalogProd?.specification || "");
          const unit = getVal(["Đơn vị tính", "Đơn vị tính (ĐVT)", "ĐVT", "unit"], catalogProd?.unit || "Hộp");
          const lot = getVal(["Số Lô (Lot)", "Số Lô (LOT) (*)", "Số Lô (LOT)", "Số Lô sản xuất (*)", "Số Lô", "Lô", "Lot", "lot_number"], "LOT-STD");
          const expDate = getVal(["Hạn dùng (Date)", "Hạn sử dụng (EXP) (*)", "Hạn sử dụng (EXP)", "Hạn sử dụng (*)", "Hạn sử dụng", "Hạn dùng", "Date", "expiry_date"]);
          const mfgDate = getVal(["Ngày sản xuất (MFG)", "Ngày sản xuất", "mfg_date"]);
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
          const inboundDate = getVal(["Ngày Nhập Kho (*)", "Ngày Nhập Kho", "date"], todayVN());
          const inboundReason = getVal(["Loại hình / Lý do nhập", "Lý do nhập"], "Nhập mua hàng theo PO từ NCC");
          const poCode = getVal(["Mã Đơn Đặt Hàng (PO)", "Mã Đơn Đặt Hàng (PO) Tham Chiếu", "Mã PO", "reference_code"]);
          const vatInvoice = getVal(["Số Hóa Đơn VAT / Tờ khai HQ", "Số Hóa Đơn VAT / Tờ Khai Hải Quan", "Số Hóa Đơn VAT", "vat_invoice_no"]);
          const supplier = getVal(["Nhà Cung Cấp", "Nhà cung cấp / Nguồn hàng", "Nhãn hiệu", "Hãng sản xuất", "supplier_name"], catalogProd?.manufacturer || "");
          const warehouse = getVal(["Kho Tiếp Nhận", "Kho lưu trữ", "Khu vực kho"], "Kho Trung Tâm");
          const performedBy = getVal(["Thủ Kho / Người Tiếp Nhận", "Người tiếp nhận"], "Thủ kho TBR");
          const shippingUnit = getVal(["Đơn vị vận chuyển / Giao hàng", "Đơn vị vận chuyển"]);
          const notes = getVal(["Ghi chú", "Ghi chú chứng từ / Chất lượng", "notes"]);

          if (pCode && qty > 0) {
            // Product master, catalog sync and stock are written in the transaction below (H1/H2/H4)
            // Resolve child components (BOM) from Sheet 2 or database
            let itemComponents: any[] = [];
            if (Array.isArray(contact_rows) && contact_rows.length > 0) {
              const matched = contact_rows.filter((cr: any) => {
                const parentCode = String(cr["Mã sản phẩm chính (*)"] || cr["Mã hàng chính"] || cr["Mã sản phẩm"] || cr["parent_product_code"] || "").trim().toUpperCase();
                const parentLot = String(cr["Số Lô chính (*)"] || cr["Số Lô"] || cr["parent_lot_number"] || "").trim();
                return parentCode === pCode.toUpperCase() && (!parentLot || parentLot === lot);
              });
              if (matched.length > 0) {
                itemComponents = matched.map((cr: any) => ({
                  component_code: cr["Mã thành phần / Phụ kiện (*)"] || cr["Mã thành phần"] || cr["component_code"],
                  component_name: cr["Tên thành phần / Phụ kiện (*)"] || cr["Tên thành phần"] || cr["component_name"],
                  specification: cr["Quy cách"] || cr["specification"] || "",
                  unit: cr["Đơn vị tính"] || cr["ĐVT"] || cr["unit"] || "Cái",
                  quantity_per_kit: Number(cr["Định mức theo bộ"] || cr["quantity_per_kit"]) || 1,
                  tracking_type: cr["Hình thức quản lý (LOT/SERIAL)"] || cr["Hình thức quản lý"] || cr["tracking_type"] || "LOT",
                  lot_number: cr["Số Lô (LOT) / Serial (S/N)"] || cr["Số Lô"] || cr["lot_number"] || lot,
                  serial_number: cr["Số Serial (S/N)"] || cr["Số Lô (LOT) / Serial (S/N)"] || cr["serial_number"] || "",
                  expiry_date: cr["Hạn dùng (EXP)"] || cr["expiry_date"] || expDate,
                  storage_condition: cr["Nhiệt độ bảo quản riêng"] || cr["storage_condition"] || storageCondition,
                  qc_status: cr["Tình trạng QC"] || cr["qc_status"] || qcStatus,
                  notes: cr["Ghi chú"] || ""
                }));
              }
            }

            // Fallback: If no components provided in Sheet 2, check if pCode has BOM in product_components table
            if (itemComponents.length === 0) {
              const bomCompsRes = await query("SELECT * FROM product_components WHERE parent_product_code = $1 ORDER BY id", [pCode]);
              if (bomCompsRes.rows.length > 0) {
                itemComponents = bomCompsRes.rows.map((bc: any, bIdx: number) => ({
                  component_code: bc.component_code,
                  component_name: bc.component_name,
                  specification: bc.specification || "",
                  unit: bc.unit || "Cái",
                  quantity_per_kit: Number(bc.quantity_per_kit) || 1,
                  tracking_type: bc.tracking_type || "LOT",
                  lot_number: bc.tracking_type === "LOT" ? lot : "",
                  serial_number: bc.tracking_type === "SERIAL" ? `SN-${bc.component_code.replace(/[^a-zA-Z0-9]/g, '')}-${lot.replace(/[^a-zA-Z0-9]/g, '')}-${bIdx + 1}` : "",
                  expiry_date: expDate,
                  storage_condition: bc.storage_condition || storageCondition,
                  qc_status: qcStatus,
                  notes: bc.notes || ""
                }));
              }
            }

            // Collected first; all writes happen below in ONE transaction, sorted by product code
            parsedInbound.push({
              pCode, pName, spec, unit, lot, expDate, qty, unitCost, storageCondition, shelf, warehouse, supplier, r,
              inboundCode, inboundDate, performedBy,
              reference: poCode || vatInvoice || lot,
              txNote: `Nhập kho theo Lô ${lot} (HSD: ${expDate})${supplier ? ` - NCC: ${supplier}` : ""}${inboundReason ? ` - Lý do: ${inboundReason}` : ""}${notes ? ` - Ghi chú: ${notes}` : ""}`,
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
                manufacturer: p.supplier || "TBR Phân Phối",
                origin: "Chính hãng / Tiêu chuẩn ISO",
                min_stock_level: 10,
                storage_condition: p.storageCondition
              });

              // Đồng bộ sang Danh mục sản phẩm kinh doanh (appended atomically at the end)
              catalogEntries.push({
                code: p.pCode,
                name: p.pName,
                category: resolvedInboundCat,
                brand: p.supplier || "TBR Phân Phối",
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

            // Log Inbound transaction(s) with comprehensive metadata
            for (const [docCode, doc] of docs) {
              await c.query(
                `INSERT INTO inventory_transactions (transaction_code, transaction_type, reference_code, date, performed_by, warehouse_name, items, notes)
                 VALUES ($1, 'INBOUND', $2, $3, $4, $5, $6, $7)`,
                [docCode, doc.reference, doc.date, doc.performedBy, doc.warehouse, JSON.stringify(doc.items), doc.notes.join(" | ")]
              );
            }
            for (const entry of catalogEntries) {
              await appendCommercialCatalogEntry(c, entry);
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
          const orderDate = getVal(["Ngày đặt hàng (*)", "Ngày đặt hàng", "order_date"], todayVN());
          const expDeliv = getVal(["Hạn giao dự kiến (*)", "Hạn giao dự kiến", "expected_delivery_date"]) || null;
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
                return String(r[c]).trim();
              }
            }
            // Case/accent/symbol insensitive lookup
            const rowKeys = Object.keys(r);
            for (const cand of candidates) {
              const cleanCand = cand.toLowerCase().replace(/[\s\(\)\*\_]/g, "");
              for (const rk of rowKeys) {
                const cleanRk = rk.toLowerCase().replace(/[\s\(\)\*\_]/g, "");
                if (cleanRk === cleanCand && r[rk] !== undefined && r[rk] !== null && String(r[rk]).trim() !== "") {
                  return String(r[rk]).trim();
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

          // 2. Upsert into users table (account, with username matching employee_code)
          await query(
            `INSERT INTO users (username, password_hash, full_name, role, department, email, is_active)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             ON CONFLICT (username) DO UPDATE
             SET password_hash = CASE WHEN $8::boolean THEN EXCLUDED.password_hash ELSE users.password_hash END,
                 full_name = EXCLUDED.full_name,
                 role = EXCLUDED.role,
                 department = EXCLUDED.department,
                 email = COALESCE(NULLIF(EXCLUDED.email, ''), users.email),
                 is_active = EXCLUDED.is_active`,
            [empCode, hashPassword(providedPassword || "123456"), fullName, role, dept, email, isActive, providedPassword !== ""]
          );

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
        message: `Đã nhập thành công ${importedCount} bản ghi (${detectedType}) vào hệ thống!`
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



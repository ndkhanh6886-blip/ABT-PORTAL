import { NextRequest, NextResponse } from "next/server";
import { query, logAudit, withTransaction, HttpError, httpErrorStatus } from "@/backend/db/db";
import { getAuthorizedUser, isAdminUser, isAccountantUser, unauthorizedResponse, forbiddenResponse, AuthorizedUser, setAuditActor } from "@/backend/services/authz";
import { hasPermission } from "@/backend/services/permissions";
import { stripCostFields } from "@/backend/services/costVisibility";
import { todayVN, toVNDateString, nowVNDateTime } from "@/backend/services/dates";
import { notifyZaloProactiveEvent } from "@/backend/services/zaloEngine";

function canApprovePO(user: AuthorizedUser) {
  return isAdminUser(user) || hasPermission(user, "procurement.approve_po");
}

function canSeeCost(user: AuthorizedUser) {
  return isAdminUser(user) || hasPermission(user, "warehouse.view_cost_price") || hasPermission(user, "procurement.view");
}

function canWriteProcurement(user: AuthorizedUser) {
  return (
    isAdminUser(user) ||
    isAccountantUser(user) ||
    hasPermission(user, "procurement.view") ||
    hasPermission(user, "procurement.create_po") ||
    hasPermission(user, "procurement.approve_po") ||
    hasPermission(user, "warehouse.edit_inbound")
  );
}

function canRecordSupplierPayment(user: AuthorizedUser) {
  return isAccountantUser(user) || hasPermission(user, "procurement.approve_po");
}
import { generateDocumentCode } from "@/backend/services/codeGenerator";
import { ensureProduct, addStock, reserveStock, appendCommercialCatalogEntry, sortByProductCode } from "@/backend/services/inventoryLedger";
import { syncCatalogSuppliersAndProducts, markSupplierDeleted, unmarkSupplierDeleted, invalidateSupplierCatalogCache } from "@/backend/services/supplierCatalogSync";
import { syncInboundPricesToPOs, reconcileHistoricalPOsWithInbound } from "@/backend/services/poReceipt";
import { withTransaction as withFactoryTx } from "@/factory/core/db";
import { syncKdOrderOrPoToInternalOrder } from "@/factory/intake/orderDispatchOps";

let supplierShortNameEnsured = false;
async function ensureSupplierShortName() {
  if (supplierShortNameEnsured) return;
  try {
    await query(`
      UPDATE procurement_suppliers SET short_name = 'Phù Sa' WHERE supplier_code = 'NCC0021' AND (short_name IS NULL OR short_name = '');
      UPDATE procurement_suppliers SET short_name = 'Hoàng Kim' WHERE supplier_code = 'NCC0022' AND (short_name IS NULL OR short_name = '');
      UPDATE procurement_suppliers SET short_name = 'Nam Yến' WHERE supplier_code = 'NCC0049' AND (short_name IS NULL OR short_name = '');
      UPDATE procurement_suppliers SET short_name = 'Lê Gia' WHERE supplier_code = 'NCC0077' AND (short_name IS NULL OR short_name = '');
      UPDATE procurement_suppliers SET short_name = 'QMedic' WHERE supplier_code = 'NCC0089' AND (short_name IS NULL OR short_name = '');
      UPDATE procurement_suppliers SET short_name = 'Hồng Thiện Mỹ' WHERE supplier_code = 'NCC0097' AND (short_name IS NULL OR short_name = '');
      UPDATE procurement_suppliers SET short_name = 'Lâm Việt' WHERE supplier_code = 'NCC0099' AND (short_name IS NULL OR short_name = '');
      UPDATE procurement_suppliers SET short_name = 'Ngô Gia Phát' WHERE supplier_code = 'NCC0100' AND (short_name IS NULL OR short_name = '');
      UPDATE procurement_suppliers SET short_name = 'Nam Thành' WHERE supplier_code = 'NCC0105' AND (short_name IS NULL OR short_name = '');
      UPDATE procurement_suppliers SET short_name = 'Phương Đông' WHERE supplier_code = 'NCC0116' AND (short_name IS NULL OR short_name = '');
      UPDATE procurement_suppliers SET short_name = 'Bio Basic' WHERE name ILIKE '%Bio Basic%' AND (short_name IS NULL OR short_name = '');
      UPDATE procurement_suppliers SET short_name = 'ABT' WHERE (name ILIKE '%ABT%' OR name ILIKE '%LONG HẬU%') AND (short_name IS NULL OR short_name = '');
      UPDATE procurement_suppliers SET short_name = 'ABT' WHERE name ILIKE '%ABT%' AND (short_name IS NULL OR short_name = '');
      UPDATE procurement_suppliers SET short_name = 'Meridian' WHERE (name ILIKE '%Meridian%' OR name ILIKE '%Bioline%') AND (short_name IS NULL OR short_name = '');
      UPDATE procurement_suppliers SET short_name = 'Liferiver' WHERE (name ILIKE '%Liferiver%' OR name ILIKE '%Shanghai ZJ%') AND (short_name IS NULL OR short_name = '');
      UPDATE procurement_suppliers SET short_name = 'SSI' WHERE name ILIKE '%SSI%' AND (short_name IS NULL OR short_name = '');
      UPDATE procurement_suppliers SET short_name = 'Rollmed' WHERE name ILIKE '%Rollmed%' AND (short_name IS NULL OR short_name = '');
      UPDATE procurement_suppliers SET short_name = 'HiMedia' WHERE name ILIKE '%HiMedia%' AND (short_name IS NULL OR short_name = '');
      UPDATE procurement_suppliers SET short_name = 'Biolabs' WHERE (name ILIKE '%Biolabs%' OR name ILIKE '%NEB%') AND (short_name IS NULL OR short_name = '');
      UPDATE procurement_suppliers SET short_name = 'Jet Biofil' WHERE name ILIKE '%Biofil%' AND (short_name IS NULL OR short_name = '');
      UPDATE procurement_suppliers SET short_name = 'Biologix' WHERE name ILIKE '%Biologix%' AND (short_name IS NULL OR short_name = '');
    `);


    supplierShortNameEnsured = true;
  } catch (e: any) {
    console.warn("ensureSupplierShortName warning:", e?.message);
  }
}

/** Sales order codes written in free text (PO notes, PR titles): SO26-CR-1004, SO26-STOCK-1001, legacy SO-xxx. */
const SO_CODE_RE = /\bSO\d{2}-[A-Z0-9]{2,6}-\d{3,6}\b|\bSO-[A-Za-z0-9_.-]+/g;

/** Sales orders that wait for this PR / PO: mark them ordered, with the PO code (procurement and sales stay in step). */
async function linkSalesOrdersToPO(c: any, prCodes: string[], poCode: string) {
  const codes = Array.from(new Set(prCodes.filter(Boolean)));
  if (codes.length === 0) return;
  await c.query(
    `UPDATE sales_orders SET procure_status = 'ORDERED', procure_order_code = $1
      WHERE pr_code = ANY($2::text[]) AND COALESCE(procure_status, '') NOT IN ('RECEIVED', 'COMPLETED')`,
    [poCode, codes]
  );
}

/**
 * After a goods receipt, hold the received quantity for the customer order the PO line was bought for
 * (line order code, the order of its source PR, or the single SO code in the PO notes) — never more than
 * that order still needs (ordered - delivered - already held). Stock lines and unknown orders stay free.
 */
async function reserveReceiptForSalesOrder(c: any, po: any, it: any, line: { pCode: string; pName: string; qty: number; lot: string }, inboundCode: string) {
  if (it.is_stock === true) return;
  let orderCode: string | null = it.order_code || it.so_code || it.linked_order_code || null;
  if (!orderCode && it.source_pr_code) {
    const r = await c.query("SELECT order_code FROM sales_orders WHERE pr_code = $1 ORDER BY id LIMIT 1", [String(it.source_pr_code)]);
    orderCode = r.rows[0]?.order_code || null;
  }
  if (!orderCode) {
    const found = Array.from(new Set(String(po.notes || "").match(SO_CODE_RE) || []));
    if (found.length === 1) orderCode = found[0];
  }
  if (!orderCode) return;
  const ord = (await c.query("SELECT order_code, customer_name, sales_rep_name, items, delivery_status FROM sales_orders WHERE order_code = $1 LIMIT 1", [orderCode])).rows[0];
  if (!ord || String(ord.delivery_status || "").toUpperCase() === "CANCELLED") return;
  let items: any[] = ord.items;
  if (typeof items === "string") { try { items = JSON.parse(items); } catch { items = []; } }
  const ordered = (Array.isArray(items) ? items : [])
    .filter((x: any) => (x?.productCode || x?.product_code) === line.pCode && x?.status !== "CANCELLED")
    .reduce((s: number, x: any) => s + (Number(x.quantity) || 0), 0);
  if (ordered <= 0) return;
  const held = Number((await c.query(
    "SELECT COALESCE(SUM(quantity_reserved), 0) AS q FROM inventory_reservations WHERE order_code = $1 AND product_code = $2 AND status = 'ACTIVE'",
    [orderCode, line.pCode]
  )).rows[0].q) || 0;
  let delivered = 0;
  const slips = await c.query("SELECT items, status, extra_data FROM sales_delivery_slips WHERE order_code = $1", [orderCode]);
  for (const sl of slips.rows) {
    let ex: any = sl.extra_data;
    if (typeof ex === "string") { try { ex = JSON.parse(ex); } catch { ex = {}; } }
    if (String(ex?.deliveryStatus || "").toUpperCase() === "CANCELLED") continue;
    let sItems: any[] = sl.items;
    if (typeof sItems === "string") { try { sItems = JSON.parse(sItems); } catch { sItems = []; } }
    for (const si of Array.isArray(sItems) ? sItems : []) {
      if ((si?.productCode || si?.product_code) === line.pCode) delivered += Number(si.quantity) || 0;
    }
  }
  const need = Math.max(0, ordered - delivered - held);
  const qty = Math.min(line.qty, need);
  if (qty <= 0) return;
  await reserveStock(c, {
    orderCode,
    customerName: ord.customer_name || "Khách hàng theo SO",
    salesRepName: ord.sales_rep_name || "Phòng Cung Ứng",
    productCode: line.pCode,
    productName: line.pName,
    // giữ theo mã hàng, không ràng buộc lô: Kho chọn lô giao khi lập phiếu (FEFO)
    lotNumber: null,
    qty,
    holdUntil: toVNDateString(new Date(Date.now() + 15 * 86400000)),
    notes: `Tự động giữ hàng cho ${orderCode} theo PO ${po.po_code} nhập kho ${inboundCode}`
  });
}

export async function GET(req: NextRequest) {
  try {
    // Phiên phải còn hiệu lực (tài khoản chưa bị khóa, mật khẩu chưa đổi): proxy chỉ kiểm tra chữ ký cookie
    const authUser = await getAuthorizedUser(req);
    if (!authUser) return unauthorizedResponse();
    if (
      !isAdminUser(authUser) &&
      !hasPermission(authUser, "procurement.view") &&
      !hasPermission(authUser, "warehouse.view") &&
      !hasPermission(authUser, "sales.view")
    ) {
      return forbiddenResponse("Bạn không có quyền truy cập phân hệ Cung ứng.");
    }
    setAuditActor(authUser);
    const allowCost = canSeeCost(authUser);
    await ensureSupplierShortName();
    const { searchParams } = new URL(req.url);
    const action = searchParams.get("action") || "overview";

    // Sổ chi tiền NCC (kể cả khoản đã hủy) để xem lịch sử / hủy / sửa khoản chi
    if (action === "po_payments") {
      const r = await query(
        `SELECT pp.id, pp.po_id, po.po_code, po.supplier_name, pp.amount, pp.method, pp.reference_doc, pp.payment_date,
                pp.notes, pp.created_by, pp.created_at, pp.voucher_code, pp.voided_at, pp.voided_by, pp.void_reason
           FROM procurement_payments pp JOIN procurement_orders po ON po.id = pp.po_id
          ORDER BY pp.payment_date DESC, pp.id DESC`
      );
      return NextResponse.json({ payments: r.rows });
    }

    // Nhu cầu giao hàng: từng dòng SO còn chờ giao (SL đặt − SL đã lập phiếu giao chưa hủy), bỏ đơn đã giao xong /
    // đã hủy / từ chối và đơn SO Stock (lưu kho nội bộ)
    if (action === "so_demand") {
      const arr = (v: any): any[] => {
        if (Array.isArray(v)) return v;
        if (typeof v === "string") { try { const x = JSON.parse(v); return Array.isArray(x) ? x : []; } catch { return []; } }
        return [];
      };
      const codeOf = (it: any) => String(it?.productCode || it?.product_code || it?.code || "").trim().toUpperCase();
      const orders = (await query(
        `SELECT order_code, customer_name, sales_rep_name, order_date, items, delivery_status, approval_status, applied_price_policy
           FROM sales_orders WHERE order_code IS NOT NULL ORDER BY id DESC`
      )).rows;
      const slips = (await query("SELECT order_code, items, status, extra_data FROM sales_delivery_slips WHERE order_code IS NOT NULL")).rows;
      const shipped = new Map<string, number>();
      for (const sl of slips) {
        const ex = sl.extra_data && typeof sl.extra_data === "object" ? sl.extra_data : {};
        if (String(ex.deliveryStatus || sl.status || "").toUpperCase() === "CANCELLED") continue;
        for (const it of arr(sl.items)) {
          const code = codeOf(it);
          if (!code) continue;
          const k = `${sl.order_code}|${code}`;
          shipped.set(k, (shipped.get(k) || 0) + (Number(it?.quantity) || 0));
        }
      }
      const rows: any[] = [];
      const seen = new Set<string>();
      for (const o of orders) {
        if (seen.has(o.order_code)) continue;
        seen.add(o.order_code);
        const ds = String(o.delivery_status || "").toUpperCase();
        const ap = String(o.approval_status || "").toUpperCase();
        if (["DELIVERED", "COMPLETED", "CANCELLED"].includes(ds) || ["CANCELLED", "REJECTED"].includes(ap)) continue;
        if (String(o.applied_price_policy || "").toUpperCase() === "STOCK" || /STOCK/i.test(String(o.order_code))) continue;
        const need = new Map<string, number>();
        for (const it of arr(o.items)) {
          if (String(it?.status || "").toUpperCase() === "CANCELLED") continue;
          const code = codeOf(it);
          if (!code) continue;
          need.set(code, (need.get(code) || 0) + (Number(it?.quantity) || 0));
        }
        for (const [code, qty] of need) {
          const rem = qty - (shipped.get(`${o.order_code}|${code}`) || 0);
          if (rem > 0) {
            rows.push({
              order_code: o.order_code,
              customer_name: o.customer_name,
              sales_rep_name: o.sales_rep_name,
              order_date: o.order_date ? toVNDateString(o.order_date) : null,
              product_code: code,
              quantity: rem,
            });
          }
        }
      }
      return NextResponse.json({ rows });
    }

    if (action === "overview") {
      await syncCatalogSuppliersAndProducts();
      await reconcileHistoricalPOsWithInbound(query);

      const safeQuery = async (sql: string, params?: any[]) => {
        try {
          return await query(sql, params);
        } catch (e: any) {
          console.warn("[PROCUREMENT SAFE QUERY ERROR]:", e?.message);
          return { rows: [] };
        }
      };

      const [suppliersRes, ordersRes, productsRes, inventoryRes, prRes, inventoryItemsRes, reservationsRes, customersRes, supplierProductCountsRes, catalogItemsRes, allSupplierProductsRes] = await Promise.all([
        safeQuery("SELECT * FROM procurement_suppliers ORDER BY supplier_code ASC, id ASC"),
        safeQuery("SELECT * FROM procurement_orders ORDER BY id DESC"),
        safeQuery("SELECT * FROM products ORDER BY code ASC"),
        safeQuery(`
          SELECT i.id, i.product_code, i.product_name, i.quantity_on_hand, i.warehouse_location,
                 p.min_stock_level, p.cost_price, p.standard_price, p.unit, p.manufacturer
          FROM inventory_items i
          JOIN products p ON i.product_code = p.code
          WHERE i.quantity_on_hand <= p.min_stock_level
          ORDER BY (p.min_stock_level - i.quantity_on_hand) DESC
        `),
        safeQuery(`
          SELECT * FROM workflow_requests
          WHERE workflow_code LIKE 'PR%' OR workflow_code ILIKE '%PR-%' OR workflow_type ILIKE '%PROCUREMENT%' OR workflow_type = 'PURCHASE_REQUEST'
             -- phiếu phối hợp 1 bước gửi thẳng Cung Ứng = yêu cầu mua hàng; quy trình nhiều bước khác (bảo trì, sửa chữa...)
             -- chỉ có 1 bước do Cung Ứng xử lý thì không phải đề xuất mua hàng
             OR (target_dept ILIKE '%Cung%' AND jsonb_array_length(CASE WHEN jsonb_typeof(steps) = 'array' THEN steps ELSE '[]'::jsonb END) <= 1)
          ORDER BY id DESC
        `),
        safeQuery(`
          SELECT i.id, i.product_code, i.product_name, i.quantity_on_hand, 
                 COALESCE(i.quantity_allocated, 0) as quantity_reserved, 
                 COALESCE(i.quantity_on_hand - COALESCE(i.quantity_allocated, 0), 0) as quantity_available, 
                 i.lot_number, i.warehouse_location, i.expiry_date,
                 p.unit, p.manufacturer, p.cost_price, p.min_stock_level
          FROM inventory_items i
          LEFT JOIN products p ON i.product_code = p.code
          ORDER BY i.id ASC
        `),
        safeQuery("SELECT * FROM inventory_reservations WHERE status = 'ACTIVE' OR status IS NULL ORDER BY id DESC"),
        safeQuery("SELECT id, customer_code, name, contact_person, phone, email, address FROM sales_customers ORDER BY name ASC"),
        safeQuery("SELECT supplier_id, COUNT(*) as product_count FROM supplier_products GROUP BY supplier_id"),
        safeQuery("SELECT code, data FROM catalog_items ORDER BY sort_order ASC, code ASC"),
        safeQuery(`
          SELECT sp.*, ps.name as supplier_name, ps.short_name as supplier_short_name, ps.supplier_code
          FROM supplier_products sp
          LEFT JOIN procurement_suppliers ps ON ps.id = sp.supplier_id
          ORDER BY sp.last_updated_at DESC, sp.id DESC
        `)
      ]);

      const suppliers = suppliersRes.rows;
      const orders = ordersRes.rows;
      const allSupplierProductsRaw = allSupplierProductsRes.rows || [];

      // Build lookup maps from catalog_items and supplier_products to enrich products & restock alerts
      const catalogMap = new Map<string, any>();
      for (const row of (catalogItemsRes.rows || [])) {
        const d = (row.data && typeof row.data === "object") ? row.data : {};
        const c = String(row.code || d.code || "").trim();
        if (c) catalogMap.set(c.toUpperCase(), { code: c, ...d });
      }

      const supplierProductByCode = new Map<string, any>();
      for (const sp of allSupplierProductsRaw) {
        const c = String(sp.product_code || "").trim().toUpperCase();
        if (c && !supplierProductByCode.has(c)) {
          supplierProductByCode.set(c, sp);
        }
      }

      const mergedProductsMap = new Map<string, any>();
      for (const p of (productsRes.rows || [])) {
        const codeKey = String(p.code || "").trim().toUpperCase();
        if (!codeKey) continue;
        const cat = catalogMap.get(codeKey);
        const sp = supplierProductByCode.get(codeKey);
        const costPrice = parseFloat(p.cost_price) || parseFloat(sp?.purchase_price) || parseFloat(cat?.costPrice) || 0;
        mergedProductsMap.set(codeKey, {
          ...p,
          parent_code: p.parent_code || cat?.parentCode || "",
          brand: p.brand || cat?.brand || p.manufacturer || "",
          manufacturer: p.manufacturer || cat?.brand || sp?.supplier_short_name || sp?.supplier_name || "",
          supplier_id: p.supplier_id || sp?.supplier_id || null,
          supplier_name: p.supplier_name || sp?.supplier_name || cat?.supplierName || p.manufacturer || cat?.brand || "",
          specification: p.specification || p.packaging_spec || cat?.packaging || sp?.specification || "",
          unit: p.unit || cat?.unit || sp?.unit || "Hộp",
          cost_price: costPrice,
        });
      }

      // Include all catalog_items (e.g. Liferiver HD-..., Meridian, SSI, Rollmed, HiMedia, Biolabs) not yet in products table
      for (const [codeKey, cat] of catalogMap.entries()) {
        if (!mergedProductsMap.has(codeKey)) {
          const sp = supplierProductByCode.get(codeKey);
          const costPrice = parseFloat(sp?.purchase_price) || parseFloat(cat.costPrice) || 0;
          mergedProductsMap.set(codeKey, {
            id: `cat-${cat.code}`,
            code: cat.code,
            parent_code: cat.parentCode || "",
            name: cat.name || cat.code,
            category: cat.category || "Sinh phẩm chẩn đoán",
            unit: cat.unit || sp?.unit || "Hộp",
            specification: cat.packaging || sp?.specification || "",
            packaging_spec: cat.packaging || sp?.specification || "",
            brand: cat.brand || "",
            manufacturer: cat.brand || cat.supplierName || sp?.supplier_short_name || sp?.supplier_name || "",
            supplier_id: sp?.supplier_id || null,
            supplier_name: sp?.supplier_name || cat.supplierName || cat.brand || "",
            origin: cat.origin || "",
            cost_price: costPrice,
            standard_price: parseFloat(cat.unitPrice) || costPrice,
            min_stock_level: 5
          });
        }
      }

      // Also include any supplier_products not yet in mergedProductsMap
      for (const sp of allSupplierProductsRaw) {
        const codeKey = String(sp.product_code || "").trim().toUpperCase();
        if (codeKey && !mergedProductsMap.has(codeKey)) {
          const costPrice = parseFloat(sp.purchase_price) || 0;
          mergedProductsMap.set(codeKey, {
            id: `sp-${sp.id}`,
            code: sp.product_code,
            parent_code: "",
            name: sp.product_name || sp.product_code,
            category: "Danh mục Nhà cung cấp",
            unit: sp.unit || "Hộp",
            specification: sp.specification || "",
            packaging_spec: sp.specification || "",
            brand: sp.supplier_short_name || sp.supplier_name || "",
            manufacturer: sp.supplier_short_name || sp.supplier_name || "",
            supplier_id: sp.supplier_id || null,
            supplier_name: sp.supplier_name || "",
            cost_price: costPrice,
            standard_price: costPrice,
            min_stock_level: 5
          });
        }
      }

      const mergedProductsList = Array.from(mergedProductsMap.values());
      const enrichedRestockRows = (inventoryRes.rows || []).map((r: any) => {
        const codeKey = String(r.product_code || "").trim().toUpperCase();
        const mp = mergedProductsMap.get(codeKey);
        const sp = supplierProductByCode.get(codeKey);
        const costPrice = parseFloat(r.cost_price) || parseFloat(sp?.purchase_price) || parseFloat(mp?.cost_price) || 0;
        return {
          ...r,
          cost_price: costPrice,
          manufacturer: r.manufacturer || mp?.manufacturer || mp?.brand || sp?.supplier_short_name || sp?.supplier_name || "",
          brand: mp?.brand || r.manufacturer || "",
          supplier_id: sp?.supplier_id || mp?.supplier_id || null,
          supplier_name: sp?.supplier_name || mp?.supplier_name || r.manufacturer || mp?.brand || ""
        };
      });

      const products = allowCost ? mergedProductsList : stripCostFields(mergedProductsList);
      const restockAlerts = allowCost ? enrichedRestockRows : stripCostFields(enrichedRestockRows);
      const allSupplierProducts = allowCost ? allSupplierProductsRaw : stripCostFields(allSupplierProductsRaw);
      const purchaseRequests = prRes.rows.map((pr: any) => {
        const isStock = Boolean(
          (pr.workflow_code && pr.workflow_code.includes("STOCK")) ||
          (pr.title && (pr.title.includes("STOCK") || pr.title.includes("LƯU TRỮ") || pr.title.includes("DỰ PHÒNG"))) ||
          pr.customer_name === "STOCK"
        );
        if (!pr.requester_name) {
          return {
            ...pr,
            requester_name: isStock ? "Bộ Phận Kho Vận" : "Phòng Kinh Doanh",
            requester_dept: isStock ? "Kho Vận" : (pr.requester_dept || "Kinh Doanh")
          };
        }
        return pr;
      });
      const inventoryItems = inventoryItemsRes.rows;
      const reservations = reservationsRes.rows;
      const customers = customersRes.rows;

      const productCountMap: Record<number, number> = {};
      (supplierProductCountsRes.rows || []).forEach((r: any) => {
        productCountMap[Number(r.supplier_id)] = parseInt(r.product_count, 10) || 0;
      });

      // Attach statistics to suppliers
      const suppliersWithStats = suppliers.map((sup: any) => {
        const supOrders = orders.filter((o: any) => o.supplier_id === sup.id || o.supplier_name === sup.name);
        const totalSpent = supOrders.reduce((acc: number, o: any) => acc + (parseFloat(o.total_amount) || 0), 0);
        return {
          ...sup,
          order_count: supOrders.length,
          total_spend: totalSpent,
          product_count: productCountMap[Number(sup.id)] || 0
        };
      });

      // Calculate global procurement metrics
      const liveOrders = orders.filter((o: any) => o.status !== "CANCELLED");
      const totalSpend = liveOrders.reduce((acc: number, o: any) => acc + (parseFloat(o.total_amount) || 0), 0);
      const totalPaid = liveOrders.reduce((acc: number, o: any) => {
        if (String(o.payment_status || "").toUpperCase() === "PAID") {
          return acc + (parseFloat(o.total_amount) || 0);
        }
        return acc + (parseFloat(o.amount_amount || o.amount_paid) || 0);
      }, 0);
      // Công nợ cần trả NCC: tính trên tổng giá trị PO (hoặc tổng các dòng hàng) trừ số tiền đã thanh toán
      const totalPayable = liveOrders.reduce((acc: number, o: any) => {
        let its: any = o.items;
        if (typeof its === "string") { try { its = JSON.parse(its); } catch { its = []; } }
        its = Array.isArray(its) ? its : [];
        const calcTot = its.reduce((sum: number, it: any) => {
          const q = Number(it?.quantity) || 0;
          const pr = Number(it?.unit_price) || 0;
          const vr = Math.max(0, Number(it?.vat_rate ?? it?.tax_rate ?? 0) || 0);
          const sub = q * pr;
          return sum + sub + (sub * vr) / 100;
        }, 0);
        const tot = Math.max(parseFloat(o.total_amount) || 0, Math.round(calcTot * 1000) / 1000);
        const rawPaid = parseFloat(o.amount_amount || o.amount_paid) || 0;
        const paid = String(o.payment_status || "").toUpperCase() === "PAID" && rawPaid <= 0 ? tot : rawPaid;
        return acc + Math.max(0, tot - paid);
      }, 0);
      const activeOrders = orders.filter((o: any) => o.status !== "COMPLETED" && o.status !== "CANCELLED").length;
      const pendingPRs = purchaseRequests.filter((pr: any) => pr.status === "PENDING" || pr.status === "APPROVED").length;

      return NextResponse.json({
        suppliers: suppliersWithStats,
        orders,
        products,
        all_supplier_products: allSupplierProducts,
        restock_alerts: restockAlerts,
        purchase_requests: purchaseRequests,
        inventory_items: inventoryItems,
        inventory_reservations: reservations,
        customers,
        stats: {
          total_spend: totalSpend,
          total_paid: totalPaid,
          total_payable: totalPayable,
          active_orders_count: activeOrders,
          pending_pr_count: pendingPRs,
          restock_alert_count: restockAlerts.length,
          total_suppliers_count: suppliers.length
        }
      });
    }

    // 1b. Get Supplier Products with price adjustment history
    if (action === "po_receipts") {
      const poCode = String(searchParams.get("po_code") || "").trim();
      if (!poCode) return NextResponse.json({ receipts: [] });
      const r = await query(
        `SELECT transaction_code, date, performed_by, items, notes, created_at
           FROM inventory_transactions
          WHERE transaction_type = 'INBOUND' AND reference_code = $1
          ORDER BY id ASC`,
        [poCode]
      );
      return NextResponse.json({ receipts: r.rows });
    }

    if (action === "supplier_products") {
      const supplierId = searchParams.get("supplier_id");
      if (!supplierId) {
        return NextResponse.json({ error: "Thiếu supplier_id" }, { status: 400 });
      }
      await syncCatalogSuppliersAndProducts();
      const res = await query(
        "SELECT * FROM supplier_products WHERE supplier_id = $1 ORDER BY last_updated_at DESC, id DESC",
        [supplierId]
      );
      return NextResponse.json({ success: true, products: allowCost ? res.rows : stripCostFields(res.rows) });
    }

    return NextResponse.json({ error: "Hành động không hợp lệ" }, { status: 400 });
  } catch (error: any) {
    console.error("Procurement GET error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const action = searchParams.get("action");
    const body = await req.json();

    const me = await getAuthorizedUser(req);
    setAuditActor(me);
    if (!me) return unauthorizedResponse();
    if ((action === "delete_order" || action === "delete_supplier") && !canApprovePO(me)) {
      return forbiddenResponse("Chỉ Trưởng bộ phận Cung ứng / Ban Giám Đốc mới được xóa đơn PO hoặc nhà cung cấp.");
    }
    if ((action === "record_payment" || action === "record_payment_multi" || action === "void_payment") && !canRecordSupplierPayment(me)) {
      return forbiddenResponse("Chỉ Kế toán / Trưởng bộ phận Cung ứng / Ban Giám Đốc mới được ghi nhận thanh toán nhà cung cấp.");
    }
    if (action === "receive_to_inventory" && !isAdminUser(me) && !hasPermission(me, "warehouse.inbound")) {
      return forbiddenResponse("Bạn không có quyền nhập kho hàng PO.");
    }
    const PROCUREMENT_WRITE_ACTIONS = new Set([
      "supplier",
      "sync_catalog_suppliers",
      "auto_collect_supplier_products",
      "save_supplier_product",
      "adjust_supplier_price",
      "delete_supplier_product",
      "import_supplier_products_excel",
      "order",
      "update_order_status",
      "update_delivery_date",
      "consolidate_prs_to_po"
    ]);
    if (action && PROCUREMENT_WRITE_ACTIONS.has(action) && !canWriteProcurement(me)) {
      return forbiddenResponse("Bạn không có quyền thực hiện thao tác mua hàng / nhà cung cấp này.");
    }

    // 1. Manage Supplier (Create / Update)
    if (action === "supplier") {
      await ensureSupplierShortName();
      const { id, supplier_code, name, short_name, contact_person, phone, email, address, product_lines, payment_terms, rating } = body;
      const cleanShortName = short_name ? String(short_name).trim() : null;
      await unmarkSupplierDeleted(name, cleanShortName || undefined);
      if (id) {
        await query(
          `UPDATE procurement_suppliers 
           SET name=$1, short_name=$2, contact_person=$3, phone=$4, email=$5, address=$6, product_lines=$7, payment_terms=$8, rating=$9 
           WHERE id=$10`,
          [name, cleanShortName, contact_person, phone, email, address, product_lines, payment_terms, rating || 5, id]
        );
        await logAudit("UPDATE", "PROCUREMENT", `Cập nhật thông tin NCC ${name} (${cleanShortName || '—'})`);
      } else {
        const code = supplier_code || `NCC-ABT-${Date.now().toString().slice(-4)}`;
        await query(
          `INSERT INTO procurement_suppliers (supplier_code, name, short_name, contact_person, phone, email, address, product_lines, payment_terms, rating)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [code, name, cleanShortName, contact_person, phone, email, address, product_lines, payment_terms || "Công nợ 30 ngày", rating || 5]
        );
        await logAudit("CREATE", "PROCUREMENT", `Thêm mới nhà cung cấp ${name} (${code}) [${cleanShortName || '—'}]`);
      }
      invalidateSupplierCatalogCache();
      await syncCatalogSuppliersAndProducts({ force: true });
      return NextResponse.json({ success: true });
    }

    // 1a. Force sync suppliers & supplier products from Product Catalog
    if (action === "sync_catalog_suppliers") {
      const syncRes = await syncCatalogSuppliersAndProducts({ forceIncludeDeleted: true });
      await logAudit(
        "SYNC_CATALOG",
        "PROCUREMENT",
        `Đồng bộ NCC từ Danh mục HH: +${syncRes.newSuppliersCreated} NCC mới, +${syncRes.newProductsLinked} SP liên kết, ${syncRes.pricesUpdated} SP cập nhật giá`
      );
      return NextResponse.json({
        success: true,
        ...syncRes
      });
    }

    // 1b. Auto-collect products from historical POs & company catalog for a Supplier
    if (action === "auto_collect_supplier_products") {
      const { supplier_id, supplier_name, actor_name } = body;
      if (!supplier_id) {
        return NextResponse.json({ error: "Thiếu supplier_id" }, { status: 400 });
      }

      // First run global catalog sync so any catalog products matching this supplier (by name, short_name, or brand) are linked
      const globalSync = await syncCatalogSuppliersAndProducts();

      // Fetch all POs associated with this supplier
      const poRes = await query(
        `SELECT id, po_code, items, order_date 
         FROM procurement_orders 
         WHERE supplier_id = $1 OR supplier_name = $2 
         ORDER BY order_date ASC, id ASC`,
        [supplier_id, supplier_name || ""]
      );

      // Existing products for this supplier
      const existingRes = await query(
        "SELECT id, product_code, purchase_price, price_history FROM supplier_products WHERE supplier_id = $1",
        [supplier_id]
      );
      const existingMap = new Map<string, any>();
      for (const row of existingRes.rows) {
        existingMap.set(String(row.product_code).trim().toLowerCase(), row);
      }

      let newCollected = globalSync.newProductsLinked;
      let priceUpdated = globalSync.pricesUpdated;

      for (const po of poRes.rows) {
        let items: any[] = [];
        try {
          items = typeof po.items === "string" ? JSON.parse(po.items) : (Array.isArray(po.items) ? po.items : []);
        } catch {
          items = [];
        }

        for (const it of items) {
          const pCode = String(it.product_code || "").trim();
          if (!pCode) continue;
          const key = pCode.toLowerCase();
          const pName = String(it.product_name || pCode).trim();
          const uPrice = parseFloat(it.unit_price) || 0;
          const poDate = po.order_date || todayVN();

          if (!existingMap.has(key)) {
            const initHist = [{
              date: poDate,
              old_price: 0,
              new_price: uPrice,
              changed_by: `Hệ thống (PO: ${po.po_code})`,
              reason: `Thu thập tự động từ đơn đặt hàng PO ${po.po_code}`,
              source: "PO_AUTO"
            }];
            const insertRes = await query(
              `INSERT INTO supplier_products (supplier_id, product_code, product_name, specification, unit, purchase_price, price_history, last_updated_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
               ON CONFLICT (supplier_id, product_code) DO NOTHING
               RETURNING id, product_code, purchase_price, price_history`,
              [supplier_id, pCode, pName, it.specification || null, it.unit || "Cái", uPrice, JSON.stringify(initHist)]
            );
            if (insertRes.rows.length > 0) {
              existingMap.set(key, insertRes.rows[0]);
              newCollected++;
            }
          } else {
            const existing = existingMap.get(key);
            const oldP = parseFloat(existing.purchase_price) || 0;
            if (uPrice > 0 && Math.abs(oldP - uPrice) > 0.01) {
              let history: any[] = [];
              try {
                history = typeof existing.price_history === "string" ? JSON.parse(existing.price_history) : (Array.isArray(existing.price_history) ? existing.price_history : []);
              } catch {
                history = [];
              }
              history.push({
                date: poDate,
                old_price: oldP,
                new_price: uPrice,
                changed_by: `Hệ thống (PO: ${po.po_code})`,
                reason: `Cập nhật đơn giá từ đơn đặt hàng PO ${po.po_code}`,
                source: "PO_AUTO"
              });
              await query(
                `UPDATE supplier_products 
                 SET purchase_price = $1, price_history = $2, last_updated_at = NOW()
                 WHERE id = $3`,
                [uPrice, JSON.stringify(history), existing.id]
              );
              existing.purchase_price = uPrice;
              existing.price_history = history;
              priceUpdated++;
            }
          }
        }
      }

      // Also auto-suggest / match items from products table if manufacturer matches
      if (supplier_name) {
        const prodMatchRes = await query(
          "SELECT code, name, specification, unit, cost_price FROM products WHERE manufacturer ILIKE $1",
          [`%${supplier_name}%`]
        );
        for (const prod of prodMatchRes.rows) {
          const key = String(prod.code).trim().toLowerCase();
          if (!existingMap.has(key)) {
            const costP = parseFloat(prod.cost_price) || 0;
            const initHist = [{
              date: todayVN(),
              old_price: 0,
              new_price: costP,
              changed_by: "Hệ thống (Kho & Hãng sản xuất)",
              reason: `Thu thập tự động từ danh mục sản phẩm của hãng "${supplier_name}"`,
              source: "CATALOG_AUTO"
            }];
            const insRes = await query(
              `INSERT INTO supplier_products (supplier_id, product_code, product_name, specification, unit, purchase_price, price_history, last_updated_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
               ON CONFLICT (supplier_id, product_code) DO NOTHING
               RETURNING id, product_code, purchase_price, price_history`,
              [supplier_id, prod.code, prod.name, prod.specification, prod.unit || "Cái", costP, JSON.stringify(initHist)]
            );
            if (insRes.rows.length > 0) {
              existingMap.set(key, insRes.rows[0]);
              newCollected++;
            }
          }
        }
      }

      await logAudit("AUTO_COLLECT", "PROCUREMENT", `Thu thập tự động danh mục cho NCC ID ${supplier_id} (${newCollected} mới, ${priceUpdated} đổi giá)`, actor_name || "system");
      return NextResponse.json({
        success: true,
        new_collected: newCollected,
        price_updated: priceUpdated,
        total_items: existingMap.size
      });
    }

    // 1c. Save / Add Single Supplier Product
    if (action === "save_supplier_product") {
      const { id, supplier_id, product_code, product_name, specification, unit, currency, purchase_price, tax_rate, lead_time_days, min_order_qty, notes, actor_name } = body;
      const cleanCode = (product_code || "").trim();
      const pPrice = parseFloat(purchase_price) || 0;

      if (!supplier_id || !cleanCode) {
        return NextResponse.json({ error: "Thiếu supplier_id hoặc product_code" }, { status: 400 });
      }

      if (id) {
        const prevRes = await query("SELECT * FROM supplier_products WHERE id = $1", [id]);
        if (prevRes.rows.length === 0) {
          return NextResponse.json({ error: "Không tìm thấy mặt hàng" }, { status: 404 });
        }
        const prev = prevRes.rows[0];
        const oldP = parseFloat(prev.purchase_price) || 0;
        let history: any[] = [];
        try {
          history = typeof prev.price_history === "string" ? JSON.parse(prev.price_history) : (Array.isArray(prev.price_history) ? prev.price_history : []);
        } catch {
          history = [];
        }

        if (Math.abs(oldP - pPrice) > 0.01) {
          history.push({
            date: new Date().toISOString(),
            old_price: oldP,
            new_price: pPrice,
            changed_by: actor_name || "Admin",
            reason: notes || "Cập nhật thông tin và đơn giá",
            source: "MANUAL"
          });
        }

        await query(
          `UPDATE supplier_products 
           SET product_name = $1, specification = $2, unit = $3, currency = $4, purchase_price = $5, 
               tax_rate = $6, lead_time_days = $7, min_order_qty = $8, notes = $9, price_history = $10, last_updated_at = NOW()
           WHERE id = $11`,
          [product_name || cleanCode, specification || null, unit || "Cái", currency || "VND", pPrice, tax_rate || 0, lead_time_days || 7, min_order_qty || 1, notes || null, JSON.stringify(history), id]
        );
        await logAudit("UPDATE_PRODUCT", "PROCUREMENT", `Cập nhật mã hàng ${cleanCode} của NCC ID ${supplier_id}`, actor_name || "system");
      } else {
        const initHist = [{
          date: new Date().toISOString(),
          old_price: 0,
          new_price: pPrice,
          changed_by: actor_name || "Admin",
          reason: notes || "Thêm mới mặt hàng vào danh mục NCC",
          source: "MANUAL"
        }];
        await query(
          `INSERT INTO supplier_products (supplier_id, product_code, product_name, specification, unit, currency, purchase_price, tax_rate, lead_time_days, min_order_qty, notes, price_history, last_updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
           ON CONFLICT (supplier_id, product_code) DO UPDATE SET
             product_name = EXCLUDED.product_name,
             specification = EXCLUDED.specification,
             unit = EXCLUDED.unit,
             purchase_price = EXCLUDED.purchase_price,
             price_history = EXCLUDED.price_history,
             last_updated_at = NOW()`,
          [supplier_id, cleanCode, product_name || cleanCode, specification || null, unit || "Cái", currency || "VND", pPrice, tax_rate || 0, lead_time_days || 7, min_order_qty || 1, notes || null, JSON.stringify(initHist)]
        );
        await logAudit("ADD_PRODUCT", "PROCUREMENT", `Thêm mã hàng mới ${cleanCode} cho NCC ID ${supplier_id}`, actor_name || "system");
      }
      invalidateSupplierCatalogCache();
      return NextResponse.json({ success: true });
    }

    // 1d. Adjust Supplier Product Price with Audit Trail & Reason
    if (action === "adjust_supplier_price") {
      const { id, new_price, effective_date, reason, actor_name, sync_cost_price } = body;
      const targetRes = await query("SELECT * FROM supplier_products WHERE id = $1", [id]);
      if (targetRes.rows.length === 0) {
        return NextResponse.json({ error: "Không tìm thấy mặt hàng để điều chỉnh giá" }, { status: 404 });
      }
      const prod = targetRes.rows[0];
      const oldPrice = parseFloat(prod.purchase_price) || 0;
      const newPrice = parseFloat(new_price) || 0;

      let history: any[] = [];
      try {
        history = typeof prod.price_history === "string" ? JSON.parse(prod.price_history) : (Array.isArray(prod.price_history) ? prod.price_history : []);
      } catch {
        history = [];
      }

      history.push({
        date: effective_date || todayVN(),
        old_price: oldPrice,
        new_price: newPrice,
        changed_by: actor_name || me.full_name || me.username || "Admin",
        reason: reason || "Điều chỉnh giá mua định kỳ",
        source: "PRICE_ADJUSTMENT"
      });

      await query(
        `UPDATE supplier_products 
         SET purchase_price = $1, price_history = $2, last_updated_at = NOW() 
         WHERE id = $3`,
        [newPrice, JSON.stringify(history), id]
      );

      // Optionally sync to system products.cost_price
      if (sync_cost_price && prod.product_code) {
        await query(
          "UPDATE products SET cost_price = $1 WHERE code = $2",
          [newPrice, prod.product_code]
        );
      }

      invalidateSupplierCatalogCache();
      await logAudit(
        "PRICE_ADJUST",
        "PROCUREMENT",
        `Điều chỉnh giá mã ${prod.product_code}: ${oldPrice.toLocaleString('vi-VN', { maximumFractionDigits: 0 })} đ -> ${newPrice.toLocaleString('vi-VN', { maximumFractionDigits: 0 })} đ. Lý do: ${reason || 'Không ghi'}`,
        actor_name || me.full_name || me.username || "system"
      );
      return NextResponse.json({ success: true });
    }

    // 1e. Delete Supplier Product
    if (action === "delete_supplier_product") {
      const { id, product_code, actor_name } = body;
      await query("DELETE FROM supplier_products WHERE id = $1", [id]);
      invalidateSupplierCatalogCache();
      await logAudit("DELETE_PRODUCT", "PROCUREMENT", `Xóa mã hàng ${product_code || id} khỏi danh mục NCC`, actor_name || "system");
      return NextResponse.json({ success: true });
    }

    // 1f. Import Supplier Products from Excel
    if (action === "import_supplier_products_excel") {
      const { supplier_id, items, actor_name } = body;
      if (!supplier_id || !Array.isArray(items)) {
        return NextResponse.json({ error: "Dữ liệu nhập không hợp lệ" }, { status: 400 });
      }

      let imported = 0;
      for (const row of items) {
        const code = String(row.product_code || row["Mã hàng"] || row["Mã sản phẩm"] || "").trim();
        if (!code) continue;
        const name = String(row.product_name || row["Tên hàng"] || row["Tên sản phẩm"] || code).trim();
        const spec = String(row.specification || row["Quy cách"] || "").trim();
        const unit = String(row.unit || row["ĐVT"] || row["Đơn vị tính"] || "Cái").trim();
        const price = parseFloat(row.purchase_price || row["Giá mua"] || row["Đơn giá"] || 0);
        const notes = String(row.notes || row["Ghi chú"] || "").trim();

        const prevRes = await query("SELECT id, purchase_price, price_history FROM supplier_products WHERE supplier_id = $1 AND product_code = $2", [supplier_id, code]);
        if (prevRes.rows.length === 0) {
          const initHist = [{
            date: todayVN(),
            old_price: 0,
            new_price: price,
            changed_by: actor_name || "Nạp Excel",
            reason: "Nạp danh mục giá từ file Excel",
            source: "EXCEL_IMPORT"
          }];
          await query(
            `INSERT INTO supplier_products (supplier_id, product_code, product_name, specification, unit, purchase_price, notes, price_history, last_updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
             ON CONFLICT (supplier_id, product_code) DO NOTHING`,
            [supplier_id, code, name, spec || null, unit, price, notes || null, JSON.stringify(initHist)]
          );
        } else {
          const prev = prevRes.rows[0];
          const oldP = parseFloat(prev.purchase_price) || 0;
          let history: any[] = [];
          try {
            history = typeof prev.price_history === "string" ? JSON.parse(prev.price_history) : (Array.isArray(prev.price_history) ? prev.price_history : []);
          } catch {
            history = [];
          }
          if (Math.abs(oldP - price) > 0.01) {
            history.push({
              date: todayVN(),
              old_price: oldP,
              new_price: price,
              changed_by: actor_name || "Nạp Excel",
              reason: "Cập nhật giá từ file Excel",
              source: "EXCEL_IMPORT"
            });
          }
          await query(
            `UPDATE supplier_products 
             SET product_name = $1, specification = COALESCE(NULLIF($2, ''), specification), unit = $3, purchase_price = $4, notes = COALESCE(NULLIF($5, ''), notes), price_history = $6, last_updated_at = NOW()
             WHERE id = $7`,
            [name, spec, unit, price, notes, JSON.stringify(history), prev.id]
          );
        }
        imported++;
      }
      invalidateSupplierCatalogCache();
      await logAudit("EXCEL_IMPORT", "PROCUREMENT", `Nạp Excel thành công ${imported} mã hàng cho NCC ID ${supplier_id}`, actor_name || "system");
      return NextResponse.json({ success: true, count: imported });
    }

    // 2. Delete Supplier
    if (action === "delete_supplier") {
      const { id, name } = body;
      const orderCheck = await query("SELECT COUNT(*) FROM procurement_orders WHERE supplier_id = $1", [id]);
      if (parseInt(orderCheck.rows[0].count) > 0) {
        return NextResponse.json({ error: "Không thể xóa NCC này vì đã có đơn đặt hàng (PO) liên quan!" }, { status: 400 });
      }
      const supRes = await query("SELECT name, short_name FROM procurement_suppliers WHERE id = $1", [id]);
      const supRow = supRes.rows[0];
      await query("DELETE FROM procurement_suppliers WHERE id = $1", [id]);
      await markSupplierDeleted(supRow?.name || name, supRow?.short_name);
      await logAudit("DELETE", "PROCUREMENT", `Xóa hồ sơ nhà cung cấp ${supRow?.name || name || id}`);
      return NextResponse.json({ success: true });
    }

    // 3. Manage PO (Create / Update - C4 & H7)
    if (action === "order") {
      const { id, po_code, supplier_id, supplier_name, order_date, expected_delivery_date, status, notes, rollback_reason } = body;
      const rawItems = Array.isArray(body.items) ? body.items : null;
      const items = rawItems
        ? rawItems.map((it: any) => {
            const qty = Number(it?.quantity) || 0;
            const price = Math.round(Number(it?.unit_price) || 0);
            const subtotal = Math.round(qty * price);
            const vatRate = Math.max(0, Number(it?.vat_rate ?? it?.tax_rate ?? 0) || 0);
            const vatAmount = Math.round((subtotal * vatRate) / 100);
            const totalAfterVat = subtotal + vatAmount;
            return {
              ...it,
              unit_price: price,
              subtotal,
              vat_rate: vatRate,
              vat_amount: vatAmount,
              total_after_vat: totalAfterVat,
              total: totalAfterVat
            };
          })
        : undefined;
      const total_amount = items
        ? Math.round(items.reduce((sum: number, it: any) => sum + (Number(it.total_after_vat ?? it.total) || 0), 0) * 1000) / 1000
        : body.total_amount;
      const force_rollback = Boolean(body.force_rollback) && isAdminUser(me); // lùi trạng thái: chỉ Quản trị viên
      let finalPoCode = po_code;
      let targetId = id;

      const orderResult = await withTransaction(async (c) => {
        if (!targetId && po_code) {
          const checkRes = await c.query("SELECT id, status, version FROM procurement_orders WHERE po_code = $1", [po_code]);
          if (checkRes.rows.length > 0) {
            targetId = checkRes.rows[0].id;
          }
        }

        if (targetId) {
          const PO_STATUS_HIERARCHY: Record<string, number> = {
            "DRAFT": 0, "PENDING": 1, "APPROVED": 2, "CONFIRMED": 2, "ORDERED": 3,
            "PRODUCED": 4, "SHIPPED": 5, "SHIPPING": 5, "IN_TRANSIT": 5,
            "AT_CUSTOMS": 6, "ARRIVED_CUSTOMS": 6, "CUSTOMS_CLEARING": 7, "CUSTOMS_CLEARANCE": 7,
            "DELIVERED": 8, "RECEIVED": 8, "PARTIAL_RECEIVED": 8, "PARTIALLY_RECEIVED": 8, "COMPLETED": 9, "CANCELLED": 99
          };
          const existingRes = await c.query("SELECT id, status, version, po_code, items, received_qty FROM procurement_orders WHERE id = $1 FOR UPDATE", [targetId]);
          if (existingRes.rows.length === 0) {
            throw new HttpError(404, "Không tìm thấy đơn PO để cập nhật");
          }
          const existing = existingRes.rows[0];
          finalPoCode = existing.po_code;
          const existingUpper = String(existing.status || "").toUpperCase();

          if (existingUpper === "CANCELLED" && !force_rollback) {
            throw new HttpError(409, `Đơn PO đã ở trạng thái "${existing.status}", không thể chỉnh sửa!`);
          }
          if (
            ["RECEIVED", "PARTIAL_RECEIVED", "PARTIALLY_RECEIVED", "DELIVERED"].includes(existingUpper) &&
            status &&
            ["DRAFT", "PENDING", "APPROVED", "CONFIRMED", "ORDERED", "PRODUCED", "CANCELLED"].includes(String(status).toUpperCase()) &&
            !force_rollback
          ) {
            throw new HttpError(409, `Đơn PO đã nhập kho ("${existing.status}"), không thể chuyển ngược về "${status}" hoặc hủy!`);
          }

          if (body.version !== undefined && body.version !== null && Number(body.version) !== Number(existing.version)) {
            throw new HttpError(409, "Đơn PO đã được người khác cập nhật! Vui lòng tải lại trang để thấy dữ liệu mới nhất.");
          }

          let safeStatus = status || existing.status || "PENDING";
          if (["PARTIALLY_RECEIVED", "PARTIAL_RECEIVED"].includes(existingUpper) && Array.isArray(items)) {
            const rq = existing.received_qty || {};
            const oldItems: any[] = Array.isArray(existing.items) ? existing.items : [];
            for (const [k, v] of Object.entries(rq)) {
              const got = Number(v) || 0;
              if (got <= 0) continue;
              const idx = Number(k);
              const oldIt = oldItems[idx];
              const newIt = items[idx];
              if (!newIt || (oldIt && String(newIt.product_code || "") !== String(oldIt.product_code || "")) || (Number(newIt.quantity) || 0) < got) {
                throw new HttpError(409, `Dòng ${idx + 1} (${oldIt?.product_code || ""}) đã nhập kho ${got}: không thể xoá dòng, đổi mã hàng hoặc giảm số lượng dưới số đã nhập.`);
              }
            }
          }
          // Duyệt / xác nhận đơn PO cần quyền phê duyệt hoặc quyền ghi Cung ứng
          {
            const curLvl = PO_STATUS_HIERARCHY[existingUpper] ?? 0;
            const reqLvl = PO_STATUS_HIERARCHY[String(safeStatus).toUpperCase()] ?? 0;
            if (curLvl < 2 && reqLvl >= 2 && reqLvl !== 99 && !canApprovePO(me)) safeStatus = existing.status; // only an approver moves a PO past PENDING
          }
          if (!force_rollback) {
            const currLvl = PO_STATUS_HIERARCHY[existingUpper] ?? 0;
            const nextLvl = PO_STATUS_HIERARCHY[safeStatus?.toUpperCase()] ?? 0;
            if (nextLvl < currLvl && safeStatus?.toUpperCase() !== "CANCELLED") {
              safeStatus = existing.status; // Prevent regression
            }
          }

          // C4: amount_paid is strictly owned by record_payment, never overwritten by order edit
          const upd = await c.query(
            `UPDATE procurement_orders 
             SET supplier_id=COALESCE($1, supplier_id), supplier_name=COALESCE($2, supplier_name), 
                 order_date=COALESCE($3, order_date), expected_delivery_date=COALESCE($4, expected_delivery_date), 
                 items=COALESCE($5, items), total_amount=COALESCE($6, total_amount), 
                 status=$7, notes=COALESCE($8, notes), version=COALESCE(version, 0) + 1
             WHERE id=$9 RETURNING version`,
            [supplier_id || null, supplier_name || "Nhà cung cấp / Hãng", order_date, expected_delivery_date, items ? JSON.stringify(items) : null, total_amount, safeStatus, notes, targetId]
          );

          // Đồng bộ đơn giá & nhà cung cấp từ PO sang các Phiếu Nhập Kho (PNK), Lô tồn kho & Danh mục sản phẩm liên kết
          if (Array.isArray(items) && items.length > 0 && finalPoCode) {
            const txRes = await c.query(
              `SELECT id, items FROM inventory_transactions WHERE transaction_type = 'INBOUND' AND reference_code = $1 FOR UPDATE`,
              [finalPoCode]
            );
            for (const txRow of txRes.rows) {
              let txItems: any[] = [];
              try {
                txItems = typeof txRow.items === "string" ? JSON.parse(txRow.items || "[]") : (Array.isArray(txRow.items) ? txRow.items : []);
              } catch {
                txItems = [];
              }
              let txChanged = false;
              const updatedLots: Array<{ code: string; lot: string; price: number }> = [];
              const updatedTxItems = txItems.map((ti: any) => {
                const tiCode = String(ti?.product_code || ti?.productCode || "").trim().toUpperCase();
                const lineIdx = Number.isInteger(Number(ti?.line_index)) && Number(ti?.line_index) >= 0 ? Number(ti.line_index) : -1;
                const matchedPoIt =
                  (lineIdx >= 0 && items[lineIdx] && String(items[lineIdx]?.product_code || "").trim().toUpperCase() === tiCode ? items[lineIdx] : null) ||
                  items.find((pi: any) => String(pi?.product_code || "").trim().toUpperCase() === tiCode);
                if (!matchedPoIt) return ti;
                const nextPrice = Number(matchedPoIt.unit_price) || 0;
                const nextSup = supplier_name || ti.supplier_name || "";
                if ((nextPrice > 0 && nextPrice !== Number(ti.unit_price || 0)) || (nextSup && nextSup !== ti.supplier_name)) {
                  txChanged = true;
                  const effPrice = nextPrice > 0 ? nextPrice : Number(ti.unit_price || 0);
                  const lotNo = String(ti?.lot_number || ti?.lotNumber || "").trim();
                  if (effPrice > 0 && lotNo) {
                    updatedLots.push({ code: String(ti?.product_code || ti?.productCode || "").trim(), lot: lotNo, price: effPrice });
                  }
                  return {
                    ...ti,
                    unit_price: effPrice,
                    cost_price: effPrice,
                    total_amount: (Number(ti.quantity) || 0) * effPrice,
                    ...(nextSup ? { supplier_name: nextSup } : {})
                  };
                }
                return ti;
              });
              if (txChanged) {
                await c.query(`UPDATE inventory_transactions SET items = $1 WHERE id = $2`, [JSON.stringify(updatedTxItems), txRow.id]);
                for (const ul of updatedLots) {
                  await c.query(`UPDATE inventory_lots SET unit_cost = $1 WHERE product_code = $2 AND lot_number = $3`, [ul.price, ul.code, ul.lot]).catch(() => {});
                }
              }
            }

            for (const poIt of items) {
              const pCode = String(poIt?.product_code || "").trim();
              const uPrice = Number(poIt?.unit_price) || 0;
              if (pCode && uPrice > 0) {
                await c.query(`UPDATE products SET cost_price = $1 WHERE code = $2`, [uPrice, pCode]);
                await c.query(`UPDATE inventory_lots SET unit_cost = $1 WHERE product_code = $2 AND COALESCE(unit_cost, 0) = 0`, [uPrice, pCode]).catch(() => {});
              }
            }
          }

          return { po_id: targetId, po_code: finalPoCode, isNew: false, version: upd.rows[0]?.version, safeStatus };
        } else {
          // If a po_code is provided for create, ensure no duplicate
          if (po_code) {
            const dupCheck = await c.query("SELECT id FROM procurement_orders WHERE po_code = $1", [po_code]);
            if (dupCheck.rows.length > 0) {
              throw new HttpError(409, `Mã đơn PO "${po_code}" đã tồn tại trên hệ thống!`);
            }
          }

          const code = po_code || await generateDocumentCode({
            docType: "PO",
            customPrefix: "ABT",
            tagMode: "GENERAL"
          });
          finalPoCode = code;

          let createStatus = String(status || "PENDING").toUpperCase();
          if (["COMPLETED", "PARTIALLY_RECEIVED", "PARTIAL_RECEIVED", "RECEIVED"].includes(createStatus)) createStatus = "PENDING";
          if (["APPROVED", "CONFIRMED", "ORDERED", "PRODUCED", "SHIPPED", "SHIPPING", "IN_TRANSIT", "AT_CUSTOMS", "ARRIVED_CUSTOMS", "CUSTOMS_CLEARING", "CUSTOMS_CLEARANCE"].includes(createStatus) && !canApprovePO(me)) createStatus = "PENDING";
          await ensureSupplierShortName();
          const poCreator = String(body.created_by || me.full_name || me.username || "Chuyên viên Cung ứng").trim();
          const ins = await c.query(
            `INSERT INTO procurement_orders (po_code, supplier_id, supplier_name, order_date, expected_delivery_date, items, total_amount, amount_paid, status, notes, created_by, version)
             VALUES ($1, $2, $3, $4, $5, $6, $7, 0, $8, $9, $10, 1) RETURNING id, version`,
            [code, supplier_id || null, supplier_name || "Nhà cung cấp / Hãng", order_date || todayVN(), expected_delivery_date, JSON.stringify(items || []), total_amount || 0,
             createStatus, notes, poCreator]
          );
          targetId = ins.rows[0].id;

          // H7: Single atomic transaction when converting PR to PO from the server
          const linkedPrId = body.linked_pr_id || body.source_pr_id;
          if (linkedPrId) {
            const prRes = await c.query(
              "SELECT id, workflow_code, results_summary, logs FROM workflow_requests WHERE id = $1 FOR UPDATE",
              [parseInt(linkedPrId) || -1]
            );
            if (prRes.rows.length > 0) {
              const prRow = prRes.rows[0];
              let parsedItems: any[] = [];
              try {
                if (typeof prRow.results_summary === "string" && prRow.results_summary.trim().startsWith("[")) {
                  parsedItems = JSON.parse(prRow.results_summary);
                } else if (Array.isArray(prRow.results_summary)) {
                  parsedItems = prRow.results_summary;
                }
              } catch {}

              const convertedIndices: number[] = body.converted_item_indices || body.converted_indices;
              // A PR line is converted only when the PO really contains its product (a line removed from the form stays open)
              const poProductCodes = new Set((Array.isArray(items) ? items : []).map((x: any) => String(x?.product_code || "").trim()).filter(Boolean));
              parsedItems.forEach((it: any, idx: number) => {
                if ((!convertedIndices || convertedIndices.includes(idx)) && poProductCodes.has(String(it?.product_code || "").trim())) {
                  if (it.po_code && it.po_code !== code) {
                    throw new HttpError(409, `Mặt hàng "${it.product_name || it.product_code}" đã được gắn vào PO ${it.po_code}`);
                  }
                  it.po_code = code;
                  it.status = "CONVERTED";
                }
              });

              const remaining = parsedItems.filter((it: any) => !it.po_code);
              const targetPrStatus = remaining.length > 0 ? "PARTIAL_CONVERTED" : "CONVERTED";
              const logs = Array.isArray(prRow.logs) ? prRow.logs : [];
              logs.push({
                time: nowVNDateTime(),
                actor: body.created_by || "Phòng Cung Ứng",
                action: `Đã lập đơn mua hàng ${code} (${items?.length || 0} mặt hàng) [${targetPrStatus}]`
              });

              await c.query(
                "UPDATE workflow_requests SET status = $1, results_summary = $2, logs = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $4",
                [targetPrStatus, JSON.stringify(parsedItems), JSON.stringify(logs), prRow.id]
              );
              await linkSalesOrdersToPO(c, [prRow.workflow_code], code);
            }
          }

          return { po_id: targetId, po_code: code, isNew: true, version: ins.rows[0].version, safeStatus: status || "ORDERED" };
        }
      });

      if (orderResult.isNew) {
        await logAudit("CREATE", "PROCUREMENT", `Lập đơn đặt mua hàng mới ${orderResult.po_code} cho NCC ${supplier_name || 'Hãng'}`);
        if (String(orderResult.safeStatus || "").toUpperCase() === "PENDING") {
          notifyZaloProactiveEvent({
            eventType: "PO_APPROVAL_NEEDED",
            code: orderResult.po_code,
            customerName: supplier_name || "Nhà cung cấp",
            requesterName: me.full_name || me.username,
            totalAmount: Number(total_amount) || 0,
            reasonOrNote: notes || ""
          }).catch(() => {});
        }
      } else {
        await logAudit("UPDATE", "PROCUREMENT", `Cập nhật đơn đặt mua hàng ${orderResult.po_code} [Trạng thái: ${orderResult.safeStatus}]`);
      }

      // Auto-sync items to supplier_products catalog and record price history
      if (supplier_id && Array.isArray(items) && items.length > 0) {
        try {
          for (const it of items) {
            const pCode = String(it.product_code || "").trim();
            const pName = String(it.product_name || pCode).trim();
            const uPrice = parseFloat(it.unit_price) || 0;
            if (pCode && uPrice > 0) {
              const existingProd = await query(
                "SELECT id, purchase_price, price_history FROM supplier_products WHERE supplier_id = $1 AND product_code = $2",
                [supplier_id, pCode]
              );
              if (existingProd.rows.length === 0) {
                const initHist = [{
                  date: order_date || todayVN(),
                  old_price: 0,
                  new_price: uPrice,
                  changed_by: `Hệ thống (PO: ${finalPoCode})`,
                  reason: `Thu thập tự động từ đơn đặt hàng PO ${finalPoCode}`,
                  source: "PO_AUTO"
                }];
                await query(
                  `INSERT INTO supplier_products (supplier_id, product_code, product_name, purchase_price, price_history, last_updated_at)
                   VALUES ($1, $2, $3, $4, $5, NOW())
                   ON CONFLICT (supplier_id, product_code) DO NOTHING`,
                  [supplier_id, pCode, pName, uPrice, JSON.stringify(initHist)]
                );
              } else {
                const prev = existingProd.rows[0];
                const oldP = parseFloat(prev.purchase_price) || 0;
                if (Math.abs(oldP - uPrice) > 0.01) {
                  let history: any[] = [];
                  try {
                    history = typeof prev.price_history === "string" ? JSON.parse(prev.price_history) : (Array.isArray(prev.price_history) ? prev.price_history : []);
                  } catch {
                    history = [];
                  }
                  history.push({
                    date: order_date || todayVN(),
                    old_price: oldP,
                    new_price: uPrice,
                    changed_by: `Hệ thống (PO: ${finalPoCode})`,
                    reason: `Cập nhật đơn giá theo đơn đặt hàng PO ${finalPoCode}`,
                    source: "PO_AUTO"
                  });
                  await query(
                    `UPDATE supplier_products 
                     SET purchase_price = $1, price_history = $2, last_updated_at = NOW(),
                         product_name = COALESCE(NULLIF($3, ''), product_name)
                     WHERE id = $4`,
                    [uPrice, JSON.stringify(history), pName, prev.id]
                  );
                }
              }
            }
          }
          invalidateSupplierCatalogCache();
        } catch (syncErr: any) {
          console.error("[AUTO_SYNC_SUPPLIER_PRODUCTS_ERR]:", syncErr?.message || syncErr);
        }
      }

      // Auto-sync PO to Factory Internal Orders (Đơn hàng nội bộ)
      if (Array.isArray(items) && items.length > 0) {
        try {
          const soCodes = Array.from(
            new Set(
              items
                .map((it: any) => String(it?.source_so_code || it?.so_code || it?.source_pr_code || "").trim())
                .filter(Boolean)
            )
          ).join(", ");
          await withFactoryTx((tx) =>
            syncKdOrderOrPoToInternalOrder(tx, {
              kd_po_code: finalPoCode,
              kd_so_code: soCodes || finalPoCode,
              customer_name: supplier_name || "Đơn PO Kinh doanh / Cung ứng",
              requested_date: expected_delivery_date || order_date || todayVN(),
              notes: notes || `Đồng bộ tự động từ PO ${finalPoCode}`,
              items,
            })
          );
        } catch (syncFactoryErr: any) {
          console.error("[AUTO_SYNC_PO_TO_INTERNAL_ORDER_ERR]:", syncFactoryErr?.message || syncFactoryErr);
        }
      }

      return NextResponse.json({ success: true, po_code: finalPoCode, po_id: orderResult.po_id, version: orderResult.version });
    }

    // 4. Delete PO (M1: protect completed/paid/inbounded POs)
    if (action === "delete_order") {
      const { id, po_code } = body;
      const deletedPoCode = await withTransaction(async (c) => {
        const del = await c.query(
          `DELETE FROM procurement_orders 
           WHERE id = $1 AND status IN ('DRAFT', 'PENDING') 
             AND COALESCE(amount_paid, 0) = 0 AND inbound_transaction_code IS NULL 
           RETURNING po_code`,
          [id]
        );
        if (del.rowCount === 0) {
          throw new HttpError(409, "Chỉ có thể xoá đơn PO ở trạng thái Nháp hoặc Chờ duyệt, chưa thanh toán và chưa nhập kho. Với đơn đã xử lý, vui lòng chọn trạng thái 'Huỷ'.");
        }
        const delCode = del.rows[0]?.po_code;

        // Hoàn trả trạng thái các phiếu PR nếu PO này được gom từ các đề xuất PR
        if (delCode) {
          const prs = await c.query(
            `SELECT id, results_summary, logs FROM workflow_requests 
             WHERE results_summary::text LIKE $1 FOR UPDATE`,
            [`%${delCode}%`]
          );
          for (const pr of prs.rows) {
            let items: any[] = [];
            try {
              items = typeof pr.results_summary === "string" ? JSON.parse(pr.results_summary) : (pr.results_summary || []);
            } catch {}
            let changed = false;
            items.forEach((it: any) => {
              if (it.po_code === delCode) {
                delete it.po_code;
                it.status = "APPROVED";
                changed = true;
              }
            });
            if (changed) {
              const anyConverted = items.some((it: any) => Boolean(it.po_code));
              const newStatus = anyConverted ? "PARTIAL_CONVERTED" : "APPROVED";
              const logs = Array.isArray(pr.logs) ? pr.logs : [];
              logs.push({
                time: nowVNDateTime(),
                actor: "Phòng Cung Ứng",
                action: `Đơn PO ${delCode} đã bị xoá. Hoàn trả mặt hàng về danh sách đề xuất mua sắm.`
              });
              await c.query(
                `UPDATE workflow_requests SET status = $1, results_summary = $2, logs = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $4`,
                [newStatus, JSON.stringify(items), JSON.stringify(logs), pr.id]
              );
            }
          }
        }
        return delCode;
      });

      await logAudit("DELETE", "PROCUREMENT", `Xóa đơn đặt mua hàng ${po_code || id}`);
      return NextResponse.json({ success: true, deleted_po_code: deletedPoCode });
    }

    // 5. Update PO Status with FSM Protection (M3 & L2)
    if (action === "update_order_status") {
      const { id, po_code, status, expected_delivery_date, rollback_reason } = body;
      const force_rollback = Boolean(body.force_rollback) && isAdminUser(me); // lùi trạng thái: chỉ Quản trị viên

      const PO_STATUS_HIERARCHY: Record<string, number> = {
        "DRAFT": 0,
        "PENDING": 1,
        "APPROVED": 2,
        "CONFIRMED": 2,
        "ORDERED": 3,
        "PRODUCED": 4,
        "SHIPPED": 5,
        "SHIPPING": 5,
        "IN_TRANSIT": 5,
        "AT_CUSTOMS": 6,
        "ARRIVED_CUSTOMS": 6,
        "CUSTOMS_CLEARING": 7,
        "CUSTOMS_CLEARANCE": 7,
        "DELIVERED": 8,
        "RECEIVED": 8,
        "PARTIAL_RECEIVED": 8,
        "PARTIALLY_RECEIVED": 8,
        "COMPLETED": 9,
        "CANCELLED": 99
      };

      await withTransaction(async (c) => {
        const existingRes = await c.query("SELECT id, status, inbound_transaction_code FROM procurement_orders WHERE id = $1 FOR UPDATE", [id]);
        if (existingRes.rows.length === 0) {
          throw new HttpError(404, "Không tìm thấy đơn PO");
        }
        const existing = existingRes.rows[0];
        const existingUpper = String(existing.status || "").toUpperCase();
        const targetUpper = String(status || "").toUpperCase();
        if (
          existing.inbound_transaction_code &&
          ["RECEIVED", "PARTIAL_RECEIVED", "PARTIALLY_RECEIVED", "DELIVERED", "COMPLETED"].includes(existingUpper) &&
          ["DRAFT", "PENDING", "APPROVED", "CONFIRMED", "ORDERED", "PRODUCED", "CANCELLED"].includes(targetUpper) &&
          !force_rollback
        ) {
          throw new HttpError(409, `Đơn PO đã có phiếu nhập kho ("${existing.inbound_transaction_code}"), không thể chuyển ngược về "${status}" hoặc hủy!`);
        }

        const currLvl = PO_STATUS_HIERARCHY[existingUpper] ?? 0;
        const nextLvl = PO_STATUS_HIERARCHY[targetUpper] ?? 0;
        if (!(targetUpper in PO_STATUS_HIERARCHY)) {
          throw new HttpError(400, `Trạng thái PO "${status}" không hợp lệ.`);
        }
        // Chỉ người có quyền duyệt PO (Trưởng Cung ứng / BGĐ) mới đưa PO từ Nháp / Chờ duyệt lên Đã duyệt trở đi
        if (currLvl < 2 && nextLvl >= 2 && nextLvl !== 99 && !canApprovePO(me)) {
          throw new HttpError(403, "Chỉ Trưởng bộ phận Cung ứng / Ban Giám Đốc mới được duyệt đơn PO.");
        }

        if (expected_delivery_date) {
          await c.query(
            "UPDATE procurement_orders SET status = $1, expected_delivery_date = $2, version = COALESCE(version, 0) + 1 WHERE id = $3",
            [status, expected_delivery_date, id]
          );
        } else {
          await c.query(
            "UPDATE procurement_orders SET status = $1, version = COALESCE(version, 0) + 1 WHERE id = $2",
            [status, id]
          );
        }
      });

      await logAudit("UPDATE_STATUS", "PROCUREMENT", `Cập nhật trạng thái đơn PO ${po_code || id} thành ${status}${force_rollback ? ` [ROLLBACK: ${rollback_reason}]` : ''}`);
      return NextResponse.json({ success: true });
    }

    // 5a. Update PO Payment Status (Interactive Payment Status badge on PO table - Requirement 6 / 4d)
    if (action === "update_payment_status") {
      if (!canWriteProcurement(me) && !canRecordSupplierPayment(me)) {
        return forbiddenResponse("Bạn không có quyền cập nhật trạng thái thanh toán của PO.");
      }
      const poId = Number(body.id || body.po_id);
      const poCode = String(body.po_code || "").trim();
      const rawPayStatus = String(body.payment_status || "UNPAID").trim().toUpperCase();
      // Số tiền đã trả chỉ thay đổi qua phiếu chi (record_payment / record_payment_multi / void_payment).
      // Ở đây chỉ bật / tắt cờ "Đề nghị thanh toán"; trước đây chọn "Đã TT" ghi amount_paid = tổng tiền
      // và "TT một phần" ghi bịa 50% tổng tiền mà không có phiếu chi nào.
      if (rawPayStatus === "PAID" || rawPayStatus === "PARTIAL_PAID") {
        return NextResponse.json(
          { error: "Trạng thái Đã thanh toán / Thanh toán một phần được tính tự động từ phiếu chi. Vui lòng ghi nhận phiếu chi cho PO này." },
          { status: 400 }
        );
      }
      if (rawPayStatus !== "UNPAID" && rawPayStatus !== "PAYMENT_REQUESTED") {
        return NextResponse.json({ error: `Trạng thái thanh toán "${body.payment_status}" không hợp lệ.` }, { status: 400 });
      }

      await ensureSupplierShortName();
      const updated = await withTransaction(async (c) => {
        const poRes = await c.query(
          "SELECT id, po_code, total_amount, amount_paid, payment_status FROM procurement_orders WHERE ($1::int > 0 AND id = $1) OR ($2 <> '' AND po_code = $2) FOR UPDATE",
          [Number.isInteger(poId) && poId > 0 ? poId : 0, poCode]
        );
        if (poRes.rows.length === 0) {
          throw new HttpError(404, "Không tìm thấy đơn PO để cập nhật trạng thái thanh toán");
        }
        const po = poRes.rows[0];
        const totalAmt = parseFloat(po.total_amount) || 0;
        const currPaid = parseFloat(po.amount_paid) || 0;
        // Trạng thái suy ra từ số đã trả thật
        const derived = totalAmt > 0 && currPaid >= totalAmt - 0.5 ? "PAID" : currPaid > 0 ? "PARTIAL_PAID" : "UNPAID";
        if (rawPayStatus === "PAYMENT_REQUESTED" && derived === "PAID") {
          throw new HttpError(409, `PO ${po.po_code} đã thanh toán đủ, không cần đề nghị thanh toán.`);
        }
        const nextPayStatus = rawPayStatus === "PAYMENT_REQUESTED" ? "PAYMENT_REQUESTED" : derived;

        await c.query(
          "UPDATE procurement_orders SET payment_status = $1, version = COALESCE(version, 0) + 1 WHERE id = $2",
          [nextPayStatus, po.id]
        );
        return { id: po.id, po_code: po.po_code, payment_status: nextPayStatus, amount_paid: currPaid };
      });

      await logAudit("UPDATE_PAYMENT_STATUS", "PROCUREMENT", `Cập nhật trạng thái thanh toán PO ${updated.po_code} thành ${updated.payment_status}`);
      return NextResponse.json({ success: true, ...updated });
    }

    // 5b. Update Delivery Date
    if (action === "update_delivery_date") {
      const { id, po_code, expected_delivery_date } = body;
      await query("UPDATE procurement_orders SET expected_delivery_date = $1, version = COALESCE(version, 0) + 1 WHERE id = $2", [expected_delivery_date, id]);
      await logAudit("UPDATE_DELIVERY_DATE", "PROCUREMENT", `Cập nhật hạn giao hàng đơn PO ${po_code} thành ${expected_delivery_date}`);
      return NextResponse.json({ success: true });
    }

    // 6. Record Payment (Accounts Payable - C1)
    // Một phiếu chi trả cho nhiều PO của CÙNG một nhà cung cấp (phân bổ số tiền theo từng PO)
    if (action === "record_payment_multi") {
      const { allocations, payment_method, reference_doc, payment_date, payment_notes, request_id } = body;
      const alloc = (Array.isArray(allocations) ? allocations : [])
        .map((a: any) => ({ po_id: Number(a?.po_id), amount: Math.round((Number(a?.amount) || 0) * 100) / 100 }))
        .filter((a: any) => Number.isInteger(a.po_id) && a.po_id > 0 && a.amount > 0);
      if (alloc.length === 0) throw new HttpError(400, "Chọn ít nhất 1 PO với số tiền chi > 0");
      if (new Set(alloc.map((a: any) => a.po_id)).size !== alloc.length) throw new HttpError(400, "Mỗi PO chỉ được phân bổ 1 lần trong một phiếu chi");
      const reqBase = String(request_id || `MULTI_${Date.now()}`).slice(0, 48);
      const voucher = `PC-${todayVN().replace(/-/g, "").slice(2)}-${reqBase.slice(-6).toUpperCase()}`;
      const result = await withTransaction(async (c) => {
        const rows = (await c.query(
          "SELECT id, po_code, supplier_name, total_amount, amount_paid, status FROM procurement_orders WHERE id = ANY($1::int[]) ORDER BY id FOR UPDATE",
          [alloc.map((a: any) => a.po_id)]
        )).rows;
        if (rows.length !== alloc.length) throw new HttpError(404, "Có PO không tồn tại");
        const suppliers = new Set(rows.map((r: any) => String(r.supplier_name || "").trim().toLowerCase()));
        if (suppliers.size > 1) throw new HttpError(400, "Một phiếu chi chỉ trả cho các PO của cùng một nhà cung cấp");
        const dup = await c.query("SELECT 1 FROM procurement_payments WHERE voucher_code = $1 LIMIT 1", [voucher]);
        if (dup.rows[0]) return { duplicate: true, voucher, rows };
        for (const a of alloc) {
          const po = rows.find((r: any) => r.id === a.po_id);
          if (String(po.status || "").toUpperCase() === "CANCELLED") throw new HttpError(400, `PO ${po.po_code} đã hủy`);
          const remaining = Number(po.total_amount) - Number(po.amount_paid);
          if (a.amount > remaining + 0.5) {
            throw new HttpError(400, `PO ${po.po_code}: số chi ${a.amount.toLocaleString("vi-VN", { maximumFractionDigits: 0 })} đ vượt công nợ còn lại ${remaining.toLocaleString("vi-VN", { maximumFractionDigits: 0 })} đ`);
          }
          await c.query(
            `INSERT INTO procurement_payments (po_id, request_id, amount, method, reference_doc, payment_date, notes, created_by, voucher_code)
             VALUES ($1, $2, $3, $4, $5, COALESCE($6::date, $9::date), $7, $8, $10)`,
            [a.po_id, `${reqBase}_${a.po_id}`, a.amount, payment_method || "CK", reference_doc || null, payment_date || null,
             payment_notes || null, me.full_name || me.username, todayVN(), voucher]
          );
          const note = `[Thanh toán ${payment_date || todayVN()}: +${a.amount.toLocaleString("vi-VN", { maximumFractionDigits: 0 })} đ (${payment_method || "CK"}) - Phiếu chi ${voucher}${reference_doc ? ` - UNC: ${reference_doc}` : ""}]`;
          await c.query(
            `UPDATE procurement_orders SET amount_paid = amount_paid + $1, payment_status = NULL, notes = CONCAT_WS(' | ', NULLIF(notes, ''), $2::text), version = COALESCE(version, 0) + 1 WHERE id = $3`,
            [a.amount, note, a.po_id]
          );
        }
        return { duplicate: false, voucher, rows };
      });
      if (!result.duplicate) {
        const sum = alloc.reduce((s: number, a: any) => s + a.amount, 0);
        await logAudit("PAYMENT", "PROCUREMENT", `Phiếu chi ${result.voucher}: ${sum.toLocaleString("vi-VN", { maximumFractionDigits: 0 })} đ cho ${alloc.length} PO (${result.rows.map((r: any) => r.po_code).join(", ")})`);
      }
      return NextResponse.json({ success: true, voucher_code: result.voucher, duplicate: result.duplicate });
    }

    // Nhập / sửa số hóa đơn & ngày hóa đơn đầu vào của PO ngay trên danh sách PO (Cung ứng / Kế toán)
    if (action === "update_supplier_invoices") {
      if (!canWriteProcurement(me) && !canRecordSupplierPayment(me)) {
        return forbiddenResponse("Bạn không có quyền cập nhật hóa đơn đầu vào của PO.");
      }
      const poId = Number(body.po_id);
      if (!Number.isInteger(poId) || poId <= 0) throw new HttpError(400, "Thiếu PO");
      const list = (Array.isArray(body.invoices) ? body.invoices : [])
        .map((x: any) => ({
          invoice_no: String(x?.invoice_no || "").trim().slice(0, 100),
          invoice_date: /^\d{4}-\d{2}-\d{2}$/.test(String(x?.invoice_date || "")) ? String(x.invoice_date) : null,
          inbound_code: x?.inbound_code ? String(x.inbound_code).slice(0, 100) : undefined
        }))
        .filter((x: any) => x.invoice_no);
      const before = (await query("SELECT po_code, supplier_invoices FROM procurement_orders WHERE id = $1", [poId])).rows[0];
      if (!before) throw new HttpError(404, "Không tìm thấy PO");
      await query("UPDATE procurement_orders SET supplier_invoices = $1::jsonb, version = COALESCE(version, 0) + 1 WHERE id = $2", [JSON.stringify(list), poId]);
      const fmt = (arr: any) => (Array.isArray(arr) ? arr : []).map((x: any) => `${x.invoice_no}${x.invoice_date ? ` (${x.invoice_date})` : ""}`).join(", ") || "—";
      await logAudit("UPDATE", "PROCUREMENT", `Cập nhật HĐ đầu vào PO ${before.po_code}: ${fmt(before.supplier_invoices)} -> ${fmt(list)}`);
      return NextResponse.json({ success: true, supplier_invoices: list });
    }

    // Hủy khoản chi ghi nhầm: giữ lại trong sổ (đánh dấu hủy), trừ lại số đã trả của PO. "Sửa" = hủy rồi ghi khoản mới.
    if (action === "void_payment") {
      const pid = Number(body.payment_id);
      const reason = String(body.reason || "").trim();
      if (!Number.isInteger(pid) || pid <= 0) throw new HttpError(400, "Thiếu khoản chi cần hủy");
      if (!reason) throw new HttpError(400, "Nhập lý do hủy khoản chi");
      const r = await withTransaction(async (c) => {
        const pay = (await c.query("SELECT id, po_id, amount, voided_at, payment_date FROM procurement_payments WHERE id = $1 FOR UPDATE", [pid])).rows[0];
        if (!pay) throw new HttpError(404, "Không tìm thấy khoản chi");
        if (pay.voided_at) throw new HttpError(409, "Khoản chi này đã được hủy trước đó");
        const po = (await c.query("SELECT id, po_code, amount_paid FROM procurement_orders WHERE id = $1 FOR UPDATE", [pay.po_id])).rows[0];
        await c.query("UPDATE procurement_payments SET voided_at = now(), voided_by = $1, void_reason = $2 WHERE id = $3", [me.full_name || me.username, reason.slice(0, 500), pid]);
        const amt = Number(pay.amount) || 0;
        await c.query(
          `UPDATE procurement_orders SET amount_paid = GREATEST(0, amount_paid - $1), payment_status = NULL, notes = CONCAT_WS(' | ', NULLIF(notes, ''), $2::text), version = COALESCE(version, 0) + 1 WHERE id = $3`,
          [amt, `[Hủy khoản chi ${amt.toLocaleString("vi-VN", { maximumFractionDigits: 0 })} đ: ${reason.slice(0, 200)}]`, pay.po_id]
        );
        return { po_code: po?.po_code, amount: amt };
      });
      await logAudit("VOID_PAYMENT", "PROCUREMENT", `Hủy khoản chi ${r.amount.toLocaleString("vi-VN", { maximumFractionDigits: 0 })} đ của PO ${r.po_code}: ${reason}`);
      return NextResponse.json({ success: true });
    }

    if (action === "record_payment") {
      const { po_id, po_code, payment_amount, payment_method, reference_doc, payment_date, payment_notes, request_id } = body;
      const amount = Number(payment_amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        throw new HttpError(400, "Số tiền thanh toán không hợp lệ (phải là số dương > 0)");
      }
      const reqId = request_id || `${po_id}_${reference_doc || "PAY"}_${amount}_${payment_date || ""}_${Date.now()}`;
      const noteEntry = `[Thanh toán ${payment_date || todayVN()}: +${amount.toLocaleString('vi-VN', { maximumFractionDigits: 0 })} đ (${payment_method || 'CK'}) - UNC: ${reference_doc || 'N/A'}]`;

      const result = await withTransaction(async (c) => {
        const orderRes = await c.query(
          "SELECT id, total_amount, amount_paid, notes FROM procurement_orders WHERE id = $1 FOR UPDATE",
          [po_id]
        );
        if (orderRes.rows.length === 0) {
          throw new HttpError(404, "Không tìm thấy đơn PO");
        }
        const order = orderRes.rows[0];

        // Idempotency: ledger insert
        const ins = await c.query(
          `INSERT INTO procurement_payments (po_id, request_id, amount, method, reference_doc, payment_date, notes)
           VALUES ($1, $2, $3, $4, $5, COALESCE($6::date, $8::date), $7)
           ON CONFLICT (po_id, request_id) DO NOTHING RETURNING id`,
          [po_id, reqId, amount, payment_method || "CK", reference_doc || null, payment_date || null, payment_notes || null, todayVN()]
        );

        if (ins.rowCount === 0) {
          return { duplicate: true, amount_paid: Number(order.amount_paid) };
        }

        const remaining = Number(order.total_amount) - Number(order.amount_paid);
        if (amount > remaining + 0.5) {
          throw new HttpError(400, `Số tiền thanh toán (${amount.toLocaleString('vi-VN', { maximumFractionDigits: 0 })} đ) vượt công nợ còn lại (${remaining.toLocaleString('vi-VN', { maximumFractionDigits: 0 })} đ) của đơn PO`);
        }

        const upd = await c.query(
          `UPDATE procurement_orders 
           SET amount_paid = amount_paid + $1,
               payment_status = NULL, -- tính lại từ số đã trả (cờ cũ như "PAID" không còn đúng)
               notes = CONCAT_WS(' | ', NULLIF(notes, ''), $2::text),
               version = COALESCE(version, 0) + 1
           WHERE id = $3 RETURNING amount_paid`,
          [amount, noteEntry, po_id]
        );
        return { duplicate: false, amount_paid: Number(upd.rows[0].amount_paid) };
      });

      if (!result.duplicate) {
        await logAudit(
          "PAYMENT",
          "PROCUREMENT",
          `Ghi nhận thanh toán ${amount.toLocaleString('vi-VN', { maximumFractionDigits: 0 })} đ cho đơn PO ${po_code || po_id} (${payment_method || 'CK'})`
        );
      }
      return NextResponse.json({ success: true, new_amount_paid: result.amount_paid, duplicate: result.duplicate });
    }

    // 7. Receive PO to Inventory: one goods receipt (PNK) per delivery. Every line carries the real lot number and
    //    expiry date; a PO can be received in several deliveries (PARTIALLY_RECEIVED) until every line is complete.
    if (action === "receive_to_inventory") {
      const {
        po_id,
        po_code,
        lines,
        received_by,
        receipt_date,
        warehouse_name,
        vat_invoice_no,
        shipping_unit,
        inbound_type,
        receipt_notes,
        request_id
      } = body;
      if (!Array.isArray(lines) || lines.length === 0) {
        throw new HttpError(400, "Nhập kho PO cần khai báo từng dòng hàng thực nhận: số lô, hạn dùng và số lượng. Vui lòng nhập kho tại màn hình Cung ứng → Đơn PO → Nhập kho.");
      }

      const result = await withTransaction(async (c) => {
        const poRes = await c.query(
          `SELECT * FROM procurement_orders
           WHERE ($1::int IS NOT NULL AND id = $1) OR ($1::int IS NULL AND po_code = $2)
           FOR UPDATE`,
          [po_id ?? null, po_code ?? null]
        );
        const po = poRes.rows[0];
        if (!po) throw new HttpError(404, "Không tìm thấy đơn PO");
        if (po.status === "CANCELLED") throw new HttpError(409, "Đơn PO đã bị huỷ, không thể nhập kho");
        if (po.status === "COMPLETED") throw new HttpError(409, `Đơn PO ${po.po_code} đã nhập kho đủ.`);
        if (["DRAFT", "PENDING"].includes(String(po.status || "").toUpperCase())) {
          throw new HttpError(409, `Đơn PO ${po.po_code} chưa được duyệt / xác nhận. Cần Trưởng bộ phận Cung ứng hoặc Ban Giám Đốc xác nhận PO trước khi nhập kho.`);
        }

        // Same submission sent twice (double click / retry): return the receipt already made
        if (request_id) {
          const dup = await c.query(
            `SELECT transaction_code FROM inventory_transactions WHERE transaction_type = 'INBOUND' AND reference_code = $1 AND notes LIKE $2 LIMIT 1`,
            [po.po_code, `%[req:${String(request_id).slice(0, 60)}]%`]
          );
          if (dup.rows[0]) return { already: true, inbound_code: dup.rows[0].transaction_code, po, status: po.status };
        }

        let poItems = po.items;
        if (typeof poItems === "string") {
          try { poItems = JSON.parse(poItems); } catch { poItems = []; }
        }
        if (!Array.isArray(poItems)) poItems = [];
        const received: Record<string, number> = { ...(po.received_qty || {}) };

        // validate every receipt line against the PO line it belongs to
        const thisReceipt: Record<string, number> = {};
        const pMasterTemp: Record<string, string> = {};
        const clean: any[] = [];
        // Dòng gửi lên không có số dòng PO (phiếu nhập kho lập ở phân hệ Kho): tìm dòng PO cùng mã hàng còn thiếu
        const autoPlanned: Record<number, number> = {};
        const resolveLineIndex = (ln: any): number => {
          const raw = ln?.line_index;
          if (raw !== undefined && raw !== null && raw !== "" && Number.isInteger(Number(raw)) && Number(raw) >= 0) return Number(raw);
          const code = String(ln?.product_code || ln?.productCode || "").trim().toUpperCase();
          if (!code) return -1;
          const cands = poItems.map((_: any, i: number) => i).filter((i: number) => String(poItems[i]?.product_code || "").trim().toUpperCase() === code);
          if (cands.length === 0) return -1;
          const q = Number(ln?.quantity) || 0;
          const pick = cands.find((i: number) => (Number(poItems[i]?.quantity) || 0) - (Number(received[i]) || 0) - (autoPlanned[i] || 0) >= q)
            ?? cands.find((i: number) => (Number(poItems[i]?.quantity) || 0) - (Number(received[i]) || 0) - (autoPlanned[i] || 0) > 0)
            ?? cands[0];
          autoPlanned[pick] = (autoPlanned[pick] || 0) + q;
          return pick;
        };
        if (!String(receipt_date || "").trim()) {
          throw new HttpError(400, "Vui lòng nhập Ngày Nhập Kho (*).");
        }
        if (!String(warehouse_name || "").trim()) {
          throw new HttpError(400, "Vui lòng chọn Kho Tiếp Nhận (*).");
        }
        if (!String(received_by || me.full_name || me.username || "").trim()) {
          throw new HttpError(400, "Vui lòng nhập Thủ Kho / Người Tiếp Nhận (*).");
        }
        let poPriceUpdated = false;
        for (const ln of lines) {
          const idx = resolveLineIndex(ln);
          const poIt = Number.isInteger(idx) && idx >= 0 ? poItems[idx] : undefined;
          const fallbackIt = poIt || {
            product_code: ln?.product_code || ln?.productCode || "",
            product_name: ln?.product_name || ln?.productName || ln?.product_code || "Hàng phát sinh theo PO",
            specification: ln?.specification || "",
            unit: ln?.unit || "Hộp",
            unit_price: Number(ln?.unit_price) || 0,
            storage_condition: ln?.storage_condition || "",
            shelf_position: ln?.shelf_position || ""
          };
          const qty = Number(ln.quantity) || 0;
          if (qty <= 0) continue;
          const pCode = String(fallbackIt.product_code || fallbackIt.productCode || "").trim();
          if (!pCode) throw new HttpError(400, "Dòng nhập kho phát sinh chưa có Mã hàng (SKU) (*).");
          // nhiệt độ bảo quản: lô khai báo -> dòng PO -> danh mục sản phẩm; không tự điền
          if (pCode && !(pCode in pMasterTemp)) pMasterTemp[pCode] = (await c.query("SELECT storage_condition FROM products WHERE code = $1", [pCode])).rows[0]?.storage_condition || "";
          const lot = String(ln.lot_number || "").trim();
          const expiry = String(ln.expiry_date || "").trim();
          const mfgDate = String(ln.manufacture_date || "").trim();
          if (!lot) throw new HttpError(400, `Mã hàng ${pCode}: chưa nhập Số Lô (LOT) (*).`);
          if (!expiry && !ln.no_expiry) throw new HttpError(400, `Mã hàng ${pCode} (lô ${lot}): chưa nhập Hạn dùng (EXP) (*) (hoặc đánh dấu "Không có HSD" với thiết bị / vật tư).`);
          if (expiry && !/^\d{4}-\d{2}-\d{2}$/.test(expiry)) throw new HttpError(400, `Mã hàng ${pCode}: hạn dùng không hợp lệ.`);
          const resolvedUnitPrice = Number(ln.unit_price ?? fallbackIt.unit_price) || 0;
          if (!(resolvedUnitPrice > 0)) {
            throw new HttpError(400, `Mã hàng ${pCode} (lô ${lot}): chưa nhập Đơn Giá Nhập (> 0 VNĐ) (*).`);
          }
          const resolvedStorageCond = String(ln.storage_condition || fallbackIt.storage_condition || pMasterTemp[pCode] || "").trim();
          if (!resolvedStorageCond) {
            throw new HttpError(400, `Mã hàng ${pCode} (lô ${lot}): chưa chọn Điều Kiện Bảo Quản (*).`);
          }
          if (Number.isInteger(idx) && idx >= 0 && poIt) {
            thisReceipt[idx] = (thisReceipt[idx] || 0) + qty;
            if (resolvedUnitPrice > 0 && Number(poIt.unit_price) !== resolvedUnitPrice) {
              const r3 = (v: any) => Math.round((Number(v) || 0) * 1000) / 1000;
              const pQty = Number(poIt.quantity) || 0;
              const pPrice = r3(resolvedUnitPrice);
              const pSub = r3(pQty * pPrice);
              const pVatRate = Math.max(0, Number(poIt.vat_rate ?? poIt.tax_rate ?? 0) || 0);
              const pVatAmt = r3((pSub * pVatRate) / 100);
              poIt.unit_price = pPrice;
              poIt.subtotal = pSub;
              poIt.vat_rate = pVatRate;
              poIt.vat_amount = pVatAmt;
              poIt.total_after_vat = r3(pSub + pVatAmt);
              poIt.total = r3(pSub + pVatAmt);
              poPriceUpdated = true;
            }
          }
          clean.push({
            idx: Number.isInteger(idx) && idx >= 0 && poIt ? idx : -1,
            poIt: fallbackIt,
            pCode,
            qty,
            lot,
            expiry: expiry || null,
            manufacture_date: mfgDate || null,
            specification: String(ln.specification || fallbackIt.specification || "").trim(),
            unit: String(ln.unit || fallbackIt.unit || "Hộp").trim(),
            unit_price: resolvedUnitPrice,
            storage_condition: resolvedStorageCond,
            shelf_position: String(ln.shelf_position || fallbackIt.shelf_position || "").trim(),
            qc_status: String(ln.qc_status || "Đạt chuẩn 100% (Nguyên niêm phong & COA)").trim(),
            notes: String(ln.notes || "").trim()
          });
        }
        if (clean.length === 0) throw new HttpError(400, "Chưa có dòng nào có số lượng thực nhận > 0.");
        if (!body.allow_over_delivery) {
          for (const [k, q] of Object.entries(thisReceipt)) {
            const ordered = Number(poItems[Number(k)]?.quantity) || 0;
            const before = Number(received[k]) || 0;
            if (before + q > ordered) {
              throw new HttpError(409, `Dòng ${Number(k) + 1} (${poItems[Number(k)]?.product_code}): đặt ${ordered}, đã nhập ${before}, lần này ${q} — vượt số lượng đặt.`);
            }
          }
        }

        const targetWarehouse = String(warehouse_name || "Kho Trung Tâm").trim() || "Kho Trung Tâm";
        const effectiveDate = receipt_date && /^\d{4}-\d{2}-\d{2}$/.test(String(receipt_date)) ? String(receipt_date) : todayVN();
        const effectivePerformer = String(received_by || me.full_name || me.username || "Thủ kho ABT").trim();

        const inboundCode = await generateDocumentCode({ docType: "PNK", tagMode: "GENERAL" });
        const txItems = clean.map(x => ({
          line_index: x.idx,
          product_code: x.pCode,
          product_name: x.poIt.product_name || x.pCode,
          supplier_name: po.supplier_name || undefined,
          vat_invoice_no: vat_invoice_no ? String(vat_invoice_no).trim() : undefined,
          shipping_unit: shipping_unit ? String(shipping_unit).trim() : undefined,
          inbound_type: inbound_type ? String(inbound_type).trim() : "Nhập mua hàng theo Đơn PO từ NCC",
          specification: x.specification || undefined,
          unit: x.unit || "Hộp",
          quantity: x.qty,
          unit_price: x.unit_price,
          cost_price: x.unit_price,
          lot_number: x.lot,
          expiry_date: x.expiry,
          manufacture_date: x.manufacture_date || undefined,
          storage_condition: x.storage_condition || undefined,
          shelf_position: x.shelf_position || undefined,
          qc_status: x.qc_status || undefined,
          notes: x.notes || undefined
        }));

        const noteParts = [
          `Nhập kho theo PO ${po.po_code}`,
          po.supplier_name ? `NCC: ${po.supplier_name}` : "",
          vat_invoice_no ? `HĐ/Tờ khai: ${String(vat_invoice_no).trim()}` : "",
          shipping_unit ? `Vận chuyển: ${String(shipping_unit).trim()}` : "",
          inbound_type ? `Loại hình: ${String(inbound_type).trim()}` : "",
          receipt_notes ? String(receipt_notes).slice(0, 500) : ""
        ].filter(Boolean);

        await c.query(
          `INSERT INTO inventory_transactions (transaction_code, transaction_type, reference_code, date, performed_by, warehouse_name, items, notes)
           VALUES ($1, 'INBOUND', $2, $3, $4, $5, $6, $7)`,
          [
            inboundCode,
            po.po_code,
            effectiveDate,
            effectivePerformer,
            targetWarehouse,
            JSON.stringify(sortByProductCode(txItems, (it: any) => it.product_code)),
            `${noteParts.join(" • ")}${request_id ? ` [req:${String(request_id).slice(0, 60)}]` : ""}`
          ]
        );

        for (const x of sortByProductCode(clean, (it: any) => it.pCode)) {
          const it = x.poIt;
          const pName = String(it.product_name || it.name || x.pCode).replace(/^\[[A-Z]{2}\d{2}-[^\]]+\]\s*/, "").trim();
          const uPrice = Number(x.unit_price || it.unit_price || it.cost_price || 0);

          const { id: prodId } = await ensureProduct(c, {
            code: x.pCode,
            name: pName,
            category: it.category || "Hàng Thương Mại Mua Ngoài",
            unit: x.unit || it.unit || "Hộp",
            specification: x.specification || it.specification || "",
            standard_price: 0,
            cost_price: uPrice,
            manufacturer: po.supplier_name || it.supplier_name || "Nhà Cung Cấp Phân Phối",
            origin: it.origin || "Chính hãng",
            min_stock_level: 10,
            storage_condition: x.storage_condition || it.storage_condition || null
          });

          await addStock(c, {
            productCode: x.pCode,
            productName: pName,
            productId: prodId,
            qty: x.qty,
            lotNumber: x.lot,
            expiryDate: x.expiry,
            location: it.warehouse_location || targetWarehouse,
            shelf: x.shelf_position || it.shelf_position || undefined,
            unitCost: uPrice
          });

          // Hold the received goods for the customer order the line was bought for (never more than it still needs)
          await reserveReceiptForSalesOrder(c, po, it, { pCode: x.pCode, pName, qty: x.qty, lot: x.lot }, inboundCode);

          await appendCommercialCatalogEntry(c, {
            code: x.pCode,
            name: pName,
            category: it.category || "Hàng Thương Mại",
            brand: po.supplier_name || it.supplier_name || "ABT Phân Phối",
            origin: it.origin || "Chính hãng",
            unit: x.unit || it.unit || "Hộp",
            specification: x.specification || it.specification || "",
            costPrice: uPrice,
            price: 0,
            priceDealer1: 0,
            priceDealer2: 0,
            storageCondition: x.storage_condition || it.storage_condition || "",
            leadTime: "Có sẵn kho",
            notes: `Tự động tạo từ Nhập kho PO ${po.po_code}`
          });
        }

        for (const [k, q] of Object.entries(thisReceipt)) received[k] = (Number(received[k]) || 0) + q;
        const allDone = poItems.every((it: any, i: number) => (Number(it?.quantity) || 0) <= 0 || (Number(received[i]) || 0) >= (Number(it.quantity) || 0));
        const newStatus = allDone ? "COMPLETED" : "PARTIALLY_RECEIVED";
        const computedPoTotal = Math.round(poItems.reduce((sum: number, it: any) => {
          const r3 = (v: any) => Math.round((Number(v) || 0) * 1000) / 1000;
          const sub = r3((Number(it?.quantity) || 0) * r3(it?.unit_price));
          const vr = Math.max(0, Number(it?.vat_rate ?? it?.tax_rate ?? 0) || 0);
          return sum + sub + r3((sub * vr) / 100);
        }, 0) * 1000) / 1000;
        const newPoTotalAmount = poPriceUpdated || computedPoTotal > 0 ? computedPoTotal : (Number(po.total_amount) || 0);
        await c.query(
          `UPDATE procurement_orders
              SET status = $1, received_qty = $2::jsonb,
                  inbound_transaction_code = COALESCE(inbound_transaction_code, $3),
                  items = $5::jsonb,
                  total_amount = $6,
                  version = COALESCE(version, 0) + 1
            WHERE id = $4`,
          [newStatus, JSON.stringify(received), inboundCode, po.id, JSON.stringify(poItems), newPoTotalAmount]
        );
        // Đồng bộ bảng giá NCC và các PO khác đang để giá 0đ của cùng mã hàng
        await syncInboundPricesToPOs(
          c,
          clean.map((x: any) => ({
            product_code: x.pCode,
            product_name: x.poIt?.product_name || x.pCode,
            specification: x.specification || "",
            unit: x.unit || "Hộp",
            quantity: x.qty,
            unit_price: x.unit_price,
            cost_price: x.unit_price,
          })),
          {
            reference_code: po.po_code,
            transaction_code: inboundCode,
            supplier_name: po.supplier_name || "",
            vat_invoice_no: vat_invoice_no ? String(vat_invoice_no).trim() : "",
            invoice_date: effectiveDate,
            is_new_inbound: false,
          }
        );
        // Hóa đơn đầu vào của đợt nhận hàng này: lưu thành dòng riêng trên PO để hiện cột / lọc theo số HĐ
        const invNo = String(vat_invoice_no || "").trim();
        if (invNo) {
          const invDate = body.vat_invoice_date ? String(body.vat_invoice_date).slice(0, 10) : todayVN();
          await c.query(
            `UPDATE procurement_orders
                SET supplier_invoices = COALESCE(supplier_invoices, '[]'::jsonb) || $1::jsonb
              WHERE id = $2`,
            [JSON.stringify([{ invoice_no: invNo.slice(0, 100), invoice_date: invDate, inbound_code: inboundCode }]), po.id]
          );
        }

        if (newStatus === "COMPLETED") {
          const prCodes = Array.from(new Set([
            ...poItems.map((x: any) => String(x?.source_pr_code || "")).filter(Boolean),
            ...(Array.isArray(po.pr_ids) ? po.pr_ids.map((x: any) => String(x || "")).filter(Boolean) : [])
          ]));
          // Chỉ đánh dấu sales_orders.procure_status = 'RECEIVED' khi tất cả các PO thuộc cùng PR đều đã COMPLETED
          const pendingOtherPOs = prCodes.length > 0
            ? await c.query(
                `SELECT COUNT(*)::int AS cnt FROM procurement_orders
                  WHERE id <> $1
                    AND status NOT IN ('COMPLETED', 'Received', 'DELIVERED', 'CANCELLED')
                    AND EXISTS (
                      SELECT 1 FROM jsonb_array_elements(COALESCE(items, '[]'::jsonb)) elem
                      WHERE elem->>'source_pr_code' = ANY($2::text[])
                    )`,
                [po.id, prCodes]
              )
            : { rows: [{ cnt: 0 }] };
          if ((pendingOtherPOs.rows[0]?.cnt || 0) === 0) {
            await c.query(
              `UPDATE sales_orders SET procure_status = 'RECEIVED'
                WHERE procure_order_code = $1 OR pr_code = ANY($2::text[])`,
              [po.po_code, prCodes]
            );
          }
        }
        return { already: false, inbound_code: inboundCode, po, status: newStatus };
      });

      if (!result.already) {
        await logAudit("RECEIVE_PO", "PROCUREMENT", `Nhập kho PO ${result.po.po_code} -> Phiếu nhập ${result.inbound_code} (${result.status === "COMPLETED" ? "đã nhập đủ" : "nhập 1 phần"})`);
      }
      return NextResponse.json({ success: true, inbound_code: result.inbound_code, status: result.status, already_received: result.already });
    }

    // 8. Create or Update Purchase Request (PR)
    if (action === "create_pr" || action === "update_pr") {
      const { id: prId, workflow_code, title, priority, requester_name, requester_dept, product_info, due_date, description, items, customer_name, is_stock } = body;
      
      const isStockOrder = is_stock || customer_name === "STOCK" || String(customer_name || "").includes("Kho") || String(customer_name || "").includes("Lưu Kho") || String(workflow_code || "").includes("STOCK") || String(title || "").includes("STOCK");
      
      const actualLoggedUser = me.full_name || me.username || "";
      const cleanRequesterName = String(
        requester_name || actualLoggedUser || (isStockOrder ? "Bộ Phận Kho Vận" : "Phòng Kinh Doanh")
      ).trim();
      const cleanRequesterDept = String(
        requester_dept || me.department || (isStockOrder ? "Kho Vận" : "Kinh Doanh")
      ).trim();

      let code = workflow_code && typeof workflow_code === "string" && /^PR\d{2}-/.test(workflow_code.trim())
        ? workflow_code.trim()
        : await generateDocumentCode({
            docType: "PR",
            customerName: customer_name,
            customPrefix: isStockOrder ? "STOCK" : "ABT",
            tagMode: isStockOrder ? "STOCK" : (customer_name ? "CUSTOMER" : "GENERAL")
          });

      let structuredItems = Array.isArray(items) && items.length > 0 ? items : [];
      if (structuredItems.length === 0 && !String(product_info || "").trim()) {
        return NextResponse.json(
          { error: "Không thể tạo Đề xuất mua hàng (PR): Vui lòng chọn ít nhất 1 sản phẩm có Mã sản xuất (SKU) và Tên hàng cụ thể từ Bảng mã sản xuất!" },
          { status: 400 }
        );
      }
      for (let i = 0; i < structuredItems.length; i++) {
        const it = structuredItems[i];
        const codeStr = String(it?.product_code || "").trim();
        const nameStr = String(it?.product_name || "").trim();
        if (!codeStr || codeStr.toUpperCase() === "ABT-ITEM" || codeStr.toUpperCase() === "MÃ MỚI" || !nameStr) {
          return NextResponse.json(
            {
              error: `Không thể tạo Đề xuất mua hàng (PR): Mặt hàng ở dòng #${i + 1} chưa có Mã sản phẩm (SKU) hoặc Tên hàng cụ thể! Vui lòng chọn sản phẩm từ Bảng mã sản xuất.`
            },
            { status: 400 }
          );
        }
      }

      let summaryText = product_info || "";
      if (structuredItems.length > 0) {
        summaryText = structuredItems.map((it: any) => {
          const spec = it.specification ? ` (${it.specification})` : "";
          const customTag = it.is_custom ? " [Mặt hàng mới]" : "";
          return `${it.product_code || "MÃ MỚI"}: ${it.product_name}${spec} - SL: ${it.quantity} ${it.unit || "Cái"}${customTag}`;
        }).join(" | ");
      }

      // Check if PR already exists by id or workflow_code in workflow_requests
      const existing = prId
        ? await query("SELECT id, workflow_code, status, results_summary, logs FROM workflow_requests WHERE id = $1 OR workflow_code = $2", [Number(prId) || 0, code])
        : await query("SELECT id, workflow_code, status, results_summary, logs FROM workflow_requests WHERE workflow_code = $1", [code]);
      // Mã PR này đã bị hủy / từ chối: không sửa phiếu cũ (nó vẫn giữ trạng thái đã hủy) mà cấp mã mới, giữ phiếu cũ làm lịch sử
      if (existing.rows.length > 0 && ["CANCELLED", "REJECTED"].includes(String(existing.rows[0].status || "").toUpperCase())) {
        const base = String(existing.rows[0].workflow_code || code).replace(/-R\d+$/, "");
        let n = 1;
        while ((await query("SELECT 1 FROM workflow_requests WHERE workflow_code = $1", [`${base}-R${n}`])).rows.length > 0) n++;
        code = `${base}-R${n}`;
        existing.rows.length = 0;
      }
      if (existing.rows.length > 0) {
        const existingRow = existing.rows[0];
        code = existingRow.workflow_code || code;
        let oldItems: any[] = [];
        try {
          const rs = existingRow.results_summary;
          oldItems = Array.isArray(rs) ? rs : (typeof rs === "string" && rs.trim().startsWith("[") ? JSON.parse(rs) : []);
        } catch {}
        const converted = oldItems.filter((it: any) => it && it.po_code);
        if (converted.length > 0) {
          const byCode = new Map(converted.map((it: any) => [String(it.product_code || ""), it]));
          structuredItems = structuredItems.map((it: any) => {
            const prev: any = byCode.get(String(it.product_code || ""));
            return prev ? { ...it, po_code: prev.po_code, status: prev.status || "CONVERTED", quantity: Math.max(Number(it.quantity) || 0, Number(prev.quantity) || 0) } : it;
          });
          for (const it of converted) {
            if (!structuredItems.some((x: any) => String(x.product_code || "") === String(it.product_code || ""))) structuredItems.push(it);
          }
        }
        const open = structuredItems.filter((it: any) => !it.po_code).length;
        const newPrStatus = converted.length === 0 ? null : (open > 0 ? "PARTIAL_CONVERTED" : "CONVERTED");
        const logs = Array.isArray(existingRow.logs) ? existingRow.logs : [];
        logs.push({
          time: nowVNDateTime(),
          actor: me.full_name || me.username || cleanRequesterName,
          action: `Chỉnh sửa đề xuất mua hàng PR (${structuredItems.length} mặt hàng)`
        });
        await query(
          `UPDATE workflow_requests SET 
             title = COALESCE(NULLIF($8, ''), title),
             priority = COALESCE(NULLIF($9, ''), priority),
             description = COALESCE($10, description),
             customer_name = COALESCE(NULLIF($11, ''), customer_name),
             results_summary = $1, 
             product_info = COALESCE(NULLIF($2, ''), product_info),
             due_date = COALESCE(NULLIF($3, '')::date, due_date),
             requester_name = $4,
             requester_dept = $5,
             status = COALESCE($7, status),
             logs = $12,
             updated_at = CURRENT_TIMESTAMP
           WHERE id = $6`,
          [
            JSON.stringify(structuredItems),
            summaryText,
            due_date ? due_date.slice(0, 10) : null,
            cleanRequesterName,
            cleanRequesterDept,
            existingRow.id,
            newPrStatus,
            title || "",
            priority || "",
            description !== undefined ? description : null,
            customer_name || "",
            JSON.stringify(logs)
          ]
        );
        await logAudit("UPDATE_PR", "PROCUREMENT", `Cập nhật phiếu đề xuất mua hàng PR ${code}: ${title || ""}`);
        return NextResponse.json({ success: true, code, updated: true });
      }

      await query(
        `INSERT INTO workflow_requests (
          workflow_code, workflow_type, title, priority, status, requester_name, requester_dept,
          assignee_name, target_dept, customer_name, product_info, due_date, description,
          results_summary, attachments, comments, logs
        ) VALUES ($1, $2, $3, $4, 'PENDING', $5, $6, '', 'Cung Ứng', $7, $8, $9, $10, $11, '[]'::json, '[]'::json, $12)`,
        [
          code,
          "SALES_TO_PROCUREMENT",
          title || "Đề xuất mua hàng bổ sung",
          priority || "MEDIUM",
          cleanRequesterName,
          cleanRequesterDept,
          customer_name || "Dự trữ kho & Cung ứng",
          summaryText,
          due_date || todayVN(),
          description || "",
          JSON.stringify(structuredItems),
          JSON.stringify([{ time: nowVNDateTime(), actor: cleanRequesterName, action: "Khởi tạo đề xuất mua hàng PR" }])
        ]
      );
      await logAudit("CREATE_PR", "PROCUREMENT", `Tạo phiếu đề xuất mua hàng PR ${code}: ${title}`);
      if (structuredItems.length > 0) {
        try {
          const soCodes = Array.from(
            new Set(
              structuredItems
                .map((it: any) => String(it?.source_so_code || it?.so_code || "").trim())
                .filter(Boolean)
            )
          ).join(", ");
          await withFactoryTx((tx) =>
            syncKdOrderOrPoToInternalOrder(tx, {
              kd_po_code: code,
              kd_so_code: soCodes || code,
              customer_name: customer_name || "Khối Kinh doanh ABT",
              requested_date: due_date || todayVN(),
              notes: description || title || `Đồng bộ tự động từ Đặt hàng Hãng / PR ${code}`,
              items: structuredItems,
            })
          );
        } catch (syncPrErr: any) {
          console.error("[AUTO_SYNC_PR_TO_INTERNAL_ORDER_ERR]:", syncPrErr?.message || syncPrErr);
        }
      }
      return NextResponse.json({ success: true, code });
    }

    // 9. Update PR Status (with optimistic row-lock and line-item po_code tracking - H3)
    if (action === "update_pr_status") {
      const { id, status, note, po_code, converted_indices } = body;
      const actor = me.full_name || me.username;
      const upperReqStatus = String(status || "COMPLETED").toUpperCase();
      // Duyệt / từ chối PR cần quyền phê duyệt hoặc quyền ghi Cung ứng; hủy PR (CANCELLED) cho phép nhân sự Cung ứng / người tạo
      if (!po_code && ["APPROVED", "REJECTED", "COMPLETED"].includes(upperReqStatus) && !canApprovePO(me) && !canWriteProcurement(me)) {
        return forbiddenResponse("Chỉ bộ phận Cung ứng / Ban Giám Đốc mới được duyệt hoặc kết thúc đề xuất mua hàng (PR).");
      }
      if (po_code && !canApprovePO(me) && !hasPermission(me, "procurement.view")) {
        return forbiddenResponse("Bạn không có quyền chuyển đề xuất mua hàng thành đơn PO.");
      }
      const targetStatus = await withTransaction(async (c) => {
        const prRes = await c.query("SELECT * FROM workflow_requests WHERE id = $1 FOR UPDATE", [id]);
        if (prRes.rows.length === 0) {
          throw new HttpError(404, "Không tìm thấy đề xuất");
        }
        const pr = prRes.rows[0];
        const logs = Array.isArray(pr.logs) ? pr.logs : [];

        let parsedItems: any[] = [];
        try {
          if (typeof pr.results_summary === "string" && pr.results_summary.trim().startsWith("[")) {
            parsedItems = JSON.parse(pr.results_summary);
          } else if (Array.isArray(pr.results_summary)) {
            parsedItems = pr.results_summary;
          }
        } catch {}

        let computedStatus = status || "COMPLETED";
        const isDropping = !po_code && ["CANCELLED", "REJECTED"].includes(upperReqStatus);
        if (isDropping && parsedItems.some((it: any) => it?.po_code)) {
          throw new HttpError(409, `PR ${pr.workflow_code || id} đã có mặt hàng lên PO (${Array.from(new Set(parsedItems.filter((it: any) => it?.po_code).map((it: any) => it.po_code))).join(", ")}): hủy / điều chỉnh PO trước.`);
        }
        if (po_code && parsedItems.length > 0) {
          parsedItems.forEach((it: any, idx: number) => {
            if (!converted_indices || converted_indices.includes(idx)) {
              if (it.po_code && it.po_code !== po_code) {
                throw new HttpError(409, `Mặt hàng "${it.product_name || it.product_code}" đã được gắn với đơn PO ${it.po_code}!`);
              }
              it.po_code = po_code;
              it.status = "CONVERTED";
            }
          });
          const remaining = parsedItems.filter((it: any) => !it.po_code);
          computedStatus = remaining.length > 0 ? "PARTIAL_CONVERTED" : "CONVERTED";
        }

        logs.push({
          time: nowVNDateTime(),
          actor: actor || "Quản trị Cung Ứng",
          action: note || `Chuyển trạng thái sang [${computedStatus}]${po_code ? ` (Đơn PO: ${po_code})` : ''}`
        });

        await c.query(
          "UPDATE workflow_requests SET status = $1, results_summary = $2, logs = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $4",
          [computedStatus, parsedItems.length > 0 ? JSON.stringify(parsedItems) : pr.results_summary, JSON.stringify(logs), id]
        );
        // PR bị hủy / từ chối: gỡ liên kết khỏi đơn bán để Kinh doanh lập PR mới (trước đây đơn vẫn "Đã gửi PR / Chờ gom PO")
        if (isDropping && pr.workflow_code) {
          await c.query(
            `UPDATE sales_orders SET pr_code = NULL, procure_status = NULL
              WHERE pr_code = $1 AND COALESCE(procure_status, '') NOT IN ('ORDERED', 'RECEIVED', 'COMPLETED')`,
            [pr.workflow_code]
          );
        }
        return computedStatus;
      });

      await logAudit("UPDATE_PR", "PROCUREMENT", `Cập nhật trạng thái PR #${id} thành ${targetStatus}${po_code ? ` (PO: ${po_code})` : ''}`);
      return NextResponse.json({ success: true, status: targetStatus });
    }

    // 10. Consolidate Multiple PRs into a Unified PO (Requirement 4 - H3)
    // Bổ sung dòng PR vào một PO sẵn có (cùng NCC, CHƯA đặt hàng: Chờ xác nhận / Đã xác nhận)
    if (action === "append_prs_to_po") {
      const { po_id, supplier_id, pr_ids, selected_item_keys, items, created_by } = body;
      if (!Array.isArray(items) || items.length === 0) throw new HttpError(400, "Chưa chọn dòng hàng để bổ sung vào PO.");
      if (!Array.isArray(selected_item_keys) || selected_item_keys.length === 0) throw new HttpError(400, "Chưa chọn dòng PR.");
      for (const it of items) {
        const q = Number(it?.quantity), pr = Number(it?.unit_price ?? 0);
        if (!String(it?.product_code || "").trim()) throw new HttpError(400, "Có dòng hàng thiếu mã hàng.");
        if (!Number.isFinite(q) || q <= 0) throw new HttpError(400, `Mã ${it.product_code}: số lượng phải lớn hơn 0.`);
        if (!Number.isFinite(pr) || pr < 0) throw new HttpError(400, `Mã ${it.product_code}: đơn giá không hợp lệ.`);
      }
      const actor = String(created_by || me.full_name || me.username || "Phòng Cung Ứng").trim();
      const APPENDABLE = ["DRAFT", "PENDING", "APPROVED", "CONFIRMED"];
      const lineKey = (x: any) => [x?.product_code, x?.unit, x?.specification].map((v: any) => String(v || "").trim().toLowerCase()).join("|");
      const splitCodes = (v: any) => String(v || "").split(/[,;]\s*/).map((x: string) => x.trim()).filter(Boolean);

      const result = await withTransaction(async (c) => {
        const poRes = await c.query("SELECT id, po_code, supplier_id, supplier_name, status, items FROM procurement_orders WHERE id = $1 FOR UPDATE", [Number(po_id) || 0]);
        const po = poRes.rows[0];
        if (!po) throw new HttpError(404, "Không tìm thấy PO cần bổ sung.");
        const st = String(po.status || "").toUpperCase();
        if (!APPENDABLE.includes(st)) {
          throw new HttpError(409, `PO ${po.po_code} đã chuyển sang "${po.status}" (đã đặt hàng / đang xử lý), không bổ sung được. Hãy lập PO mới.`);
        }
        if (supplier_id !== undefined && supplier_id !== null && String(po.supplier_id) !== String(supplier_id)) {
          throw new HttpError(409, `PO ${po.po_code} thuộc NCC khác (${po.supplier_name}).`);
        }
        const poItems: any[] = Array.isArray(po.items) ? po.items : (typeof po.items === "string" ? (() => { try { return JSON.parse(po.items) || []; } catch { return []; } })() : []);
        let merged = 0, added = 0;
        for (const it of items) {
          const q = Number(it.quantity) || 0;
          const price = Number(it.unit_price) || 0;
          const target = poItems.find((x: any) => lineKey(x) === lineKey(it));
          if (target) {
            target.quantity = (Number(target.quantity) || 0) + q;
            if (!(Number(target.unit_price) > 0) && price > 0) target.unit_price = price;
            if (target.total !== undefined) target.total = (Number(target.quantity) || 0) * (Number(target.unit_price) || 0);
            target.source_pr_code = Array.from(new Set([...splitCodes(target.source_pr_code), ...splitCodes(it.source_pr_code)])).join(", ");
            merged++;
          } else {
            poItems.push({
              product_code: it.product_code,
              product_name: it.product_name,
              specification: it.specification || "",
              unit: it.unit || "Hộp",
              quantity: q,
              unit_price: price,
              total: q * price,
              notes: it.notes || "",
              source_pr_code: it.source_pr_code || "",
            });
            added++;
          }
        }
        const totalAmount = poItems.reduce((s: number, x: any) => {
          const sub = Math.round((Number(x.quantity) || 0) * (Number(x.unit_price) || 0));
          const vr = Math.max(0, Number(x?.vat_rate ?? x?.tax_rate ?? 0) || 0);
          return s + sub + Math.round((sub * vr) / 100);
        }, 0);

        // Dòng PR được chọn: gắn mã PO
        const codesIn = (pr_ids || []).map((x: any) => String(x).trim()).filter(Boolean);
        const prs = await c.query(
          `SELECT id, workflow_code, status, results_summary, logs FROM workflow_requests
            WHERE workflow_code = ANY($1::text[]) OR id::text = ANY($1::text[]) ORDER BY id FOR UPDATE`,
          [codesIn]
        );
        if (prs.rows.length === 0) throw new HttpError(404, "Không tìm thấy đề xuất mua hàng (PR).");
        for (const row of prs.rows) {
          const prKey = row.workflow_code || String(row.id);
          if (["CANCELLED", "REJECTED"].includes(String(row.status || "").toUpperCase())) {
            throw new HttpError(409, `${prKey} đã bị hủy / từ chối, không thể đưa vào PO.`);
          }
          let parsed: any[] = [];
          try {
            parsed = Array.isArray(row.results_summary) ? row.results_summary
              : (typeof row.results_summary === "string" && row.results_summary.trim().startsWith("[") ? JSON.parse(row.results_summary) : []);
          } catch {}
          const idxs = selected_item_keys
            .filter((k: string) => String(k).startsWith(prKey + "___"))
            .map((k: string) => parseInt(String(k).split("___")[1]));
          if (idxs.length === 0) continue;
          for (const idx of idxs) {
            if (!Number.isInteger(idx) || !parsed[idx]) {
              throw new HttpError(409, `${prKey}: không tìm thấy mặt hàng #${idx + 1} (PR có thể vừa được sửa). Tải lại trang rồi chọn lại.`);
            }
            if (parsed[idx].po_code) {
              throw new HttpError(409, `${prKey}: mặt hàng #${idx + 1} (${parsed[idx].product_code || ""}) đã thuộc PO ${parsed[idx].po_code}.`);
            }
            parsed[idx].po_code = po.po_code;
            parsed[idx].status = "CONVERTED";
          }
          const open = parsed.filter((x: any) => !x.po_code).length;
          const logs = Array.isArray(row.logs) ? row.logs : [];
          logs.push({ time: nowVNDateTime(), actor, action: `Bổ sung ${idxs.length} mặt hàng vào PO sẵn có ${po.po_code} (NCC: ${po.supplier_name})` });
          await c.query(
            "UPDATE workflow_requests SET status = $1, results_summary = $2, logs = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $4",
            [open > 0 ? "PARTIAL_CONVERTED" : "CONVERTED", JSON.stringify(parsed), JSON.stringify(logs), row.id]
          );
        }

        const noteLine = `[${nowVNDateTime()}] ${actor}: bổ sung ${items.length} dòng từ ${codesIn.join(", ")} (cộng dồn ${merged}, thêm mới ${added})`;
        await c.query(
          `UPDATE procurement_orders SET items = $1, total_amount = $2,
                  notes = CASE WHEN COALESCE(notes, '') = '' THEN $3 ELSE notes || E'\n' || $3 END,
                  version = COALESCE(version, 0) + 1
            WHERE id = $4`,
          [JSON.stringify(poItems), totalAmount, noteLine, po.id]
        );
        await linkSalesOrdersToPO(c, prs.rows.map((r: any) => r.workflow_code), po.po_code);
        return { po_code: po.po_code, merged, added };
      });

      await logAudit("APPEND_PO", "PROCUREMENT", `Bổ sung ${items.length} dòng từ PR (${(pr_ids || []).join(", ")}) vào PO ${result.po_code}`);
      return NextResponse.json({ success: true, ...result });
    }

    if (action === "consolidate_prs_to_po") {
      const { supplier_id, supplier_name, pr_ids, selected_item_keys, items, expected_delivery_date, notes, created_by } = body;
      // Một PO gửi đúng một NCC đã có trong danh bạ; dòng hàng phải có số lượng > 0 và giá ≥ 0
      if (!Array.isArray(items) || items.length === 0) throw new HttpError(400, "PO phải có ít nhất 1 dòng hàng.");
      for (const it of items) {
        const q = Number(it?.quantity), pr = Number(it?.unit_price ?? 0);
        if (!String(it?.product_code || "").trim()) throw new HttpError(400, "Có dòng hàng thiếu mã hàng.");
        if (!Number.isFinite(q) || q <= 0) throw new HttpError(400, `Mã ${it.product_code}: số lượng phải lớn hơn 0.`);
        if (!Number.isFinite(pr) || pr < 0) throw new HttpError(400, `Mã ${it.product_code}: đơn giá không hợp lệ.`);
      }
      const supRow = supplier_id ? (await query("SELECT id, name FROM procurement_suppliers WHERE id = $1", [supplier_id])).rows[0] : null;
      if (!supRow) throw new HttpError(400, "Chưa chọn nhà cung cấp hợp lệ cho PO.");
      const poCode = await generateDocumentCode({ docType: "PO", customPrefix: "ABT", tagMode: "GENERAL" });
      const totalAmount = items.reduce((acc: number, it: any) => acc + Number(it.quantity) * (Number(it.unit_price) || 0), 0);

      const result = await withTransaction(async (c) => {
        // The UI sends PR codes (PR26-CR-1004); older callers sent numeric ids — accept both
        const ids = (pr_ids || []).map((x: any) => String(x).trim()).filter((x: string) => /^\d+$/.test(x)).map(Number).sort((a: number, b: number) => a - b);
        const prCodesIn = (pr_ids || []).map((x: any) => String(x).trim()).filter((x: string) => x && !/^\d+$/.test(x));

        await ensureSupplierShortName();
        const poCreator = String(created_by || me.full_name || me.username || "Chuyên viên Cung ứng").trim();
        const insRes = await c.query(
          `INSERT INTO procurement_orders (
            po_code, supplier_id, supplier_name, order_date, expected_delivery_date,
            items, total_amount, status, notes, created_by
          ) VALUES ($1, $2, $3, $4::date, $5, $6, $7, 'PENDING', $8, $9) RETURNING id`,
          [poCode, supRow.id, supplier_name || supRow.name, todayVN(), expected_delivery_date || toVNDateString(new Date(Date.now() + 14 * 86400000)), JSON.stringify(items), totalAmount, notes || `Gom từ các PR: ${[...prCodesIn, ...ids].join(", ")}`, poCreator]
        );
        const newPoId = insRes.rows[0]?.id;

        if (ids.length > 0 || prCodesIn.length > 0) {
          const prs = await c.query(
            `SELECT id, workflow_code, status, results_summary, logs FROM workflow_requests
             WHERE id = ANY($1::int[]) OR workflow_code = ANY($2::text[]) ORDER BY id FOR UPDATE`,
            [ids, prCodesIn]
          );
          if (prs.rows.length === 0) throw new HttpError(404, "Không tìm thấy đề xuất mua hàng (PR) cần gom.");

          for (const row of prs.rows) {
            const logs = Array.isArray(row.logs) ? row.logs : [];
            const prKey = row.workflow_code || String(row.id);
            if (["CANCELLED", "REJECTED"].includes(String(row.status || "").toUpperCase())) {
              throw new HttpError(409, `${prKey} đã bị hủy / từ chối, không thể lập PO.`);
            }

            let parsedItems: any[] = [];
            try {
              if (typeof row.results_summary === "string" && row.results_summary.trim().startsWith("[")) {
                parsedItems = JSON.parse(row.results_summary);
              } else if (Array.isArray(row.results_summary)) {
                parsedItems = row.results_summary;
              }
            } catch {}

            let isPartial = false;
            if (Array.isArray(selected_item_keys) && parsedItems.length > 0) {
              const selectedIndices = selected_item_keys
                .filter((k: string) => k.startsWith(prKey + "___"))
                .map((k: string) => parseInt(k.split("___")[1]));

              if (selectedIndices.length > 0) {
                for (const idx of selectedIndices) {
                  if (!Number.isInteger(idx) || !parsedItems[idx]) {
                    throw new HttpError(409, `${prKey}: không tìm thấy mặt hàng #${idx + 1} (PR có thể vừa được sửa). Tải lại trang rồi chọn lại.`);
                  }
                  if (parsedItems[idx]) {
                    if (parsedItems[idx].po_code) {
                      throw new HttpError(409, `${prKey}: Mặt hàng #${idx + 1} (${parsedItems[idx].product_code || ''}) đã thuộc PO ${parsedItems[idx].po_code}`);
                    }
                    parsedItems[idx].po_code = poCode;
                    parsedItems[idx].status = "CONVERTED";
                  }
                }
                const remainingUnconverted = parsedItems.filter((it: any) => !it.po_code);
                isPartial = remainingUnconverted.length > 0;
              }
            }

            const targetStatus = isPartial ? "PARTIAL_CONVERTED" : "CONVERTED";
            logs.push({
              time: nowVNDateTime(),
              actor: created_by || "Phòng Cung Ứng",
              action: isPartial
                ? `Đã gom một phần mặt hàng vào Đơn đặt hàng tổng ${poCode} (NCC: ${supplier_name}). Còn lại các mã hàng khác chờ xử lý.`
                : `Đã gom toàn bộ mặt hàng vào Đơn đặt hàng tổng ${poCode} (NCC: ${supplier_name})`
            });

            await c.query(
              "UPDATE workflow_requests SET status = $1, results_summary = $2, logs = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $4",
              [targetStatus, parsedItems.length > 0 ? JSON.stringify(parsedItems) : row.results_summary, JSON.stringify(logs), row.id]
            );
          }
          await linkSalesOrdersToPO(c, prs.rows.map((r: any) => r.workflow_code), poCode);
        }

        return { po_id: newPoId };
      });

      await logAudit("CONSOLIDATE_PO", "PROCUREMENT", `Gom ${pr_ids?.length || 0} phiếu PR vào PO ${poCode} gửi NCC ${supplier_name}`);
      if (Array.isArray(items) && items.length > 0) {
        try {
          await withFactoryTx((tx) =>
            syncKdOrderOrPoToInternalOrder(tx, {
              kd_po_code: poCode,
              kd_so_code: Array.isArray(pr_ids) && pr_ids.length > 0 ? pr_ids.join(", ") : poCode,
              customer_name: supplier_name || "Đơn PO Gom PR",
              requested_date: expected_delivery_date || todayVN(),
              notes: notes || `Gom từ các PR: ${(pr_ids || []).join(", ")}`,
              items,
            })
          );
        } catch (syncConsErr: any) {
          console.error("[AUTO_SYNC_CONSOLIDATED_PO_TO_INTERNAL_ORDER_ERR]:", syncConsErr?.message || syncConsErr);
        }
      }
      return NextResponse.json({ success: true, po_code: poCode, po_id: result.po_id });
    }

    return NextResponse.json({ error: "Hành động POST không hợp lệ" }, { status: 400 });
  } catch (error: any) {
    console.error("Procurement POST error:", error);
    return NextResponse.json({ error: error.message || String(error) }, { status: httpErrorStatus(error) });
  }
}

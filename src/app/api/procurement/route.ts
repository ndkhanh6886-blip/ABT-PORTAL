import { NextRequest, NextResponse } from "next/server";
import { query, logAudit, withTransaction, HttpError, httpErrorStatus } from "@/backend/db/db";
import { getAuthorizedUser, isAdminUser, unauthorizedResponse, forbiddenResponse, AuthorizedUser, setAuditActor } from "@/backend/services/authz";
import { hasPermission } from "@/backend/services/permissions";
import { stripCostFields } from "@/backend/services/costVisibility";
import { todayVN, toVNDateString, nowVNDateTime } from "@/backend/services/dates";

function canApprovePO(user: AuthorizedUser) {
  return isAdminUser(user) || hasPermission(user, "procurement.approve_po");
}

function canSeeCost(user: AuthorizedUser) {
  return isAdminUser(user) || hasPermission(user, "warehouse.view_cost_price") || hasPermission(user, "procurement.view");
}

function canWriteProcurement(user: AuthorizedUser) {
  return (
    isAdminUser(user) ||
    hasPermission(user, "procurement.view") ||
    hasPermission(user, "procurement.create_po") ||
    hasPermission(user, "procurement.approve_po")
  );
}

function canRecordSupplierPayment(user: AuthorizedUser) {
  const dept = String(user.department || "").toLowerCase();
  return isAdminUser(user) || dept.includes("kế toán") || String(user.role || "").toLowerCase().includes("account") || hasPermission(user, "procurement.approve_po");
}
import { generateDocumentCode } from "@/backend/services/codeGenerator";
import { ensureProduct, addStock, reserveStock, appendCommercialCatalogEntry, sortByProductCode } from "@/backend/services/inventoryLedger";
import { syncCatalogSuppliersAndProducts, markSupplierDeleted, unmarkSupplierDeleted, invalidateSupplierCatalogCache } from "@/backend/services/supplierCatalogSync";

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
      UPDATE procurement_suppliers SET short_name = 'TBR' WHERE name ILIKE '%TBR%' AND (short_name IS NULL OR short_name = '');
      UPDATE procurement_suppliers SET short_name = 'Meridian' WHERE (name ILIKE '%Meridian%' OR name ILIKE '%Bioline%') AND (short_name IS NULL OR short_name = '');
      UPDATE procurement_suppliers SET short_name = 'Liferiver' WHERE (name ILIKE '%Liferiver%' OR name ILIKE '%Shanghai ZJ%') AND (short_name IS NULL OR short_name = '');
      UPDATE procurement_suppliers SET short_name = 'SSI' WHERE name ILIKE '%SSI%' AND (short_name IS NULL OR short_name = '');
      UPDATE procurement_suppliers SET short_name = 'Rollmed' WHERE name ILIKE '%Rollmed%' AND (short_name IS NULL OR short_name = '');
      UPDATE procurement_suppliers SET short_name = 'HiMedia' WHERE name ILIKE '%HiMedia%' AND (short_name IS NULL OR short_name = '');
      UPDATE procurement_suppliers SET short_name = 'Biolabs' WHERE (name ILIKE '%Biolabs%' OR name ILIKE '%NEB%') AND (short_name IS NULL OR short_name = '');
      UPDATE procurement_suppliers SET short_name = 'Jet Biofil' WHERE name ILIKE '%Biofil%' AND (short_name IS NULL OR short_name = '');
      UPDATE procurement_suppliers SET short_name = 'Biologix' WHERE name ILIKE '%Biologix%' AND (short_name IS NULL OR short_name = '');
    `);

    const seedIntlSuppliers = [
      {
        code: "NCC-MERIDIAN",
        name: "Meridian Bioscience Inc. (Bioline)",
        short_name: "Meridian",
        contact: "International Sales Dept",
        phone: "+1-513-271-3700",
        email: "info@meridianbioscience.com",
        address: "Cincinnati, Ohio, USA / London, UK",
        lines: "Nguyên liệu sinh phẩm chẩn đoán, Kháng nguyên, Kháng thể, Enzyme PCR / qPCR (Bioline)",
        terms: "T/T 100% hoặc Công nợ 30 ngày",
        match: "%meridian%"
      },
      {
        code: "NCC-LIFERIVER",
        name: "Shanghai ZJ Bio-Tech Co., Ltd (Liferiver)",
        short_name: "Liferiver",
        contact: "Export Division",
        phone: "+86-21-34680596",
        email: "export@liferiver.com.cn",
        address: "Shanghai, China",
        lines: "Kit Real-time PCR chẩn đoán IVD (HD-, RD-, ZJ-, OD-...)",
        terms: "T/T trước khi giao hàng",
        match: "%liferiver%"
      },
      {
        code: "NCC-SSI",
        name: "SSI Diagnostica A/S",
        short_name: "SSI",
        contact: "Nordic & Global Export",
        phone: "+45-4829-9100",
        email: "info@ssidiagnostica.com",
        address: "Herredsvejen 2, 3400 Hillerød, Denmark",
        lines: "Kháng huyết thanh định nhóm vi khuẩn, Môi trường & Sinh phẩm vi sinh (1110-00...)",
        terms: "T/T 30 ngày",
        match: "%ssi%"
      },
      {
        code: "NCC-ROLLMED",
        name: "Rollmed Co., Ltd",
        short_name: "Rollmed",
        contact: "Overseas Sales",
        phone: "+86-512-6586-0000",
        email: "sales@rollmed.com",
        address: "Suzhou, Jiangsu, China",
        lines: "Vật tư tiêu hao phòng Lab, Đầu côn, Ống nghiệm, Đĩa PCR",
        terms: "T/T 30 ngày",
        match: "%rollmed%"
      },
      {
        code: "NCC-HIMEDIA",
        name: "HiMedia Laboratories Pvt. Ltd.",
        short_name: "HiMedia",
        contact: "International Operations",
        phone: "+91-22-6147-1919",
        email: "info@himedialabs.com",
        address: "Mumbai, Maharashtra, India",
        lines: "Môi trường nuôi cấy vi sinh, Đĩa kháng sinh đồ & Hóa chất (KB..., M..., RM...)",
        terms: "T/T hoặc Công nợ 30 ngày",
        match: "%himedia%"
      },
      {
        code: "NCC-NEB",
        name: "New England Biolabs (NEB)",
        short_name: "Biolabs",
        contact: "International Distributors Support",
        phone: "+1-978-927-5054",
        email: "info@neb.com",
        address: "Ipswich, MA, USA",
        lines: "Enzyme giới hạn, Polymerase, Sinh phẩm sinh học phân tử (Biolabs)",
        terms: "T/T 30 ngày",
        match: "%biolabs%"
      }
    ];

    for (const s of seedIntlSuppliers) {
      const ex = await query(
        "SELECT id FROM procurement_suppliers WHERE name ILIKE $1 OR COALESCE(short_name, '') ILIKE $1 OR supplier_code = $2 LIMIT 1",
        [s.match, s.code]
      );
      if (ex.rows.length === 0) {
        await query(
          `INSERT INTO procurement_suppliers (supplier_code, name, short_name, contact_person, phone, email, address, product_lines, payment_terms, rating)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 5)
           ON CONFLICT (supplier_code) DO NOTHING`,
          [s.code, s.name, s.short_name, s.contact, s.phone, s.email, s.address, s.lines, s.terms]
        );
      }
    }

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

    if (action === "overview") {
      await syncCatalogSuppliersAndProducts();

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
          WHERE workflow_code LIKE 'PR%' OR workflow_code ILIKE '%PR-%' OR workflow_type ILIKE '%PROCUREMENT%' OR workflow_type = 'PURCHASE_REQUEST' OR target_dept ILIKE '%Cung%'
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
      const totalPayable = liveOrders.reduce((acc: number, o: any) => {
        if (String(o.payment_status || "").toUpperCase() === "PAID") return acc;
        const tot = parseFloat(o.total_amount) || 0;
        const paid = parseFloat(o.amount_amount || o.amount_paid) || 0;
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
        const code = supplier_code || `NCC-TBR-${Date.now().toString().slice(-4)}`;
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
        `Điều chỉnh giá mã ${prod.product_code}: ${oldPrice.toLocaleString('vi-VN')} đ -> ${newPrice.toLocaleString('vi-VN')} đ. Lý do: ${reason || 'Không ghi'}`,
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
      const { id, po_code, supplier_id, supplier_name, order_date, expected_delivery_date, items, total_amount, status, notes, force_rollback, rollback_reason } = body;
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

          if (["COMPLETED", "CANCELLED"].includes(existingUpper) && !force_rollback) {
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
            if (curLvl < 2 && reqLvl >= 2 && reqLvl !== 99 && !canApprovePO(me) && !canWriteProcurement(me)) safeStatus = existing.status;
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
            customPrefix: "TBR",
            tagMode: "GENERAL"
          });
          finalPoCode = code;

          let createStatus = String(status || "PENDING").toUpperCase();
          if (["COMPLETED", "PARTIALLY_RECEIVED", "PARTIAL_RECEIVED", "RECEIVED"].includes(createStatus)) createStatus = "PENDING";
          if (["APPROVED", "CONFIRMED", "ORDERED", "PRODUCED", "SHIPPED", "SHIPPING", "IN_TRANSIT", "AT_CUSTOMS", "ARRIVED_CUSTOMS", "CUSTOMS_CLEARING", "CUSTOMS_CLEARANCE"].includes(createStatus) && !canApprovePO(me) && !canWriteProcurement(me)) createStatus = "PENDING";
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
      const { id, po_code, status, expected_delivery_date, force_rollback, rollback_reason } = body;

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
        if (currLvl < 2 && nextLvl >= 2 && nextLvl !== 99 && !canApprovePO(me) && !canWriteProcurement(me)) {
          throw new HttpError(403, "Bạn không có quyền xác nhận hoặc cập nhật tiến trình đơn PO.");
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
      const validPayStatuses = new Set(["UNPAID", "PAYMENT_REQUESTED", "PARTIAL_PAID", "PAID"]);
      const nextPayStatus = validPayStatuses.has(rawPayStatus) ? rawPayStatus : "UNPAID";

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
        let nextAmountPaid = currPaid;

        if (nextPayStatus === "PAID") {
          nextAmountPaid = Math.max(currPaid, totalAmt);
        } else if (nextPayStatus === "UNPAID") {
          const payLedger = await c.query(
            "SELECT COALESCE(SUM(amount), 0) AS ledger_paid FROM procurement_payments WHERE po_id = $1 AND voided_at IS NULL",
            [po.id]
          );
          const ledgerPaid = parseFloat(payLedger.rows[0]?.ledger_paid) || 0;
          nextAmountPaid = ledgerPaid > 0 ? ledgerPaid : 0;
        } else if (nextPayStatus === "PARTIAL_PAID" && currPaid >= totalAmt && totalAmt > 0) {
          nextAmountPaid = Math.round(totalAmt * 0.5);
        } else if (nextPayStatus === "PAYMENT_REQUESTED" && currPaid >= totalAmt && totalAmt > 0) {
          const payLedger = await c.query(
            "SELECT COALESCE(SUM(amount), 0) AS ledger_paid FROM procurement_payments WHERE po_id = $1 AND voided_at IS NULL",
            [po.id]
          );
          const ledgerPaid = parseFloat(payLedger.rows[0]?.ledger_paid) || 0;
          nextAmountPaid = ledgerPaid < totalAmt ? ledgerPaid : 0;
        }

        await c.query(
          "UPDATE procurement_orders SET payment_status = $1, amount_paid = $2, version = COALESCE(version, 0) + 1 WHERE id = $3",
          [nextPayStatus, nextAmountPaid, po.id]
        );
        return { id: po.id, po_code: po.po_code, payment_status: nextPayStatus, amount_paid: nextAmountPaid };
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
            throw new HttpError(400, `PO ${po.po_code}: số chi ${a.amount.toLocaleString("vi-VN")} đ vượt công nợ còn lại ${remaining.toLocaleString("vi-VN")} đ`);
          }
          await c.query(
            `INSERT INTO procurement_payments (po_id, request_id, amount, method, reference_doc, payment_date, notes, created_by, voucher_code)
             VALUES ($1, $2, $3, $4, $5, COALESCE($6::date, $9::date), $7, $8, $10)`,
            [a.po_id, `${reqBase}_${a.po_id}`, a.amount, payment_method || "CK", reference_doc || null, payment_date || null,
             payment_notes || null, me.full_name || me.username, todayVN(), voucher]
          );
          const note = `[Thanh toán ${payment_date || todayVN()}: +${a.amount.toLocaleString("vi-VN")} đ (${payment_method || "CK"}) - Phiếu chi ${voucher}${reference_doc ? ` - UNC: ${reference_doc}` : ""}]`;
          await c.query(
            `UPDATE procurement_orders SET amount_paid = amount_paid + $1, notes = CONCAT_WS(' | ', NULLIF(notes, ''), $2::text), version = COALESCE(version, 0) + 1 WHERE id = $3`,
            [a.amount, note, a.po_id]
          );
        }
        return { duplicate: false, voucher, rows };
      });
      if (!result.duplicate) {
        const sum = alloc.reduce((s: number, a: any) => s + a.amount, 0);
        await logAudit("PAYMENT", "PROCUREMENT", `Phiếu chi ${result.voucher}: ${sum.toLocaleString("vi-VN")} đ cho ${alloc.length} PO (${result.rows.map((r: any) => r.po_code).join(", ")})`);
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
          `UPDATE procurement_orders SET amount_paid = GREATEST(0, amount_paid - $1), notes = CONCAT_WS(' | ', NULLIF(notes, ''), $2::text), version = COALESCE(version, 0) + 1 WHERE id = $3`,
          [amt, `[Hủy khoản chi ${amt.toLocaleString("vi-VN")} đ: ${reason.slice(0, 200)}]`, pay.po_id]
        );
        return { po_code: po?.po_code, amount: amt };
      });
      await logAudit("VOID_PAYMENT", "PROCUREMENT", `Hủy khoản chi ${r.amount.toLocaleString("vi-VN")} đ của PO ${r.po_code}: ${reason}`);
      return NextResponse.json({ success: true });
    }

    if (action === "record_payment") {
      const { po_id, po_code, payment_amount, payment_method, reference_doc, payment_date, payment_notes, request_id } = body;
      const amount = Number(payment_amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        throw new HttpError(400, "Số tiền thanh toán không hợp lệ (phải là số dương > 0)");
      }
      const reqId = request_id || `${po_id}_${reference_doc || "PAY"}_${amount}_${payment_date || ""}_${Date.now()}`;
      const noteEntry = `[Thanh toán ${payment_date || todayVN()}: +${amount.toLocaleString('vi-VN')} đ (${payment_method || 'CK'}) - UNC: ${reference_doc || 'N/A'}]`;

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
          throw new HttpError(400, `Số tiền thanh toán (${amount.toLocaleString('vi-VN')} đ) vượt công nợ còn lại (${remaining.toLocaleString('vi-VN')} đ) của đơn PO`);
        }

        const upd = await c.query(
          `UPDATE procurement_orders 
           SET amount_paid = amount_paid + $1,
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
          `Ghi nhận thanh toán ${amount.toLocaleString('vi-VN')} đ cho đơn PO ${po_code || po_id} (${payment_method || 'CK'})`
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
        for (const ln of lines) {
          const idx = Number(ln?.line_index);
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
          if (!pCode) throw new HttpError(400, "Dòng nhập kho phát sinh chưa có Mã hàng (SKU).");
          // nhiệt độ bảo quản: lô khai báo -> dòng PO -> danh mục sản phẩm; không tự điền
          if (pCode && !(pCode in pMasterTemp)) pMasterTemp[pCode] = (await c.query("SELECT storage_condition FROM products WHERE code = $1", [pCode])).rows[0]?.storage_condition || "";
          const lot = String(ln.lot_number || "").trim();
          const expiry = String(ln.expiry_date || "").trim();
          const mfgDate = String(ln.manufacture_date || "").trim();
          if (!lot) throw new HttpError(400, `Mã hàng ${pCode}: chưa nhập số lô.`);
          if (!expiry && !ln.no_expiry) throw new HttpError(400, `Mã hàng ${pCode} (lô ${lot}): chưa nhập hạn dùng (hoặc đánh dấu "Không có HSD" với thiết bị / vật tư).`);
          if (expiry && !/^\d{4}-\d{2}-\d{2}$/.test(expiry)) throw new HttpError(400, `Mã hàng ${pCode}: hạn dùng không hợp lệ.`);
          if (Number.isInteger(idx) && idx >= 0 && poIt) {
            thisReceipt[idx] = (thisReceipt[idx] || 0) + qty;
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
            unit_price: Number(ln.unit_price ?? fallbackIt.unit_price) || 0,
            storage_condition: String(ln.storage_condition || fallbackIt.storage_condition || pMasterTemp[pCode] || "").trim(),
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
        const effectivePerformer = String(received_by || me.full_name || me.username || "Thủ kho TBR").trim();

        const inboundCode = await generateDocumentCode({ docType: "PNK", tagMode: "GENERAL" });
        const txItems = clean.map(x => ({
          line_index: x.idx,
          product_code: x.pCode,
          product_name: x.poIt.product_name || x.pCode,
          specification: x.specification || undefined,
          unit: x.unit || "Hộp",
          quantity: x.qty,
          unit_price: x.unit_price,
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
            shelf: x.shelf_position || it.shelf_position || undefined
          });

          // Hold the received goods for the customer order the line was bought for (never more than it still needs)
          await reserveReceiptForSalesOrder(c, po, it, { pCode: x.pCode, pName, qty: x.qty, lot: x.lot }, inboundCode);

          await appendCommercialCatalogEntry(c, {
            code: x.pCode,
            name: pName,
            category: it.category || "Hàng Thương Mại",
            brand: po.supplier_name || it.supplier_name || "TBR Phân Phối",
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
        await c.query(
          `UPDATE procurement_orders
              SET status = $1, received_qty = $2::jsonb,
                  inbound_transaction_code = COALESCE(inbound_transaction_code, $3),
                  version = COALESCE(version, 0) + 1
            WHERE id = $4`,
          [newStatus, JSON.stringify(received), inboundCode, po.id]
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
            customPrefix: isStockOrder ? "STOCK" : "TBR",
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
        if (!codeStr || codeStr.toUpperCase() === "TBR-ITEM" || codeStr.toUpperCase() === "MÃ MỚI" || !nameStr) {
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
        return computedStatus;
      });

      await logAudit("UPDATE_PR", "PROCUREMENT", `Cập nhật trạng thái PR #${id} thành ${targetStatus}${po_code ? ` (PO: ${po_code})` : ''}`);
      return NextResponse.json({ success: true, status: targetStatus });
    }

    // 10. Consolidate Multiple PRs into a Unified PO (Requirement 4 - H3)
    if (action === "consolidate_prs_to_po") {
      const { supplier_id, supplier_name, pr_ids, selected_item_keys, items, expected_delivery_date, notes, created_by } = body;
      const poCode = await generateDocumentCode({ docType: "PO", customPrefix: "TBR", tagMode: "GENERAL" });
      const totalAmount = (items || []).reduce((acc: number, it: any) => acc + (parseFloat(it.quantity) || 1) * (parseFloat(it.unit_price) || 0), 0);

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
          [poCode, supplier_id, supplier_name, todayVN(), expected_delivery_date || toVNDateString(new Date(Date.now() + 14 * 86400000)), JSON.stringify(items || []), totalAmount, notes || `Gom từ các PR: ${ids.join(", ")}`, poCreator]
        );
        const newPoId = insRes.rows[0]?.id;

        if (ids.length > 0 || prCodesIn.length > 0) {
          const prs = await c.query(
            `SELECT id, workflow_code, results_summary, logs FROM workflow_requests
             WHERE id = ANY($1::int[]) OR workflow_code = ANY($2::text[]) ORDER BY id FOR UPDATE`,
            [ids, prCodesIn]
          );
          if (prs.rows.length === 0) throw new HttpError(404, "Không tìm thấy đề xuất mua hàng (PR) cần gom.");

          for (const row of prs.rows) {
            const logs = Array.isArray(row.logs) ? row.logs : [];
            const prKey = row.workflow_code || String(row.id);

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
      return NextResponse.json({ success: true, po_code: poCode, po_id: result.po_id });
    }

    return NextResponse.json({ error: "Hành động POST không hợp lệ" }, { status: 400 });
  } catch (error: any) {
    console.error("Procurement POST error:", error);
    return NextResponse.json({ error: error.message || String(error) }, { status: httpErrorStatus(error) });
  }
}

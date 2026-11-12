import { NextRequest, NextResponse } from "next/server";
import { query, logAudit, withTransaction, HttpError, httpErrorStatus } from "@/backend/db/db";
import { generateDocumentCode, getShortRepCode, getShortCustCode } from "@/backend/services/codeGenerator";
import { addStock, sortByProductCode, reserveStock, releaseReservation, releaseReservationsFor } from "@/backend/services/inventoryLedger";
import { stableStringify } from "@/backend/services/storagePatch";
import { getAuthorizedUser, unauthorizedResponse, forbiddenResponse, isAdminUser, isAccountantUser, setAuditActor } from "@/backend/services/authz";
import { hasPermission } from "@/backend/services/permissions";
import { stripCostFields } from "@/backend/services/costVisibility";
import { canApproveSalesOrders } from "@/backend/services/approvalGuard";
import { todayVN, toVNDateString } from "@/backend/services/dates";
import { mergeCatalogFields } from "@/backend/services/catalogStore";
import { notifyZaloProactiveEvent } from "@/backend/services/zaloEngine";

const DEFAULT_CREDIT_LIMIT = 100000000;
const DEFAULT_CREDIT_TERM_DAYS = 30;

/** Credit limit / term of a customer. A limit of 0 means "no credit" (it used to silently become 100 triệu). */
function customerCreditTerms(cust: any) {
  const rawLimit = cust?.credit_limit;
  const parsedLimit = parseFloat(rawLimit);
  const limit = rawLimit === null || rawLimit === undefined || rawLimit === "" || !Number.isFinite(parsedLimit) ? DEFAULT_CREDIT_LIMIT : parsedLimit;
  const parsedTerm = parseInt(cust?.credit_term_days);
  const termDays = Number.isFinite(parsedTerm) && parsedTerm >= 0 ? parsedTerm : DEFAULT_CREDIT_TERM_DAYS;
  return { limit, termDays };
}

/** Parses "YYYY-MM-DD..." or "DD/MM/YYYY" into a UTC date (null when unreadable). */
function parseLooseDate(v: any): Date | null {
  if (!v) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
  return null;
}

/** Earliest confirmed delivery date of each order, from its (non-cancelled) delivery slips. */
async function firstDeliveryDates(orderCodes: string[]): Promise<Map<string, Date>> {
  const out = new Map<string, Date>();
  if (orderCodes.length === 0) return out;
  let rows: any[] = [];
  try {
    rows = (await query("SELECT order_code, delivery_date, status, extra_data FROM sales_delivery_slips WHERE order_code = ANY($1::text[])", [orderCodes])).rows;
  } catch {
    // extra_data column not created yet on this database
    rows = (await query("SELECT order_code, delivery_date, status FROM sales_delivery_slips WHERE order_code = ANY($1::text[])", [orderCodes])).rows;
  }
  for (const r of rows) {
    let extra: any = r.extra_data;
    if (typeof extra === "string") { try { extra = JSON.parse(extra); } catch { extra = {}; } }
    extra = extra && typeof extra === "object" ? extra : {};
    const st = String(extra.deliveryStatus || "").toUpperCase();
    const cancelled = st === "CANCELLED" || String(r.status || "").toUpperCase() === "CANCELLED";
    const delivered = extra.isDelivered === true || extra.isDelivered === "true" || ["DELIVERED", "FULLY_DELIVERED", "PARTIALLY_DELIVERED"].includes(st);
    if (!delivered || cancelled) continue;
    const d = parseLooseDate(extra.deliveredAt) || parseLooseDate(r.delivery_date);
    if (!d) continue;
    const prev = out.get(r.order_code);
    if (!prev || d < prev) out.set(r.order_code, d);
  }
  return out;
}

/**
 * Open (unpaid, not cancelled) orders of a customer, optionally excluding one order, each with
 * `due_start`: the date the payment term starts = the (first) delivery date, and
 * `delivered_amount`: giá trị hàng đã giao thành công theo Phiếu giao hàng (sales_delivery_slips).
 * Công nợ chỉ phát sinh theo Phiếu giao hàng đã giao thành công (không tính SO chưa giao).
 */
async function openOrdersOfCustomer(cust: any, excludeOrderId: number | null = null) {
  const res = await query(
    `SELECT id, order_code, order_date, items, total_amount, COALESCE(amount_paid, 0) AS amount_paid, payment_status, delivery_status, invoice_date, delivered_at FROM sales_orders
      WHERE (customer_id = $1 OR (customer_id IS NULL AND customer_name = $2))
        AND COALESCE(payment_status, 'UNPAID') <> 'PAID'
        AND UPPER(COALESCE(delivery_status, '')) <> 'CANCELLED'
        AND UPPER(COALESCE(applied_price_policy, '')) <> 'STOCK'
        AND ($3::int IS NULL OR id <> $3::int)`,
    [cust.id, cust.name, excludeOrderId]
  );
  const orderCodes = res.rows.map((r: any) => r.order_code).filter(Boolean);
  const deliveries = await firstDeliveryDates(orderCodes);

  const slipsByOrder = new Map<string, any[]>();
  if (orderCodes.length > 0) {
    let slipRows: any[] = [];
    try {
      slipRows = (await query("SELECT order_code, items, status, extra_data FROM sales_delivery_slips WHERE order_code = ANY($1::text[])", [orderCodes])).rows;
    } catch {
      slipRows = (await query("SELECT order_code, items, status FROM sales_delivery_slips WHERE order_code = ANY($1::text[])", [orderCodes])).rows;
    }
    for (const sl of slipRows) {
      const k = String(sl.order_code || "");
      if (!k) continue;
      if (!slipsByOrder.has(k)) slipsByOrder.set(k, []);
      slipsByOrder.get(k)!.push(sl);
    }
  }

  return res.rows.map((r: any) => {
    let dueStart: Date | null = deliveries.get(r.order_code) || null;
    if (!dueStart && r.delivered_at) dueStart = parseLooseDate(r.delivered_at);
    if (!dueStart && String(r.delivery_status || "").toUpperCase() === "DELIVERED") {
      dueStart = parseLooseDate(r.invoice_date) || parseLooseDate(r.order_date);
    }

    const ordItems = parseJsonArray(r.items).filter((it: any) => it?.status !== "CANCELLED");
    const itemCode = (it: any) => String(it?.productCode || it?.product_code || "").trim();
    const unitPriceOf = (code: string) => {
      const found = ordItems.find((x: any) => itemCode(x) === code);
      return Number(found?.unitPrice ?? found?.price ?? found?.unit_price) || 0;
    };

    let deliveredAmt = 0;
    let anyDeliveredSlip = false;
    for (const sl of slipsByOrder.get(String(r.order_code)) || []) {
      let ex: any = sl.extra_data;
      if (typeof ex === "string") { try { ex = JSON.parse(ex || "{}"); } catch { ex = {}; } }
      ex = ex && typeof ex === "object" ? ex : {};
      const st = String(ex.deliveryStatus || sl.status || "").toUpperCase();
      if (st === "CANCELLED") continue;
      const isDel = ex.isDelivered === true || ex.isDelivered === "true" || st === "DELIVERED" || st === "FULLY_DELIVERED";
      if (!isDel) continue;
      anyDeliveredSlip = true;
      deliveredAmt += parseJsonArray(sl.items).reduce((s: number, it: any) => {
        if (it?.isGift || it?.is_gift) return s;
        const qty = Number(it?.quantity ?? it?.qtyDeliverNow ?? it?.qty) || 0;
        const price = Number(it?.unitPrice ?? it?.price ?? it?.unit_price) || unitPriceOf(itemCode(it));
        return s + qty * price;
      }, 0);
    }
    const ordTotal = parseFloat(r.total_amount) || 0;
    if (!anyDeliveredSlip && String(r.delivery_status || "").toUpperCase() === "DELIVERED") {
      deliveredAmt = ordTotal;
    }
    deliveredAmt = Math.min(Math.round(deliveredAmt), ordTotal || Math.round(deliveredAmt));

    return { ...r, due_start: dueStart, delivered_amount: deliveredAmt };
  });
}

/** Days past the payment term for an open order (0 when not delivered or still within term). */
function overdueDays(order: any, termDays: number): number {
  if (!order.due_start) return 0;
  if ((parseFloat(order.delivered_amount) || 0) - (parseFloat(order.amount_paid) || 0) <= 0) return 0;
  const days = Math.floor((Date.now() - new Date(order.due_start).getTime()) / (1000 * 3600 * 24));
  return days > termDays ? days - termDays : 0;
}

/** Credit check for an order: Công nợ tính theo Phiếu giao hàng đã giao thành công (không tính theo SO chưa giao). */
async function evaluateCredit(cust: any, _orderTotal: number, excludeOrderId: number | null) {
  const { limit, termDays } = customerCreditTerms(cust);
  const openOrders = await openOrdersOfCustomer(cust, excludeOrderId);
  const currentDebt = openOrders.reduce(
    (sum: number, o: any) => sum + Math.max(0, (parseFloat(o.delivered_amount) || 0) - (parseFloat(o.amount_paid) || 0)),
    0
  );
  let blocked = false;
  let reason = "";
  if (currentDebt > limit) {
    blocked = true;
    reason = `Vượt hạn mức công nợ (tính theo Phiếu giao hàng đã giao): Dư nợ đã giao (${currentDebt.toLocaleString('vi-VN', { maximumFractionDigits: 0 })} đ) vượt trần ${limit.toLocaleString('vi-VN', { maximumFractionDigits: 0 })} đ`;
  }
  for (const uo of openOrders) {
    const late = overdueDays(uo, termDays);
    if (late > 0) {
      blocked = true;
      reason = (reason ? reason + " • " : "") + `Đơn ${uo.order_code} có phiếu giao hàng quá hạn thanh toán ${late} ngày kể từ ngày giao (Hạn: ${termDays} ngày)`;
      break;
    }
  }
  return { blocked, reason };
}

/** A customer with open (unpaid, not cancelled) orders cannot be deleted: its debt control would disappear. */
async function openOrderCountForCustomer(idOrCode: any): Promise<number> {
  const numId = idOrCode !== undefined && idOrCode !== null && !isNaN(Number(idOrCode)) ? Number(idOrCode) : null;
  const cust = (await query(
    "SELECT id, name FROM sales_customers WHERE ($1::int IS NOT NULL AND id = $1::int) OR customer_code = $2 LIMIT 1",
    [numId, String(idOrCode ?? "")]
  )).rows[0];
  if (!cust) return 0;
  return (await openOrdersOfCustomer(cust)).length;
}

/** order_id from the UI is sometimes the numeric row id and sometimes the order CODE: only a number may be compared with the id column. */
function numericIdOrNull(v: any): number | null {
  if (v === undefined || v === null || v === "") return null;
  const s = String(v).trim();
  return /^\d+$/.test(s) ? Number(s) : null;
}

/** True when the slip does not exist or was cancelled (its stock was put back). */
async function deliverySlipIsCancelled(idOrCode: any): Promise<boolean> {
  const r = await query(
    "SELECT status, extra_data FROM sales_delivery_slips WHERE (CASE WHEN NULLIF($1::text, '') IS NOT NULL AND $1::text !~ '^[0-9]+$' THEN slip_code = $1::text ELSE id = $2::int END) LIMIT 1",
    [String(idOrCode ?? ""), numericIdOrNull(idOrCode)]
  );
  const row = r.rows[0];
  if (!row) return true;
  let extra: any = row.extra_data;
  if (typeof extra === "string") { try { extra = JSON.parse(extra); } catch { extra = {}; } }
  return String(extra?.deliveryStatus || row.status || "").toUpperCase() === "CANCELLED";
}

function parseJsonArray(v: any): any[] {
  if (Array.isArray(v)) return v;
  if (typeof v === "string") {
    try { const parsed = JSON.parse(v); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
  }
  return [];
}

/** Số lượng / đơn giá của một dòng hàng (các tên trường client đang dùng) */
function orderLineQty(it: any): number {
  return Number(it?.quantity ?? it?.qty ?? 0);
}
function orderLinePrice(it: any): number {
  return Number(it?.unitPrice ?? it?.unit_price ?? it?.price ?? 0);
}

/** Lỗi dữ liệu dòng hàng (số âm / không phải số), null nếu hợp lệ */
function validateOrderItems(items: any[]): string | null {
  for (const it of items) {
    const q = orderLineQty(it), p = orderLinePrice(it);
    if (!Number.isFinite(q) || !Number.isFinite(p)) return `Số lượng / đơn giá của mặt hàng ${it?.productCode || it?.product_code || ""} không hợp lệ.`;
    if (q < 0 || p < 0) return `Số lượng và đơn giá mặt hàng ${it?.productCode || it?.product_code || ""} không được là số âm.`;
  }
  return null;
}

/** Tổng tiền đơn do máy chủ tự tính = Σ số lượng × đơn giá của các dòng chưa hủy (không tin tổng tiền client gửi) */
function computeOrderTotal(items: any[]): number {
  const total = items
    .filter(it => it?.status !== "CANCELLED")
    .reduce((sum, it) => {
      const hasUnitPrice = it?.unitPrice !== undefined || it?.unit_price !== undefined || it?.price !== undefined;
      return sum + (hasUnitPrice ? orderLineQty(it) * orderLinePrice(it) : Number(it?.totalPrice ?? it?.total ?? 0) || 0);
    }, 0);
  return Math.round(total);
}

function itemHasZeroPrice(it: any): boolean {
  const p = parseFloat(it?.price) || parseFloat(it?.unitPrice) || parseFloat(it?.unit_price) || 0;
  return it?.status !== "CANCELLED" && (p === 0 || it?.isGift === true || it?.isSample === true);
}

// ==========================================
// FINITE STATE MACHINE (FSM) HIERARCHIES & MONOTONIC PROCESS GUARD
// Chốt chặn ngăn chặn triệt để tình trạng lùi bước / tụt trạng thái tiến trình
// ==========================================
const DELIVERY_STATUS_HIERARCHY: Record<string, number> = {
  "PENDING": 0,
  "PROCESSING": 1,
  "PACKED": 2,
  "READY": 2,
  "SHIPPED": 3,
  "DISPATCHED": 3,
  "PARTIALLY_DELIVERED": 3.5,
  "DELIVERED": 4,
  "CANCELLED": -1
};

const INVOICE_STATUS_HIERARCHY: Record<string, number> = {
  "PENDING_INVOICE": 0,
  "PENDING": 0,
  "PARTIALLY_INVOICED": 1,
  "ISSUED": 2,
  "INVOICED": 2
};

const PAYMENT_STATUS_HIERARCHY: Record<string, number> = {
  "UNPAID": 0,
  "PARTIALLY_PAID": 1,
  "PAID": 2
};

function resolveMonotonicStatus(
  currentStatus: string | null | undefined,
  incomingStatus: string | null | undefined,
  hierarchy: Record<string, number>,
  allowRollback: boolean = false
): string {
  const curr = (currentStatus || "").trim().toUpperCase();
  const next = (incomingStatus || "").trim().toUpperCase();

  if (!next) return curr || Object.keys(hierarchy)[0];
  if (!curr) return next;
  if (curr === next) return curr;

  // Nếu người dùng có quyền và yêu cầu rollback có lý do rõ ràng
  if (allowRollback) return next;

  // Trạng thái hủy / hoàn hàng được phép chuyển nếu có quy trình
  if (next === "CANCELLED" || next === "REJECTED") return next;

  const currLevel = hierarchy[curr] !== undefined ? hierarchy[curr] : 0;
  const nextLevel = hierarchy[next] !== undefined ? hierarchy[next] : 0;

  // Bảo vệ đơn hướng: Không cho phép lùi trạng thái nếu nextLevel < currLevel
  if (nextLevel < currLevel) {
    return curr; // Giữ nguyên trạng thái cao nhất đã đạt được, triệt tiêu lỗi lùi bước
  }

  return next;
}

function parseSqlDate(d: any): string {
  if (!d) return todayVN();
  if (typeof d === 'string' && d.includes('/')) {
    const parts = d.split('/');
    if (parts.length === 3) {
      const day = parts[0].padStart(2, '0');
      const month = parts[1].padStart(2, '0');
      const year = parts[2];
      return `${year}-${month}-${day}`;
    }
  }
  try {
    const parsed = new Date(d);
    if (!isNaN(parsed.getTime())) return toVNDateString(parsed);
  } catch (e) {}
  return todayVN();
}

let quotationExtraColumnEnsured = false;
let customerTaxAddressColumnEnsured = false;
const QUOTATION_EXTRA_KEYS = [
  "contactPerson", "contactPhone", "contactEmail", "contactPosition",
  "salesRepId", "salesRepPhone", "salesRepEmail",
  "validityTerms", "deliveryTerms", "paymentTerms", "noteTerms",
  "hasZeroPriceItems", "priceApprovalStatus", "customer_code", "customerId"
];

function normalizeQuotationRow(r: any) {
  if (!r) return null;
  const quoteId = r.quote_code || (r.id ? String(r.id) : `BG-${Date.now()}`);
  let extra: any = {};
  try {
    extra = typeof r.extra_data === "string" ? JSON.parse(r.extra_data || "{}") : (r.extra_data || {});
  } catch (e) { extra = {}; }
  const rawItems = Array.isArray(r.items) ? r.items : (typeof r.items === 'string' ? JSON.parse(r.items || '[]') : []);
  const normalizedItems = rawItems.map((it: any) => ({
    ...it,
    productCode: it.productCode || it.product_code || it.sku || it.code || "",
    productName: it.productName || it.product_name || it.name || it.productCode || "",
    quantity: Number(it.quantity !== undefined ? it.quantity : (it.qty !== undefined ? it.qty : 1)) || 1,
    qty: Number(it.quantity !== undefined ? it.quantity : (it.qty !== undefined ? it.qty : 1)) || 1,
    price: Number(it.price !== undefined ? it.price : (it.unitPrice !== undefined ? it.unitPrice : (it.unit_price !== undefined ? it.unit_price : 0))) || 0,
    unitPrice: Number(it.unitPrice !== undefined ? it.unitPrice : (it.price !== undefined ? it.price : 0)) || 0,
    unit: it.unit || "Hộp",
    total: Number(it.total !== undefined ? it.total : (it.amount !== undefined ? it.amount : 0)) || 0
  }));

  return {
    ...(extra && typeof extra === "object" ? extra : {}),
    ...r,
    id: quoteId,
    quote_code: quoteId,
    customerName: r.customer_name || r.customerName || "",
    customerId: r.customer_id ? String(r.customer_id) : (r.customerId || ""),
    salesRepName: r.sales_rep_name || r.salesRepName || "",
    salesRepId: extra.salesRepId || r.salesRepId || r.sales_rep_id || "",
    totalAmount: Number(r.total_amount || r.totalAmount) || 0,
    totalBeforeVat: Number(r.subtotal || r.totalBeforeVat) || 0,
    totalVat: Number(r.tax_amount || r.totalVat) || 0,
    totalDiscount: Number(r.discount_amount || r.totalDiscount) || 0,
    discountRate: Number(r.discount_rate || r.discountRate) || 0,
    taxRate: Number(r.tax_rate || r.taxRate) || 8,
    status: r.status || "Draft",
    paymentTerms: extra.paymentTerms !== undefined && extra.paymentTerms !== null ? extra.paymentTerms : (r.paymentTerms !== undefined && r.paymentTerms !== null ? r.paymentTerms : (r.terms ?? "")),
    validityTerms: extra.validityTerms !== undefined && extra.validityTerms !== null ? extra.validityTerms : (r.validityTerms ?? undefined),
    deliveryTerms: extra.deliveryTerms !== undefined && extra.deliveryTerms !== null ? extra.deliveryTerms : (r.deliveryTerms ?? undefined),
    noteTerms: extra.noteTerms !== undefined && extra.noteTerms !== null ? extra.noteTerms : (r.noteTerms ?? undefined),
    items: normalizedItems
  };
}

let contractExtraColumnEnsured = false;
const CONTRACT_EXTRA_KEYS = [
  "quotationId", "quoteId", "date", "signDate", "validUntil",
  "partyAName", "partyAAddress", "partyAPhone", "partyAEmail", "partyARepresentative", "partyARole", "partyATaxCode", "partyACustomFields",
  "partyBName", "partyBAddress", "partyBPhone", "partyBEmail", "partyBRepresentative", "partyBRole", "partyBTaxCode", "partyBCustomFields",
  "taxCode", "representative", "contractValue", "deliveryTerms", "paymentTerms", "contractTerms", "generalTerms",
  "salesRepId", "contractType", "isPrinciple", "isFramework", "signedFileUrl", "invoiceFile", "customerCode", "customer_code", "customerId",
  "orderId", "orderIds", "hasOrder"
];

function normalizeContractRow(r: any) {
  if (!r) return null;
  const contractId = r.contract_code || (r.id ? String(r.id) : `CTR-${Date.now()}`);
  let extra: any = {};
  try {
    extra = typeof r.extra_data === "string" ? JSON.parse(r.extra_data || "{}") : (r.extra_data || {});
  } catch (e) { extra = {}; }
  extra = extra && typeof extra === "object" ? extra : {};
  const rawStatus = String(r.status || extra.status || "ACTIVE").trim();
  const normalizedStatus = (rawStatus === "ACTIVE" || rawStatus === "Signed") ? "Signed" : ((rawStatus === "DRAFT" || rawStatus === "Draft") ? "Draft" : rawStatus);
  const rawItems = Array.isArray(r.items) ? r.items : (typeof r.items === 'string' ? (() => { try { return JSON.parse(r.items || '[]'); } catch { return []; } })() : (Array.isArray(extra.items) ? extra.items : []));
  const rawFiles = Array.isArray(r.contract_files) ? r.contract_files : (typeof r.contract_files === 'string' ? (() => { try { return JSON.parse(r.contract_files || '[]'); } catch { return []; } })() : (Array.isArray(extra.contract_files) ? extra.contract_files : []));
  const totalVal = Number(r.total_value ?? r.totalAmount ?? extra.totalAmount ?? extra.total_value ?? extra.contractValue ?? 0) || 0;
  return {
    ...extra,
    ...r,
    id: contractId,
    contract_code: contractId,
    contractTitle: r.title || r.contractTitle || extra.contractTitle || extra.title || "Hợp đồng mua bán",
    customerName: r.customer_name || r.customerName || extra.customerName || extra.partyBName || "",
    salesRepName: r.sales_rep_name || r.salesRepName || extra.salesRepName || "",
    salesRepId: extra.salesRepId || r.salesRepId || r.sales_rep_id || "",
    totalAmount: totalVal,
    total_value: totalVal,
    status: normalizedStatus,
    notes: r.notes || extra.notes || "",
    items: rawItems,
    contract_files: rawFiles
  };
}

async function mergeContractsWithStorage(dbRows: any[]): Promise<any[]> {
  const map = new Map<string, any>();
  let deletedSet = new Set<string>();
  try {
    const stRes = await query("SELECT key, data FROM app_storage WHERE key IN ('sales_contracts', 'deleted_sales_contracts')");
    const stMap = new Map<string, any>(stRes.rows.map((r: any) => [r.key, r.data]));
    const delArr = Array.isArray(stMap.get("deleted_sales_contracts")) ? stMap.get("deleted_sales_contracts") : [];
    deletedSet = new Set<string>(delArr.map((x: any) => String(x || "").trim().toUpperCase()).filter(Boolean));
    const stored = Array.isArray(stMap.get("sales_contracts")) ? stMap.get("sales_contracts") : [];
    for (const sc of stored) {
      const norm = normalizeContractRow(sc);
      const k = String(norm?.contract_code || norm?.id || '').trim();
      if (k && !deletedSet.has(k.toUpperCase())) map.set(k, norm);
    }
  } catch (e) {}
  for (const r of dbRows || []) {
    const norm = normalizeContractRow(r);
    const k = String(norm?.contract_code || norm?.id || '').trim();
    if (!k || deletedSet.has(k.toUpperCase())) continue;
    const prev = map.get(k);
    if (prev) {
      map.set(k, {
        ...prev,
        ...norm,
        items: Array.isArray(norm.items) && norm.items.length > 0 ? norm.items : (prev.items || []),
        contract_files: Array.isArray(norm.contract_files) && norm.contract_files.length > 0 ? norm.contract_files : (prev.contract_files || []),
      });
    } else {
      map.set(k, norm);
    }
  }
  return Array.from(map.values());
}

// Thông tin mở rộng của phiếu giao (đợt giao, hình thức, trạng thái xác nhận, POD...) lưu ở cột JSONB extra_data
let deliverySlipExtraColumnEnsured = false;
let orderInvoiceNotesColumnEnsured = false;
const DELIVERY_SLIP_EXTRA_KEYS = [
  "batchNumber", "deliveryMode", "deliveryStatus", "isDelivered", "deliveredAt",
  "receiverName", "receiverPhone", "receiverRole", "deliveryStaff", "confirmedBy", "confirmedAt",
  "podImages", "podDeliveryId", "invoiceNo", "invoiceStatus", "invoiceFiles", "invoiceNotes", "invoice_notes",
  "cancelledAt", "cancelledBy", "cancelReason", "editedAt", "editedBy", "createdBy"
];

function normalizeDeliverySlipRow(r: any) {
  if (!r) return null;
  let extra: any = r.extra_data;
  if (typeof extra === "string") {
    try { extra = JSON.parse(extra || "{}"); } catch { extra = {}; }
  }
  extra = extra && typeof extra === "object" ? extra : {};
  return {
    ...extra,
    ...r,
    id: r.slip_code || String(r.id),
    orderId: r.order_id || "",
    orderCode: r.order_code || "",
    customerName: r.customer_name || "",
    customerAddress: r.customer_address || "",
    customerPhone: r.customer_phone || "",
    customerContact: r.customer_contact || "",
    deliveryDate: r.delivery_date || "",
    timeliness: r.timeliness || "",
    dispatchLocation: r.dispatch_location || "",
    dispatcherName: r.dispatcher_name || "",
    dispatcherPhone: r.dispatcher_phone || "",
    creatorName: r.creator_name || "",
    notes: r.notes || "",
    items: Array.isArray(r.items) ? r.items : (typeof r.items === 'string' ? JSON.parse(r.items || '[]') : []),
    invoiceNumber: r.invoice_number || "",
    invoiceDate: r.invoice_date || "",
    status: r.status || "COMPLETED",
    createdAt: r.created_at
  };
}

const normalizeCustomerMatchKey = (s: any): string =>
  String(s || "")
    .toLowerCase()
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/\s+/g, " ")
    .trim();

async function enrichCustomerRowsWithContacts(customerRows: any[]): Promise<any[]> {
  if (!Array.isArray(customerRows) || customerRows.length === 0) return customerRows;
  let relationalContacts: any[] = [];
  try {
    const res = await query("SELECT * FROM customer_contacts ORDER BY is_primary DESC, id ASC");
    relationalContacts = res.rows || [];
  } catch {
    relationalContacts = [];
  }

  const parseContactsField = (raw: any): any[] => {
    if (Array.isArray(raw)) return raw;
    if (typeof raw === "string" && raw.trim()) {
      try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
    return [];
  };

  // Group all known contacts by customer_id, customer_code, and normalized customer name
  const byId = new Map<string, any[]>();
  const byCode = new Map<string, any[]>();
  const byName = new Map<string, any[]>();

  const pushContact = (map: Map<string, any[]>, key: string, ct: any) => {
    if (!key || !ct || !String(ct.name || "").trim()) return;
    const list = map.get(key) || [];
    const normName = String(ct.name).trim().toLowerCase();
    const existing = list.find(x => String(x.name || "").trim().toLowerCase() === normName);
    if (!existing) {
      list.push({
        id: ct.id || undefined,
        name: String(ct.name).trim(),
        position: ct.position || "",
        department: ct.department || "",
        phone: ct.phone || "",
        email: ct.email || "",
        role_type: ct.role_type || "Kỹ thuật / Quyết định mua",
        is_primary: Boolean(ct.is_primary),
        notes: ct.notes || ""
      });
      map.set(key, list);
    } else {
      if (!existing.phone && ct.phone) existing.phone = ct.phone;
      if (!existing.position && ct.position) existing.position = ct.position;
      if (!existing.department && ct.department) existing.department = ct.department;
      if (!existing.email && ct.email) existing.email = ct.email;
      if (ct.is_primary) existing.is_primary = true;
    }
  };

  for (const row of customerRows) {
    const idKey = row.id !== undefined && row.id !== null ? String(row.id) : "";
    const codeKey = String(row.customer_code || "").trim().toLowerCase();
    const nameKey = normalizeCustomerMatchKey(row.name);
    const jsonContacts = parseContactsField(row.contacts);
    for (const ct of jsonContacts) {
      if (idKey) pushContact(byId, idKey, ct);
      if (codeKey) pushContact(byCode, codeKey, ct);
      if (nameKey) pushContact(byName, nameKey, ct);
    }
  }

  for (const rc of relationalContacts) {
    const idKey = rc.customer_id !== undefined && rc.customer_id !== null ? String(rc.customer_id) : "";
    const codeKey = String(rc.customer_code || "").trim().toLowerCase();
    if (idKey) pushContact(byId, idKey, rc);
    if (codeKey) pushContact(byCode, codeKey, rc);
  }

  return customerRows.map(row => {
    const idKey = row.id !== undefined && row.id !== null ? String(row.id) : "";
    const codeKey = String(row.customer_code || "").trim().toLowerCase();
    const nameKey = normalizeCustomerMatchKey(row.name);

    const mergedMap = new Map<string, any>();
    const addList = (arr?: any[]) => {
      if (!Array.isArray(arr)) return;
      for (const ct of arr) {
        const k = String(ct?.name || "").trim().toLowerCase();
        if (!k) continue;
        const prev = mergedMap.get(k);
        if (!prev) {
          mergedMap.set(k, { ...ct });
        } else {
          if (!prev.phone && ct.phone) prev.phone = ct.phone;
          if (!prev.position && ct.position) prev.position = ct.position;
          if (!prev.department && ct.department) prev.department = ct.department;
          if (!prev.email && ct.email) prev.email = ct.email;
          if (ct.is_primary) prev.is_primary = true;
        }
      }
    };

    addList(parseContactsField(row.contacts));
    if (idKey) addList(byId.get(idKey));
    if (codeKey) addList(byCode.get(codeKey));
    if (nameKey) addList(byName.get(nameKey));

    const legacyPerson = String(row.contact_person || "").trim();
    if (legacyPerson && !mergedMap.has(legacyPerson.toLowerCase())) {
      mergedMap.set(legacyPerson.toLowerCase(), {
        id: `CT-${row.customer_code || row.id || "1"}-PRIMARY`,
        name: legacyPerson,
        position: row.contact_position || "",
        department: "",
        phone: row.phone || "",
        email: row.email || "",
        role_type: "Kỹ thuật / Quyết định mua",
        is_primary: mergedMap.size === 0,
        notes: ""
      });
    }

    return {
      ...row,
      contacts: Array.from(mergedMap.values())
    };
  });
}

export async function GET(req: NextRequest) {
  try {
    // Phiên phải còn hiệu lực (tài khoản chưa bị khóa, mật khẩu chưa đổi): proxy chỉ kiểm tra chữ ký cookie
    const authUser = await getAuthorizedUser(req);
    if (!authUser) return unauthorizedResponse();
    setAuditActor(authUser);
    const canSeeCost = isAdminUser(authUser) || hasPermission(authUser, "warehouse.view_cost_price");
    const { searchParams } = new URL(req.url);
    const action = searchParams.get("action") || "overview";

    if (action === "overview") {
      const [customers, orders, quotations, products, targets, tasks, plans, daily, reservations, openPOs, contractsRes, rmaRes, recallsRes, slipsRes, prRes] = await Promise.all([
        query("SELECT * FROM sales_customers ORDER BY id DESC"),
        query("SELECT * FROM sales_orders ORDER BY id DESC"),
        query("SELECT * FROM sales_quotations ORDER BY id DESC"),
        query("SELECT * FROM products ORDER BY code ASC"),
        query("SELECT * FROM sales_targets ORDER BY id DESC"),
        query("SELECT * FROM sales_tasks ORDER BY id DESC"),
        query("SELECT * FROM sales_plans ORDER BY id DESC"),
        query("SELECT * FROM sales_daily_logs ORDER BY log_date DESC LIMIT 100"),
        query("SELECT * FROM inventory_reservations ORDER BY id DESC"),
        query("SELECT id, po_code, supplier_name, expected_delivery_date, status, items FROM procurement_orders ORDER BY id DESC"),
        query("SELECT * FROM sales_contracts ORDER BY id DESC"),
        query("SELECT * FROM rma_returns ORDER BY id DESC"),
        query("SELECT * FROM lot_recalls ORDER BY id DESC"),
        query("SELECT * FROM sales_delivery_slips ORDER BY id DESC"),
        query("SELECT id, workflow_code, title, status, product_info, due_date, description, results_summary, requester_name FROM workflow_requests WHERE target_dept = 'Cung Ứng' OR workflow_type LIKE '%PROCUREMENT%' OR workflow_type = 'SALES_TO_PROCUREMENT' OR workflow_code LIKE 'PR%' ORDER BY id DESC"),
      ]);

      // Đã thu theo từng phiếu giao (khoản thu không gắn phiếu: delivery_slip_code = null)
      let slipPayments: any[] = [];
      try {
        slipPayments = (await query(
          "SELECT order_code, delivery_slip_code, SUM(amount)::float AS paid FROM sales_payments WHERE voided_at IS NULL GROUP BY order_code, delivery_slip_code"
        )).rows;
      } catch { slipPayments = []; }

      const enrichedCustomers = await enrichCustomerRowsWithContacts(customers.rows);

      // Tự động gỡ khóa công nợ (is_credit_blocked) cho các đơn hàng cũ bị khóa theo công thức cũ (tính tổng SO chưa giao)
      // nếu thực tế khách hàng chưa có phiếu giao hàng nào vượt hạn mức hoặc quá hạn thanh toán.
      const blockedOrderRows = orders.rows.filter((r: any) => Boolean(r.is_credit_blocked) && String(r.approval_status || "").toUpperCase() !== "APPROVED");
      if (blockedOrderRows.length > 0) {
        try {
          const custByIdMap = new Map<number, any>();
          const custByNameMap = new Map<string, any>();
          for (const c of customers.rows) {
            if (c.id) custByIdMap.set(Number(c.id), c);
            if (c.name) custByNameMap.set(String(c.name).trim().toLowerCase(), c);
          }
          const creditCache = new Map<string, { blocked: boolean; reason: string }>();
          const toUnblockIds: number[] = [];

          for (const ord of blockedOrderRows) {
            const matchedC = (ord.customer_id && custByIdMap.get(Number(ord.customer_id))) ||
                             (ord.customer_name && custByNameMap.get(String(ord.customer_name).trim().toLowerCase())) ||
                             { id: ord.customer_id || null, name: ord.customer_name || "", credit_limit: DEFAULT_CREDIT_LIMIT, credit_term_days: DEFAULT_CREDIT_TERM_DAYS };
            const cacheKey = `${matchedC.id || 0}:${String(matchedC.name || "").trim().toLowerCase()}`;
            let evalRes = creditCache.get(cacheKey);
            if (!evalRes) {
              evalRes = await evaluateCredit(matchedC, 0, null);
              creditCache.set(cacheKey, evalRes);
            }
            if (!evalRes.blocked) {
              ord.is_credit_blocked = false;
              ord.credit_block_reason = "";
              if (ord.id && !isNaN(Number(ord.id))) {
                toUnblockIds.push(Number(ord.id));
              }
            }
          }

          if (toUnblockIds.length > 0) {
            await query(
              "UPDATE sales_orders SET is_credit_blocked = FALSE, credit_block_reason = '' WHERE id = ANY($1::int[])",
              [toUnblockIds]
            );
          }
        } catch (err) {
          console.error("Failed to auto-reconcile stale credit blocks:", err);
        }
      }

      return NextResponse.json({
        slip_payments: slipPayments,
        customers: enrichedCustomers,
        orders: orders.rows,
        quotations: quotations.rows.map(normalizeQuotationRow),
        products: canSeeCost ? products.rows : stripCostFields(products.rows),
        targets: targets.rows,
        tasks: tasks.rows,
        plans: plans.rows,
        daily: daily.rows,
        reservations: reservations.rows,
        procurement_orders: openPOs.rows,
        contracts: await mergeContractsWithStorage(contractsRes.rows),
        rma_returns: rmaRes.rows,
        lot_recalls: recallsRes.rows,
        delivery_slips: slipsRes.rows.map(normalizeDeliverySlipRow),
        purchase_requests: prRes.rows,
      });
    }

    if (action === "customer_credit") {
      const customerId = searchParams.get("customer_id");
      const customerName = searchParams.get("customer_name");

      const custRes = await query(
        "SELECT * FROM sales_customers WHERE id = $1 OR name = $2 LIMIT 1",
        [numericIdOrNull(customerId), customerName || null]
      );
      if (custRes.rows.length === 0) {
        return NextResponse.json({ error: "Không tìm thấy khách hàng" }, { status: 404 });
      }

      const cust = custRes.rows[0];
      const { limit, termDays } = customerCreditTerms(cust);

      // Unpaid, not cancelled orders (công nợ tính theo Phiếu giao hàng đã giao thành công)
      const unpaidOrders = { rows: await openOrdersOfCustomer(cust) };

      const currentDebt = unpaidOrders.rows.reduce(
        (sum: number, o: any) => sum + Math.max(0, (parseFloat(o.delivered_amount) || 0) - (parseFloat(o.amount_paid) || 0)),
        0
      );
      const pendingOrderAmount = unpaidOrders.rows.reduce(
        (sum: number, o: any) => sum + Math.max(0, (parseFloat(o.total_amount) || 0) - (parseFloat(o.delivered_amount) || 0)),
        0
      );
      let isBlocked = false;
      let blockedReasons: string[] = [];
      let maxOverdueDays = 0;
      let overdueOrders: any[] = [];

      // Check overdue orders (payment term counted from the delivery date)
      for (const uo of unpaidOrders.rows) {
        const overdue = overdueDays(uo, termDays);
        if (overdue > 0) {
          if (overdue > maxOverdueDays) maxOverdueDays = overdue;
          overdueOrders.push({
            order_code: uo.order_code,
            order_date: uo.order_date,
            delivered_at: uo.due_start,
            total_amount: uo.total_amount,
            delivered_amount: uo.delivered_amount || 0,
            amount_paid: uo.amount_paid || 0,
            remaining_amount: Math.max(0, (parseFloat(uo.delivered_amount) || 0) - (parseFloat(uo.amount_paid) || 0)),
            overdue_days: overdue
          });
        }
      }

      if (currentDebt > limit) {
        isBlocked = true;
        blockedReasons.push(`Tổng nợ theo phiếu giao hàng (${currentDebt.toLocaleString('vi-VN', { maximumFractionDigits: 0 })} đ) đã vượt hạn mức cho phép (${limit.toLocaleString('vi-VN', { maximumFractionDigits: 0 })} đ)`);
      }

      if (overdueOrders.length > 0) {
        isBlocked = true;
        blockedReasons.push(`Có ${overdueOrders.length} đơn hàng quá hạn thanh toán (đơn trễ nhất quá hạn ${maxOverdueDays} ngày; quy định: tối đa ${termDays} ngày kể từ ngày giao)`);
      }

      return NextResponse.json({
        customer: cust,
        credit_limit: limit,
        credit_term_days: termDays,
        current_debt: currentDebt,
        pending_order_amount: pendingOrderAmount,
        is_blocked: isBlocked,
        blocked_reasons: blockedReasons,
        overdue_orders: overdueOrders,
        max_overdue_days: maxOverdueDays,
        special_price_list: cust.special_price_list || []
      });
    }

    if (action === "reservations") {
      const res = await query("SELECT * FROM inventory_reservations ORDER BY id DESC");
      return NextResponse.json({ reservations: res.rows });
    }

    if (action === "customers") {
      const res = await query("SELECT * FROM sales_customers ORDER BY id DESC");
      const enrichedCustomers = await enrichCustomerRowsWithContacts(res.rows);
      return NextResponse.json({ customers: enrichedCustomers });
    }

    if (action === "orders") {
      const res = await query("SELECT * FROM sales_orders ORDER BY id DESC");
      return NextResponse.json({ orders: res.rows });
    }

    if (action === "quotations") {
      const res = await query("SELECT * FROM sales_quotations ORDER BY id DESC");
      return NextResponse.json({ quotations: res.rows.map(normalizeQuotationRow) });
    }

    if (action === "contracts") {
      const res = await query("SELECT * FROM sales_contracts ORDER BY id DESC");
      return NextResponse.json({ contracts: await mergeContractsWithStorage(res.rows) });
    }

    if (action === "delivery_slips") {
      const res = await query("SELECT * FROM sales_delivery_slips ORDER BY id DESC");
      return NextResponse.json({ delivery_slips: res.rows.map(normalizeDeliverySlipRow) });
    }

    // Báo cáo lần đồng bộ dữ liệu cũ (đơn cần nhập số HĐ thật, cần duyệt giá / mở khóa lại, PO tạm đã hủy)
    if (action === "legacy_sync_report") {
      if (!isAdminUser(authUser)) return forbiddenResponse("Chỉ Quản trị viên xem được báo cáo đồng bộ.");
      const r = await query("SELECT data, updated_at FROM app_storage WHERE key = 'report_legacy_sales_sync_2026_10'");
      return NextResponse.json({ report: r.rows[0]?.data || null, updated_at: r.rows[0]?.updated_at || null });
    }

    // Tra cứu dòng hàng của nhiều chứng từ trên một trang: SO, PO, phiếu nhập kho, phiếu giao (xuất)
    if (action === "line_items") {
      const source = String(searchParams.get("source") || "so");
      const from = searchParams.get("from") || "";
      const to = searchParams.get("to") || "";
      const kw = String(searchParams.get("q") || "").trim().toLowerCase();
      const partnerKw = String(searchParams.get("partner") || "").trim().toLowerCase();
      const admin = isAdminUser(authUser);
      const can = (...keys: string[]) => admin || keys.some(k => hasPermission(authUser, k));
      const allowed: Record<string, boolean> = {
        so: can("sales.view", "warehouse.view"),
        px: can("sales.view", "warehouse.view"),
        po: can("procurement.view", "procurement.create_pr", "procurement.approve_po"),
        receipt: can("warehouse.view", "procurement.view"),
      };
      if (!(source in allowed)) return NextResponse.json({ error: "Nguồn chứng từ không hợp lệ" }, { status: 400 });
      if (!allowed[source]) return forbiddenResponse("Bạn không có quyền xem loại chứng từ này.");
      const showCost = canSeeCost || can("procurement.view", "procurement.approve_po");
      const asObj = (v: any): any => { if (v && typeof v === "object") return v; try { return JSON.parse(v || "{}"); } catch { return {}; } };
      const d10 = (v: any): string => {
        if (!v) return "";
        if (v instanceof Date) return toVNDateString(v);
        const t = String(v);
        const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
        if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
        return t.slice(0, 10);
      };
      const out: any[] = [];
      const push = (r: any) => {
        if (from && (!r.doc_date || r.doc_date < from)) return;
        if (to && (!r.doc_date || r.doc_date > to)) return;
        if (kw && ![r.product_code, r.product_name, r.doc_code, r.lot].some((v: any) => String(v || "").toLowerCase().includes(kw))) return;
        if (partnerKw && !String(r.partner || "").toLowerCase().includes(partnerKw)) return;
        out.push(r);
      };
      if (source === "so") {
        const rows = (await query("SELECT order_code, order_date, customer_name, sales_rep_name, items, delivery_status FROM sales_orders ORDER BY id DESC")).rows;
        for (const o of rows) for (const it of parseJsonArray(o.items)) {
          if (it?.status === "CANCELLED") continue;
          const qty = Number(it?.quantity) || 0; const price = Number(it?.unitPrice ?? it?.price) || 0;
          push({ doc_code: o.order_code, doc_date: d10(o.order_date), partner: o.customer_name, person: o.sales_rep_name, product_code: it?.productCode || it?.product_code, product_name: it?.productName || it?.product_name, unit: it?.unit || "", quantity: qty, unit_price: price, total: Math.round(qty * price), status: o.delivery_status });
        }
      } else if (source === "px") {
        const rows = (await query("SELECT slip_code, order_code, customer_name, items, delivery_date, status, extra_data, created_at FROM sales_delivery_slips ORDER BY id DESC")).rows;
        for (const sl of rows) {
          const ex = asObj(sl.extra_data);
          const st = String(ex.deliveryStatus || sl.status || "").toUpperCase();
          for (const it of parseJsonArray(sl.items)) {
            push({ doc_code: sl.slip_code, doc_date: d10(sl.delivery_date) || d10(sl.created_at), partner: sl.customer_name, ref: sl.order_code, product_code: it?.productCode || it?.product_code, product_name: it?.productName || it?.product_name, unit: it?.unit || "", quantity: Number(it?.quantity) || 0, lot: it?.lotNo || it?.lotNumber || it?.lot_number || "", expiry: it?.expiryDate || it?.expiry_date || "", status: st === "CANCELLED" ? "CANCELLED" : (ex.isDelivered === true || st === "DELIVERED" ? "DELIVERED" : "PENDING") });
          }
        }
      } else if (source === "po") {
        const rows = (await query("SELECT po_code, order_date, supplier_name, items, status, received_qty, supplier_invoices FROM procurement_orders ORDER BY id DESC")).rows;
        for (const po of rows) {
          const rec = asObj(po.received_qty);
          const invs = parseJsonArray(po.supplier_invoices).map((x: any) => x?.invoice_no).filter(Boolean).join(", ");
          parseJsonArray(po.items).forEach((it: any, i: number) => {
            const qty = Number(it?.quantity) || 0; const price = Number(it?.unit_price ?? it?.price) || 0;
            push({ doc_code: po.po_code, doc_date: d10(po.order_date), partner: po.supplier_name, product_code: it?.product_code, product_name: it?.product_name, unit: it?.unit || "", quantity: qty, received: Number(rec[i] ?? rec[String(i)]) || 0, unit_price: showCost ? price : null, total: showCost ? Math.round(qty * price) : null, status: po.status, ref: invs, customer: it?.target_customer || "" });
          });
        }
      } else {
        const rows = (await query("SELECT transaction_code, transaction_type, reference_code, date, performed_by, warehouse_name, items, notes FROM inventory_transactions WHERE transaction_type = 'INBOUND' ORDER BY date DESC, id DESC")).rows;
        for (const t of rows) {
          const partner = String(t.notes || "").match(/NCC:\s*([^•]+?)\s*(?:•|$)/)?.[1] || "";
          for (const it of parseJsonArray(t.items)) {
            push({ doc_code: t.transaction_code, doc_date: d10(t.date), partner, person: t.performed_by, ref: t.reference_code, product_code: it?.product_code || it?.productCode, product_name: it?.product_name || it?.productName, unit: it?.unit || "", quantity: Number(it?.quantity ?? it?.qty) || 0, lot: it?.lot_number || it?.lotNumber || "", expiry: it?.expiry_date || it?.expiryDate || "", status: t.warehouse_name || "" });
          }
        }
      }
      const limited = out.slice(0, 5000);
      return NextResponse.json({ rows: limited, truncated: out.length > limited.length, total_rows: out.length, show_cost: source === "po" ? showCost : true });
    }

    // Công nợ phải thu theo khách hàng (Kế toán / Quản trị): giá trị hàng ĐÃ GIAO - đã thu, hạn = ngày giao + số ngày nợ của khách
    if (action === "customer_debt") {
      if (!isAccountantUser(authUser)) {
        return forbiddenResponse("Chỉ Kế toán / Quản trị viên xem được công nợ khách hàng.");
      }
      const [ordRes, custRes, slipRes, payRes] = await Promise.all([
        query(`SELECT id, order_code, order_date, customer_id, customer_name, sales_rep_name, items, total_amount, COALESCE(amount_paid, 0) AS amount_paid,
                      delivery_status, delivered_at, invoice_no, invoice_status, payment_status, notes
                 FROM sales_orders
                WHERE COALESCE(delivery_status, '') <> 'CANCELLED' AND COALESCE(applied_price_policy, '') <> 'STOCK'`),
        query("SELECT id, customer_code, name, tax_code, credit_limit, credit_term_days FROM sales_customers"),
        query("SELECT slip_code, order_code, items, status, extra_data FROM sales_delivery_slips"),
        query("SELECT id, order_code, amount, payment_date, method, reference, delivery_slip_code, created_by, voided_at, voided_by, void_reason FROM sales_payments ORDER BY payment_date DESC, id DESC")
      ]);
      const asObj = (v: any): any => { if (v && typeof v === "object") return v; try { return JSON.parse(v || "{}"); } catch { return {}; } };
      const itemCode = (it: any) => String(it?.productCode || it?.product_code || "").trim();
      const custById = new Map<number, any>(custRes.rows.map((c: any) => [c.id, c]));
      const custByName = new Map<string, any>(custRes.rows.map((c: any) => [String(c.name || "").trim().toLowerCase(), c]));
      const slipsByOrder = new Map<string, any[]>();
      for (const sl of slipRes.rows) {
        const k = String(sl.order_code || ""); if (!k) continue;
        if (!slipsByOrder.has(k)) slipsByOrder.set(k, []);
        slipsByOrder.get(k)!.push(sl);
      }
      const paysByOrder = new Map<string, any[]>();
      for (const py of payRes.rows) {
        const k = String(py.order_code || "");
        if (!paysByOrder.has(k)) paysByOrder.set(k, []);
        paysByOrder.get(k)!.push(py);
      }
      const today = new Date(todayVN() + "T00:00:00");
      const customers = new Map<string, any>();
      for (const o of ordRes.rows) {
        const items = parseJsonArray(o.items).filter((it: any) => it?.status !== "CANCELLED");
        const unit = (code: string) => { const it = items.find((x: any) => itemCode(x) === code); return Number(it?.unitPrice ?? it?.price) || 0; };
        const total = Number(o.total_amount) || 0;
        const st = String(o.delivery_status || "").toUpperCase();
        let delivered = 0;
        let anySlip = false;
        for (const sl of slipsByOrder.get(String(o.order_code)) || []) {
          const ex = asObj(sl.extra_data);
          if (String(ex.deliveryStatus || sl.status || "").toUpperCase() === "CANCELLED") continue;
          const isDel = ex.isDelivered === true || ex.isDelivered === "true" || String(ex.deliveryStatus || "").toUpperCase() === "DELIVERED";
          if (!isDel) continue;
          anySlip = true;
          delivered += parseJsonArray(sl.items).reduce((s: number, it: any) => s + (Number(it?.quantity) || 0) * (Number(it?.unitPrice ?? it?.price) || unit(itemCode(it))), 0);
        }
        if (!anySlip && st === "DELIVERED") delivered = total;
        delivered = Math.min(Math.round(delivered), total || Math.round(delivered));
        const paid = Number(o.amount_paid) || 0;
        if (delivered <= 0 && paid <= 0) continue; // chưa giao, chưa thu/cọc: chưa phát sinh công nợ hay tiền cọc
        const cust = (o.customer_id && custById.get(o.customer_id)) || custByName.get(String(o.customer_name || "").trim().toLowerCase()) || null;
        const term = cust?.credit_term_days !== undefined && cust?.credit_term_days !== null ? Number(cust.credit_term_days) : 30;
        const actualDebt = Math.max(0, Math.round(delivered - paid));
        const prepaid = Math.max(0, Math.round(paid - delivered));
        const remainingOrder = Math.max(0, Math.round(total - paid));
        const outstanding = actualDebt;
        const deliveredAt = o.delivered_at ? toVNDateString(o.delivered_at) : null;
        let dueDate: string | null = null;
        let overdueDays = 0;
        if (deliveredAt) {
          const d = new Date(deliveredAt + "T00:00:00");
          d.setDate(d.getDate() + term);
          dueDate = toVNDateString(d);
          overdueDays = Math.max(0, Math.floor((today.getTime() - d.getTime()) / 86400000));
        }
        const key = cust ? `C${cust.id}` : `N${String(o.customer_name || "").trim().toLowerCase()}`;
        if (!customers.has(key)) {
          customers.set(key, {
            customer_id: cust?.id || null, customer_code: cust?.customer_code || "", customer_name: cust?.name || o.customer_name,
            tax_code: cust?.tax_code || "", credit_limit: Number(cust?.credit_limit) || 0, credit_term_days: term,
            order_total: 0, delivered: 0, paid: 0, outstanding: 0, prepaid: 0, remaining_order: 0, overdue: 0,
            aging: { current: 0, d1_30: 0, d31_60: 0, d60_plus: 0 }, max_overdue_days: 0, orders: []
          });
        }
        const c = customers.get(key);
        c.order_total += total; c.delivered += delivered; c.paid += paid; c.outstanding += outstanding; c.prepaid += prepaid; c.remaining_order += remainingOrder;
        if (outstanding > 0) {
          if (overdueDays <= 0) c.aging.current += outstanding;
          else if (overdueDays <= 30) c.aging.d1_30 += outstanding;
          else if (overdueDays <= 60) c.aging.d31_60 += outstanding;
          else c.aging.d60_plus += outstanding;
          if (overdueDays > 0) c.overdue += outstanding;
          c.max_overdue_days = Math.max(c.max_overdue_days, overdueDays);
        }
        c.orders.push({
          order_code: o.order_code, order_date: o.order_date ? toVNDateString(o.order_date) : null, sales_rep_name: o.sales_rep_name,
          total, delivered, paid, outstanding, prepaid, remaining_order: remainingOrder, delivery_status: st, delivered_at: deliveredAt, due_date: dueDate,
          overdue_days: outstanding > 0 ? overdueDays : 0, invoice_no: o.invoice_no, payment_status: o.payment_status,
          payments: (paysByOrder.get(String(o.order_code)) || []).map((py: any) => ({
            id: py.id, amount: Number(py.amount) || 0, date: py.payment_date ? toVNDateString(py.payment_date) : null,
            method: py.method, reference: py.reference, slip: py.delivery_slip_code, by: py.created_by,
            voided: Boolean(py.voided_at), voided_by: py.voided_by, void_reason: py.void_reason
          }))
        });
      }
      const rows = Array.from(customers.values()).sort((a, b) => (b.outstanding - a.outstanding) || (b.prepaid - a.prepaid));
      return NextResponse.json({ customers: rows, generated_at: new Date().toISOString() });
    }

    // Dòng thời gian hoạt động của MỘT khách hàng (cho BGĐ theo dõi sale chăm sóc khách):
    // báo giá, hợp đồng, đơn, giao hàng, hóa đơn, thu tiền, trả hàng, phiếu phối hợp, công việc, lịch tuần, nhật ký, cơ hội, yêu cầu App.
    // Quyền: Quản trị / người duyệt đơn (sales.approve_orders) xem mọi khách; sale chỉ xem khách mình phụ trách.
    if (action === "customer_activity") {
      const custId = numericIdOrNull(searchParams.get("customer_id"));
      const custNameParam = String(searchParams.get("customer_name") || "").trim();
      const cust = (await query(
        "SELECT id, customer_code, name, sales_rep_id, sales_rep_name FROM sales_customers WHERE ($1::int IS NOT NULL AND id = $1::int) OR ($1::int IS NULL AND LOWER(TRIM(name)) = LOWER(TRIM($2))) LIMIT 1",
        [custId, custNameParam]
      )).rows[0] || (custNameParam ? { id: null, customer_code: "", name: custNameParam, sales_rep_id: null, sales_rep_name: null } : null);
      if (!cust) return NextResponse.json({ error: "Không tìm thấy khách hàng" }, { status: 404 });
      const norm = (v: any) => String(v || "").trim().toLowerCase().replace(/\s+/g, " ");
      const myName = norm((authUser as any).full_name || (authUser as any).username);
      const seeAll = isAdminUser(authUser) || hasPermission(authUser, "sales.approve_orders");
      const isMine = (cust.sales_rep_name && norm(cust.sales_rep_name) === myName) || (cust.sales_rep_id && norm(cust.sales_rep_id) === norm((authUser as any).username));
      if (!seeAll && !isMine) return forbiddenResponse("Bạn chỉ xem được hoạt động của khách hàng mình phụ trách.");

      const cName = norm(cust.name);
      const cCode = norm(cust.customer_code);
      const sameCust = (name: any, id?: any) => Boolean((cust.id && id && Number(id) === Number(cust.id)) || (cName && norm(name) === cName));
      // văn bản tự do (nhật ký, lịch tuần...): chứa tên (đủ dài để tránh trùng) hoặc mã khách
      const mentions = (text: any) => {
        const t = norm(typeof text === "string" ? text : JSON.stringify(text || ""));
        return (cName.length >= 6 && t.includes(cName)) || (cCode.length >= 4 && t.includes(cCode));
      };
      const day = (v: any): string | null => {
        if (!v) return null;
        if (v instanceof Date) return toVNDateString(v);
        const s = String(v);
        const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
        if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
        const d = new Date(s);
        return isNaN(d.getTime()) ? s.slice(0, 10) : toVNDateString(d);
      };
      const items: any[] = [];
      const add = (x: any) => items.push({ ...x, date: x.date || null });
      const safe = (p: Promise<any>) => p.catch(() => ({ rows: [] as any[] }));

      const [qRes, cRes, oRes, sRes, pRes, rRes, wRes, tRes, stRes, dRes, tcRes, plRes, storeRes] = await Promise.all([
        safe(query("SELECT quote_code, customer_id, customer_name, sales_rep_name, date, total_amount, status, created_at FROM sales_quotations")),
        safe(query("SELECT contract_code, customer_id, customer_name, sales_rep_name, title, sign_date, total_value, status, created_at FROM sales_contracts")),
        safe(query("SELECT order_code, customer_id, customer_name, sales_rep_name, order_date, total_amount, delivery_status, invoiced_delivery_slips, created_at FROM sales_orders")),
        safe(query("SELECT slip_code, order_code, customer_name, delivery_date, status, extra_data, created_at FROM sales_delivery_slips")),
        safe(query("SELECT p.order_code, p.amount, p.payment_date, p.method, p.created_by, p.delivery_slip_code, o.customer_id, o.customer_name FROM sales_payments p JOIN sales_orders o ON o.id = p.order_id WHERE p.voided_at IS NULL")),
        safe(query("SELECT rma_code, order_code, customer_id, customer_name, total_amount, status, created_at FROM rma_returns")),
        safe(query("SELECT workflow_code, title, status, requester_name, assignee_name, target_dept, customer_name, created_at FROM workflow_requests")),
        safe(query("SELECT task_code, title, assignee_name, customer_name, status, deadline, result, created_at FROM company_tasks")),
        safe(query("SELECT task_code, title, assignee_name, customer_name, status, deadline, created_at FROM sales_tasks")),
        safe(query("SELECT log_date, employee_name, work_content, result FROM sales_daily_logs")),
        safe(query("SELECT id, customer_id, customer_name, activity_type, activity_date, content, performed_by, next_followup_date FROM tech_care_logs")),
        safe(query("SELECT week_number, year, employee_name, plan_data, status FROM sales_plans")),
        safe(query("SELECT key, data FROM app_storage WHERE key IN ('sales_deals_pipeline', 'unified_weekly_schedule', 'shared_app_requests', 'sales_specialized_plans', 'sales_daily_logs', 'sales_plans', 'sales_tasks')"))
      ]);
      for (const r of qRes.rows) if (sameCust(r.customer_name, r.customer_id)) add({ type: "quotation", date: day(r.date || r.created_at), code: r.quote_code, title: "Báo giá", amount: Number(r.total_amount) || 0, status: r.status, person: r.sales_rep_name });
      for (const r of cRes.rows) if (sameCust(r.customer_name, r.customer_id)) add({ type: "contract", date: day(r.sign_date || r.created_at), code: r.contract_code, title: r.title || "Hợp đồng", amount: Number(r.total_value) || 0, status: r.status, person: r.sales_rep_name });
      const custOrders = new Set<string>();
      for (const r of oRes.rows) if (sameCust(r.customer_name, r.customer_id)) {
        custOrders.add(String(r.order_code));
        add({ type: "order", date: day(r.order_date || r.created_at), code: r.order_code, title: "Đơn hàng", amount: Number(r.total_amount) || 0, status: r.delivery_status, person: r.sales_rep_name });
        for (const inv of parseJsonArray(r.invoiced_delivery_slips)) {
          if (inv?.invoice_no) add({ type: "invoice", date: day(inv.invoice_date), code: String(inv.invoice_no), title: `Hóa đơn (đơn ${r.order_code}${inv.delivery_slip_id ? `, phiếu ${inv.delivery_slip_id}` : ""})`, amount: Number(inv.invoice_amount) || 0, status: "ISSUED" });
        }
      }
      for (const r of sRes.rows) if (custOrders.has(String(r.order_code)) || sameCust(r.customer_name)) {
        let ex: any = r.extra_data;
        if (typeof ex === "string") { try { ex = JSON.parse(ex); } catch { ex = {}; } }
        add({ type: "delivery", date: day(ex?.deliveredAt || r.delivery_date || r.created_at), code: r.slip_code, title: `Phiếu giao (đơn ${r.order_code || ""})`, status: ex?.deliveryStatus || r.status, person: ex?.dispatcherName || ex?.creatorName || null });
      }
      for (const r of pRes.rows) if (sameCust(r.customer_name, r.customer_id)) add({ type: "payment", date: day(r.payment_date), code: r.order_code, title: `Thu tiền${r.delivery_slip_code ? ` (phiếu ${r.delivery_slip_code})` : ""}${r.method ? ` · ${r.method}` : ""}`, amount: Number(r.amount) || 0, person: r.created_by });
      for (const r of rRes.rows) if (sameCust(r.customer_name, r.customer_id)) add({ type: "rma", date: day(r.created_at), code: r.rma_code, title: `Trả hàng (đơn ${r.order_code || ""})`, amount: Number(r.total_amount) || 0, status: r.status });
      for (const r of tcRes.rows) if (sameCust(r.customer_name, r.customer_id)) add({ type: "tech_care", date: day(r.activity_date), code: `CSKT-${r.id}`, title: `${r.activity_type}: ${String(r.content || "").slice(0, 200)}`, person: r.performed_by, extra: r.next_followup_date ? `Hẹn chăm sóc tiếp: ${day(r.next_followup_date)}` : undefined });
      for (const r of wRes.rows) if (sameCust(r.customer_name)) add({ type: "workflow", date: day(r.created_at), code: r.workflow_code, title: r.title, status: r.status, person: r.requester_name, extra: r.assignee_name ? `Phụ trách: ${r.assignee_name}` : r.target_dept });
      for (const r of tRes.rows) if (sameCust(r.customer_name)) add({ type: "task", date: day(r.created_at || r.deadline), code: r.task_code, title: r.title, status: r.status, person: r.assignee_name, extra: r.result || null });
      for (const r of stRes.rows) if (sameCust(r.customer_name)) add({ type: "task", date: day(r.created_at || r.deadline), code: r.task_code, title: r.title, status: r.status, person: r.assignee_name });
      for (const r of dRes.rows) if (mentions([r.work_content, r.result])) add({ type: "daily", date: day(r.log_date), title: String(r.work_content || "").slice(0, 300), person: r.employee_name, extra: r.result ? String(r.result).slice(0, 200) : null });
      for (const r of plRes.rows) if (mentions(r.plan_data)) add({ type: "plan", date: null, title: `Kế hoạch tuần ${r.week_number}/${r.year}`, status: r.status, person: r.employee_name });
      // Dữ liệu lưu dạng danh sách (cơ hội bán hàng, lịch tuần, yêu cầu App, kế hoạch chuyên đề...)
      const LABEL: Record<string, string> = { sales_deals_pipeline: "deal", unified_weekly_schedule: "schedule", shared_app_requests: "app_request", sales_specialized_plans: "plan", sales_daily_logs: "daily", sales_plans: "plan", sales_tasks: "task" };
      for (const row of storeRes.rows) {
        for (const e of parseJsonArray(row.data)) {
          if (!e || typeof e !== "object") continue;
          const structured = e.customerName || e.customer_name || e.customer || e.hospital;
          const hit = structured ? (sameCust(structured, e.customerId || e.customer_id) || mentions(structured)) : mentions(e);
          if (!hit) continue;
          const codeVal = e.code || e.task_code || e.dealCode || (e.id && String(e.id).length < 30 ? String(e.id) : undefined);
          add({
            type: LABEL[row.key] || "other",
            date: day(e.date || e.log_date || e.createdAt || e.created_at || e.deadline || e.dueDate || e.due_date || e.expectedCloseDate),
            code: codeVal ? String(codeVal) : undefined,
            title: String(e.title || e.name || e.work_content || e.content || e.description || "").slice(0, 300),
            status: e.status || e.stage || null,
            amount: Number(e.value || e.amount || e.estimatedValue) || undefined,
            person: e.owner || e.salesRepName || e.sales_rep_name || e.assignee || e.assignee_name || e.actor || e.employee_name || e.requester || e.requester_name || null
          });
        }
      }
      items.sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
      return NextResponse.json({ customer: { id: cust.id, code: cust.customer_code, name: cust.name, sales_rep_name: cust.sales_rep_name }, items });
    }

    // Kiểm tra toàn vẹn dữ liệu đơn hàng (Quản trị): mã đơn trùng, phiếu giao lệch khách, hóa đơn trỏ sang phiếu của đơn khác
    if (action === "order_integrity_report") {
      if (!isAdminUser(authUser)) return forbiddenResponse("Chỉ Quản trị viên xem được báo cáo kiểm tra dữ liệu.");
      const norm = (v: any) => String(v || "").trim().toLowerCase().replace(/\s+/g, " ");
      const [dupRes, ordRes, slipRes, blobRes] = await Promise.all([
        query(`SELECT order_code, COUNT(*)::int AS n, string_agg(DISTINCT customer_name, ' | ') AS customers
                 FROM sales_orders WHERE order_code IS NOT NULL GROUP BY order_code HAVING COUNT(*) > 1 ORDER BY order_code`),
        query("SELECT id, order_code, customer_name, invoiced_delivery_slips FROM sales_orders"),
        query("SELECT slip_code, order_code, customer_name, status, extra_data FROM sales_delivery_slips"),
        query("SELECT data FROM app_storage WHERE key = 'sales_factory_orders'")
      ]);
      const ordByCode = new Map<string, any>(ordRes.rows.map((o: any) => [String(o.order_code), o]));
      const slipByCode = new Map<string, any>(slipRes.rows.map((s: any) => [String(s.slip_code), s]));
      const slipCustomerMismatch = slipRes.rows
        .filter((s: any) => { const o = ordByCode.get(String(s.order_code || "")); return o && s.customer_name && o.customer_name && norm(s.customer_name) !== norm(o.customer_name); })
        .map((s: any) => ({ slip_code: s.slip_code, order_code: s.order_code, slip_customer: s.customer_name, order_customer: ordByCode.get(String(s.order_code))?.customer_name }));
      const blobCodes = new Set(parseJsonArray(blobRes.rows[0]?.data).flatMap((fo: any) => [fo?.order_code, fo?.id].filter(Boolean).map(String)));
      const slipsWithoutOrder = slipRes.rows.filter((s: any) => s.order_code && !ordByCode.has(String(s.order_code))).map((s: any) => ({ slip_code: s.slip_code, order_code: s.order_code, customer: s.customer_name, in_screen_copy: blobCodes.has(String(s.order_code)) }));
      const invoiceWrongSlip: any[] = [];
      for (const o of ordRes.rows) {
        for (const r of parseJsonArray(o.invoiced_delivery_slips)) {
          const sl = slipByCode.get(String(r?.delivery_slip_id || ""));
          if (sl && String(sl.order_code || "") !== String(o.order_code)) {
            invoiceWrongSlip.push({ order_code: o.order_code, invoice_no: r.invoice_no, delivery_slip_id: r.delivery_slip_id, slip_order_code: sl.order_code });
          }
        }
      }
      // Bản sao trên màn hình (app_storage) có cùng mã đơn nhưng khác khách hàng với CSDL
      const blob = parseJsonArray(blobRes.rows[0]?.data);
      const blobMismatch = blob
        .map((fo: any) => ({ code: String(fo?.order_code || fo?.id || ""), customer: fo?.customerName || fo?.customer_name }))
        .filter((x: any) => { const o = ordByCode.get(x.code); return o && x.customer && o.customer_name && norm(x.customer) !== norm(o.customer_name); })
        .map((x: any) => ({ order_code: x.code, screen_customer: x.customer, db_customer: ordByCode.get(x.code)?.customer_name }));
      return NextResponse.json({
        duplicate_order_codes: dupRes.rows,
        slip_customer_mismatch: slipCustomerMismatch,
        slips_without_order: slipsWithoutOrder,
        invoice_on_other_orders_slip: invoiceWrongSlip,
        screen_copy_customer_mismatch: blobMismatch
      });
    }

    // Hóa đơn theo phiếu giao đã lưu số tiền lớn hơn giá trị phiếu: màn xuất HĐ cũ cộng VAT lên đơn giá đã gồm VAT
    if (action === "invoice_amount_check") {
      if (!isAccountantUser(authUser)) return forbiddenResponse("Chỉ Kế toán / Quản trị viên xem được báo cáo này.");
      const orders = (await query(
        "SELECT order_code, customer_name, total_amount, items, invoiced_delivery_slips FROM sales_orders WHERE jsonb_array_length(COALESCE(invoiced_delivery_slips, '[]'::jsonb)) > 0"
      )).rows;
      const slipRows = (await query("SELECT slip_code, items FROM sales_delivery_slips")).rows;
      const slipItems = new Map<string, any[]>(slipRows.map((r: any) => [r.slip_code, parseJsonArray(r.items)]));
      const out: any[] = [];
      for (const o of orders) {
        const oItems = parseJsonArray(o.items);
        const price = (code: string) => {
          const it = oItems.find((x: any) => String(x?.productCode || x?.product_code || "") === code);
          return Number(it?.unitPrice ?? it?.price) || 0;
        };
        for (const inv of parseJsonArray(o.invoiced_delivery_slips)) {
          const items = slipItems.get(inv.delivery_slip_id) || [];
          const picked = Array.isArray(inv.invoiced_items) && inv.invoiced_items.length > 0 ? new Set(inv.invoiced_items.map((x: any) => String(x?.code || x?.productCode || x?.product_code || x))) : null;
          const expected = Math.round(items
            .filter((it: any) => !picked || picked.has(String(it?.productCode || it?.product_code || "")))
            .reduce((s: number, it: any) => s + (Number(it.quantity) || 0) * (Number(it.unitPrice ?? it.price) || price(String(it?.productCode || it?.product_code || ""))), 0));
          const amount = Number(inv.invoice_amount) || 0;
          if (expected > 0 && amount > expected + 1) {
            out.push({ order_code: o.order_code, customer_name: o.customer_name, delivery_slip_id: inv.delivery_slip_id, invoice_no: inv.invoice_no, invoice_amount: amount, expected_amount: expected, difference: amount - expected });
          }
        }
      }
      return NextResponse.json({ count: out.length, rows: out });
    }

    if (action === "generate_code") {
      const type = (searchParams.get("type") || "SO").toUpperCase() as any;
      const rep = searchParams.get("rep") || searchParams.get("sales_rep") || "";
      const cust = searchParams.get("cust") || searchParams.get("customer") || "";
      const custCode = searchParams.get("cust_code") || "";
      const tagMode = (searchParams.get("tag_mode") || "CUSTOMER") as any;

      const code = await generateDocumentCode({
        docType: type,
        salesRepName: rep,
        customerName: cust,
        customerCode: custCode,
        tagMode: tagMode
      });
      return NextResponse.json({ code });
    }

    return NextResponse.json({ error: "Hành động không hợp lệ" }, { status: 400 });
  } catch (error: any) {
    console.error("Sales API GET Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    // Phiên phải còn hiệu lực (tài khoản chưa bị khóa, mật khẩu chưa đổi): proxy chỉ kiểm tra chữ ký cookie
    const authUser = await getAuthorizedUser(req);
    if (!authUser) return unauthorizedResponse();
    setAuditActor(authUser);
    // Ghi dữ liệu Kinh doanh: người dùng phân hệ Kinh doanh / Kho (giao hàng); thao tác nhạy cảm cần quyền riêng
    const salesAdmin = isAdminUser(authUser);
    if (!salesAdmin && !hasPermission(authUser, "sales.view") && !hasPermission(authUser, "warehouse.view")) {
      return forbiddenResponse("Bạn không có quyền thao tác dữ liệu Kinh doanh.");
    }
    const SALES_ACTION_PERMISSIONS: Record<string, string[]> = {
      update_product_price: ["sales.approve_discount"],
      product_price: ["sales.approve_discount"],
      product: ["sales.approve_discount"],
      delete_customer: ["sales.delete"],
      delete_quotation: ["sales.delete"],
      delete_contract: ["sales.delete"],
      delete_delivery_slip: ["sales.delete", "sales.edit_delivery_slips"],
      approve_rma: ["sales.approve_discount"],
      reject_rma: ["sales.approve_discount"],
    };
    const salesNeeded = SALES_ACTION_PERMISSIONS[new URL(req.url).searchParams.get("action") || ""];
    if (salesNeeded && !salesAdmin && !salesNeeded.some(k => hasPermission(authUser, k))) {
      return forbiddenResponse("Bạn không có quyền thực hiện thao tác này (cần quyền duyệt giá / xóa chứng từ).");
    }
    const { searchParams } = new URL(req.url);
    const action = searchParams.get("action");
    const body = await req.json();

    if (action === "customer") {
      const { id, customer_code, name, customer_name, contact_person, contact_position, phone, email, address, tax_code, sales_rep_id, sales_rep_name, classification, industry, payment_terms, notes, credit_limit, credit_term_days, customer_type, special_price_list, region, province } = body;
      const custName = (name || customer_name || "").trim();
      // Hạn mức / số ngày công nợ là chốt chặn tín dụng: chỉ Kế toán / Quản trị viên được đặt hoặc đổi
      const canSetCredit = isAccountantUser(authUser);
      const cLimit = canSetCredit && parseFloat(credit_limit) >= 0 ? parseFloat(credit_limit) : DEFAULT_CREDIT_LIMIT;
      const cTerm = canSetCredit && parseInt(credit_term_days) >= 0 ? parseInt(credit_term_days) : DEFAULT_CREDIT_TERM_DAYS;
      const cType = customer_type || "END_USER";
      const sPriceList = Array.isArray(special_price_list) ? JSON.stringify(special_price_list) : "[]";

      // Địa chỉ thuế (xuất hóa đơn) & Địa chỉ giao/nhận hàng (delivery_address) - cột bổ sung, tự tạo nếu chưa có
      const saveTaxAddress = async (custId: number | null | undefined) => {
        if (!custId) return;
        try {
          if (!customerTaxAddressColumnEnsured) {
            await query("ALTER TABLE sales_customers ADD COLUMN IF NOT EXISTS tax_address TEXT");
            await query("ALTER TABLE sales_customers ADD COLUMN IF NOT EXISTS delivery_address TEXT");
            customerTaxAddressColumnEnsured = true;
          }
          if (body.tax_address !== undefined) {
            await query("UPDATE sales_customers SET tax_address = $1 WHERE id = $2", [body.tax_address || null, custId]);
          }
          if (body.delivery_address !== undefined || body.deliveryAddress !== undefined) {
            await query("UPDATE sales_customers SET delivery_address = $1 WHERE id = $2", [(body.delivery_address ?? body.deliveryAddress) || null, custId]);
          }
        } catch (err) {
          console.error("Failed to save sales_customers.tax_address/delivery_address:", err);
        }
      };

      if (id && !isNaN(Number(id))) {
        // Chỉ cập nhật các trường form thực sự gửi lên: trường không gửi (ví dụ Ghi chú, Điều khoản thanh toán)
        // giữ nguyên giá trị cũ thay vì bị ghi đè thành rỗng.
        const has = (k: string) => Object.prototype.hasOwnProperty.call(body, k) && body[k] !== undefined;
        const sets: string[] = [];
        const params: any[] = [];
        const set = (col: string, val: any, cast = "") => { params.push(val); sets.push(`${col} = $${params.length}${cast}`); };
        if (!canSetCredit && (has("credit_limit") || has("credit_term_days"))) {
          // Form gửi lại nguyên giá trị cũ thì bỏ qua; muốn đổi thật thì báo rõ thay vì lặng lẽ không lưu
          const cur = (await query("SELECT credit_limit, credit_term_days FROM sales_customers WHERE id = $1", [Number(id)])).rows[0];
          const limitChanged = has("credit_limit") && cur && Math.abs((parseFloat(credit_limit) || 0) - (parseFloat(cur.credit_limit) || 0)) > 0.5;
          const termChanged = has("credit_term_days") && cur && (parseInt(credit_term_days) || 0) !== (parseInt(cur.credit_term_days) || 0);
          if (limitChanged || termChanged) {
            return forbiddenResponse("Chỉ Kế toán / Quản trị viên được thay đổi hạn mức và số ngày công nợ của khách hàng.");
          }
        }
        if (has("name") || has("customer_name")) set("name", custName);
        if (has("contact_person")) set("contact_person", contact_person);
        if (has("contact_position")) set("contact_position", contact_position);
        if (has("phone")) set("phone", phone);
        if (has("email")) set("email", email);
        if (has("address")) set("address", address);
        if (has("tax_code")) set("tax_code", tax_code);
        if (has("sales_rep_id")) set("sales_rep_id", sales_rep_id);
        if (has("sales_rep_name")) set("sales_rep_name", sales_rep_name);
        if (has("classification")) set("classification", classification);
        if (has("payment_terms")) set("payment_terms", payment_terms);
        if (has("notes")) set("notes", notes);
        if (has("credit_limit") && canSetCredit) set("credit_limit", cLimit);
        if (has("credit_term_days") && canSetCredit) set("credit_term_days", cTerm);
        if (has("customer_type")) set("customer_type", cType);
        if (has("special_price_list")) set("special_price_list", sPriceList, "::jsonb");
        if (has("region")) set("region", region || null);
        if (has("province")) set("province", province || null);
        if (has("industry")) set("industry", industry || null);
        if (has("customer_code") && String(customer_code).trim()) {
          const clash = await query("SELECT id, name FROM sales_customers WHERE customer_code = $1 AND id <> $2", [String(customer_code).trim(), Number(id)]);
          if (clash.rows.length > 0) {
            return NextResponse.json({ error: `Mã khách hàng ${customer_code} đã được dùng cho "${clash.rows[0].name}".` }, { status: 409 });
          }
          set("customer_code", String(customer_code).trim());
        }
        if (sets.length > 0) {
          params.push(Number(id));
          await query(`UPDATE sales_customers SET ${sets.join(", ")} WHERE id = $${params.length}`, params);
        }
        await saveTaxAddress(Number(id));
        await logAudit("UPDATE", "SALES_CUSTOMER", `Cập nhật khách hàng ${custName} (${customer_code || id}) - Khu vực: ${region || "Chưa rõ"}, Tỉnh thành: ${province || "Chưa rõ"}`);
        return NextResponse.json({ success: true, id: Number(id) });
      } else {
        // Tạo mới: mã trùng phải báo lỗi chứ không được ghi đè lên khách hàng khác đang dùng mã đó
        let code = String(customer_code || "").trim();
        if (code) {
          const clash = await query("SELECT id, name FROM sales_customers WHERE customer_code = $1", [code]);
          if (clash.rows.length > 0) {
            return NextResponse.json({ error: `Mã khách hàng ${code} đã tồn tại (${clash.rows[0].name}). Vui lòng dùng mã khác hoặc mở hồ sơ hiện có để sửa.`, existing_id: clash.rows[0].id }, { status: 409 });
          }
        } else {
          code = await generateDocumentCode({ docType: "KH", customerName: custName, salesRepName: sales_rep_name, tagMode: "GENERAL" } as any)
            .catch(() => `KH-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`);
        }
        const insRes = await query(
          `INSERT INTO sales_customers (customer_code, name, contact_person, contact_position, phone, email, address, tax_code, sales_rep_id, sales_rep_name, classification, payment_terms, notes, credit_limit, credit_term_days, customer_type, special_price_list, region, province, industry)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17::jsonb, $18, $19, $20)
           RETURNING id, customer_code, name`,
          [code, custName, contact_person, contact_position, phone, email, address, tax_code, sales_rep_id, sales_rep_name, classification, payment_terms, notes, cLimit, cTerm, cType, sPriceList, region || null, province || null, industry || null]
        );
        await saveTaxAddress(insRes.rows[0]?.id);
        await logAudit("SAVE", "SALES_CUSTOMER", `Lưu khách hàng ${custName} (${code})`);
        return NextResponse.json({ success: true, customer: insRes.rows[0], id: insRes.rows[0]?.id });
      }
    }

    if (action === "delete_customer") {
      const { id, customer_code } = body;
      const openCount = await openOrderCountForCustomer(id && !isNaN(Number(id)) ? id : (customer_code || id));
      if (openCount > 0) {
        return NextResponse.json({ error: `Khách hàng còn ${openCount} đơn hàng chưa thanh toán xong, không thể xóa (sẽ mất kiểm soát công nợ).` }, { status: 409 });
      }
      if (id && !isNaN(Number(id))) {
        await query("DELETE FROM sales_customers WHERE id = $1", [Number(id)]);
      } else if (id || customer_code) {
        await query("DELETE FROM sales_customers WHERE customer_code = $1 OR id = $2", [customer_code || id, isNaN(Number(id)) ? null : Number(id)]);
      }
      await logAudit("DELETE", "SALES_CUSTOMER", `Xóa khách hàng ID/Mã: ${id || customer_code}`);
      return NextResponse.json({ success: true });
    }

    if (action === "delivery_slip") {
      const {
        id, slip_code, order_id, orderId, order_code, orderCode,
        customer_name, customerName, customer_address, customerAddress,
        customer_phone, customerPhone, customer_contact, customerContact,
        delivery_date, deliveryDate, timeliness, dispatch_location, dispatchLocation,
        dispatcher_name, dispatcherName, dispatcher_phone, dispatcherPhone,
        creator_name, creatorName, notes, items, invoice_number, invoiceNumber,
        invoice_date, invoiceDate, status
      } = body;

      const finalCode = slip_code || id || `PX-${Date.now()}`;
      const oId = order_id || orderId || null;
      const oCode = order_code || orderCode || null;
      const cName = customer_name || customerName || "Khách hàng";
      const cAddr = customer_address || customerAddress || null;
      const cPhone = customer_phone || customerPhone || null;
      const cContact = customer_contact || customerContact || null;
      let dDate = delivery_date || deliveryDate || null;
      const dLoc = dispatch_location || dispatchLocation || null;
      const dName = dispatcher_name || dispatcherName || null;
      const dPhone = dispatcher_phone || dispatcherPhone || null;
      const crName = creator_name || creatorName || null;
      const invNo = invoice_number || invoiceNumber || null;
      const invDate = invoice_date || invoiceDate || null;
      const slipStatus = status || "COMPLETED";

      const itemsArr = Array.isArray(items) ? items : (typeof items === 'string' ? JSON.parse(items || '[]') : []);

      // Kiểm tra đơn hàng cha nếu lập/cập nhật phiếu giao không phải trạng thái CANCELLED
      if (String(slipStatus).toUpperCase() !== "CANCELLED" && (oId || oCode)) {
        const parentRes = await query(
          "SELECT id, order_code, delivery_status, approval_status, is_credit_blocked, price_approval_status FROM sales_orders WHERE (CASE WHEN $2::text IS NOT NULL THEN order_code = $2::text WHEN $3::text IS NOT NULL AND $3::text !~ '^[0-9]+$' THEN order_code = $3::text ELSE id = $1::int END) ORDER BY id LIMIT 1",
          [numericIdOrNull(oId), String(oCode || "").trim() || null, typeof oId === "string" ? oId.trim() : null]
        );
        const parentOrd = parentRes.rows[0];
        if (parentOrd) {
          const appSt = String(parentOrd.approval_status || "").toUpperCase();
          const priceSt = String(parentOrd.price_approval_status || "").toUpperCase();
          const delSt = String(parentOrd.delivery_status || "").toUpperCase();
          if (parentOrd.is_credit_blocked === true || ["PENDING_APPROVAL", "REJECTED"].includes(appSt) || priceSt === "PENDING_APPROVAL" || delSt === "CANCELLED") {
            return NextResponse.json({
              error: `Đơn hàng ${parentOrd.order_code} đang bị khóa công nợ, chờ duyệt hoặc đã hủy — không thể lập/cập nhật phiếu giao hàng.`
            }, { status: 400 });
          }
        }
      }

      // Phân quyền chặt khi sửa phiếu giao hàng đã xác nhận giao hoàn tất (DELIVERED):
      // Không cho phép NVKD thường tự ý đổi ngày giao hoặc danh mục mặt hàng của phiếu đã giao.
      if (!body.is_new) {
        const exRes = await query("SELECT delivery_date, items, status, extra_data FROM sales_delivery_slips WHERE slip_code = $1 LIMIT 1", [finalCode]).catch(() => ({ rows: [] as any[] }));
        const exRow = exRes.rows[0];
        if (exRow) {
          // Thao tác chỉ đổi trạng thái (kho xác nhận đã xuất / chuyển bước) không được ghi đè ngày giao bằng ngày cũ
          // còn trên màn hình người bấm (PX2611-0118: ngày giao bị ghi lại 12/11 sau khi đã sửa về 10/11)
          if (body.keep_delivery_date && exRow.delivery_date) dDate = exRow.delivery_date;
          let exExtra: any = exRow.extra_data;
          if (typeof exExtra === "string") { try { exExtra = JSON.parse(exExtra || "{}"); } catch { exExtra = {}; } }
          exExtra = exExtra && typeof exExtra === "object" ? exExtra : {};
          const wasDelivered = exExtra.isDelivered === true || exExtra.isDelivered === "true" || String(exExtra.deliveryStatus || "").toUpperCase() === "DELIVERED";
          const dateChanged = dDate && exRow.delivery_date && String(dDate).trim() !== String(exRow.delivery_date).trim();
          const itemsChanged = items !== undefined && stableStringify(parseJsonArray(exRow.items)) !== stableStringify(itemsArr);
          if (wasDelivered && (dateChanged || itemsChanged)) {
            const roleLow = String(authUser.role || "").toLowerCase();
            const deptLow = String((authUser as any).department || "").toLowerCase();
            const canEditDeliveredSlip =
              isAdminUser(authUser) ||
              canApproveSalesOrders(authUser) ||
              isAccountantUser(authUser) ||
              ["sales_manager", "sales_deputy", "sales_admin_manager", "sales_admin", "warehouse"].includes(roleLow) ||
              deptLow.includes("kho") ||
              deptLow.includes("kế toán") ||
              hasPermission(authUser, "sales.edit_delivery_slips") ||
              hasPermission(authUser, "warehouse.outbound") ||
              hasPermission(authUser, "warehouse.export") ||
              hasPermission(authUser, "sales.approve_orders");
            if (!canEditDeliveredSlip) {
              return forbiddenResponse("Phiếu giao hàng đã hoàn tất xác nhận giao — chỉ Quản trị viên, Ban Giám Đốc, Quản lý/Sale Admin, Kế toán hoặc Kho Vận mới có quyền chỉnh sửa ngày giao hoặc mặt hàng!");
            }
          }
        }
      }

      // Phiếu mới: chỉ chèn, không bao giờ ghi đè một phiếu khác đã có cùng mã
      if (body.is_new) {
        const ins = await query(
          `INSERT INTO sales_delivery_slips (
            slip_code, order_id, order_code, customer_name, customer_address,
            customer_phone, customer_contact, delivery_date, timeliness,
            dispatch_location, dispatcher_name, dispatcher_phone, creator_name,
            notes, items, invoice_number, invoice_date, status, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb, $16, $17, $18, CURRENT_TIMESTAMP)
          ON CONFLICT (slip_code) DO NOTHING
          RETURNING id`,
          [
            finalCode, oId, oCode, cName, cAddr, cPhone, cContact, dDate, timeliness || null,
            dLoc, dName, dPhone, crName, notes || null, JSON.stringify(itemsArr), invNo, invDate, slipStatus
          ]
        );
        if (ins.rows.length === 0) {
          return NextResponse.json({ error: `Mã phiếu ${finalCode} đã tồn tại. Vui lòng lập lại phiếu để nhận mã mới.` }, { status: 409 });
        }
      } else
      await query(
        `INSERT INTO sales_delivery_slips (
          slip_code, order_id, order_code, customer_name, customer_address,
          customer_phone, customer_contact, delivery_date, timeliness,
          dispatch_location, dispatcher_name, dispatcher_phone, creator_name,
          notes, items, invoice_number, invoice_date, status, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb, $16, $17, $18, CURRENT_TIMESTAMP)
        ON CONFLICT (slip_code) DO UPDATE
        SET order_id = EXCLUDED.order_id,
            order_code = EXCLUDED.order_code,
            customer_name = EXCLUDED.customer_name,
            customer_address = EXCLUDED.customer_address,
            customer_phone = EXCLUDED.customer_phone,
            customer_contact = EXCLUDED.customer_contact,
            delivery_date = EXCLUDED.delivery_date,
            timeliness = EXCLUDED.timeliness,
            dispatch_location = EXCLUDED.dispatch_location,
            dispatcher_name = EXCLUDED.dispatcher_name,
            dispatcher_phone = EXCLUDED.dispatcher_phone,
            creator_name = EXCLUDED.creator_name,
            notes = EXCLUDED.notes,
            items = CASE WHEN $19::boolean THEN EXCLUDED.items ELSE sales_delivery_slips.items END,
            invoice_number = COALESCE(EXCLUDED.invoice_number, sales_delivery_slips.invoice_number),
            invoice_date = COALESCE(EXCLUDED.invoice_date, sales_delivery_slips.invoice_date),
            status = EXCLUDED.status,
            updated_at = CURRENT_TIMESTAMP`,
        [
          finalCode, oId, oCode, cName, cAddr, cPhone, cContact, dDate, timeliness || null,
          dLoc, dName, dPhone, crName, notes || null, JSON.stringify(itemsArr), invNo, invDate, slipStatus,
          items !== undefined
        ]
      );

      // Một ngày duy nhất: "ngày giao thực tế" (deliveredAt) luôn theo ngày giao của phiếu khi phiếu đã xuất / đã giao
      // (trước đây hai trường lệch nhau: danh sách phiếu đọc ngày giao, chỗ khác đọc ngày giao thực tế)
      if (dDate && (body.deliveredAt || ["WAREHOUSE_DELIVERED", "DELIVERED"].includes(String(body.deliveryStatus || "").toUpperCase()))) {
        body.deliveredAt = parseSqlDate(dDate);
      }

      // Lưu thông tin mở rộng (đợt giao, trạng thái chờ giao/đã giao/hủy, POD...) vào extra_data
      if (!deliverySlipExtraColumnEnsured) {
        try {
          await query("ALTER TABLE sales_delivery_slips ADD COLUMN IF NOT EXISTS extra_data JSONB DEFAULT '{}'::jsonb");
          deliverySlipExtraColumnEnsured = true;
        } catch (err) {
          console.error("Failed to ensure sales_delivery_slips.extra_data column:", err);
        }
      }
      if (deliverySlipExtraColumnEnsured) {
        const slipExtra: Record<string, any> = {};
        for (const k of DELIVERY_SLIP_EXTRA_KEYS) {
          if (body[k] !== undefined && body[k] !== null) slipExtra[k] = body[k];
        }
        if (Object.keys(slipExtra).length > 0) {
          await query(
            "UPDATE sales_delivery_slips SET extra_data = COALESCE(extra_data, '{}'::jsonb) || $1::jsonb WHERE slip_code = $2",
            [JSON.stringify(slipExtra), finalCode]
          );
        }
      }

      // Đồng bộ lại ngày giao thực tế (delivered_at) của đơn hàng gốc theo ngày giao của phiếu
      if (oCode && dDate) {
        try {
          const parsedSlipDate = parseSqlDate(body.deliveredAt || dDate);
          await query(
            `UPDATE sales_orders
                SET delivered_at = $1::date
              WHERE order_code = $2
                AND delivery_status IN ('DELIVERED', 'PARTIALLY_DELIVERED')`,
            [parsedSlipDate, String(oCode).trim()]
          );
        } catch (err) {
          console.error("Failed to sync sales_orders.delivered_at from delivery_slip:", err);
        }
      }

      // Phiếu xuất kho (PXK-<mã phiếu>…) lấy NGÀY GIAO của phiếu làm ngày xuất (trước đây là ngày lập / sửa phiếu,
      // nên Thẻ kho và báo cáo xuất nhập tồn lệch ngày với phiếu giao)
      if (dDate && String(slipStatus).toUpperCase() !== "CANCELLED") {
        try {
          const isoSlipDate = parseSqlDate(dDate);
          await query(
            `UPDATE inventory_transactions SET date = $1::date
              WHERE (transaction_code = $2 OR transaction_code LIKE $3) AND transaction_type = 'OUTBOUND' AND date <> $1::date`,
            [isoSlipDate, `PXK-${finalCode}`, `PXK-${finalCode}-%`]
          );
        } catch (err) {
          console.error("Failed to sync PXK date from delivery_slip:", err);
        }
      }

      await logAudit("SAVE", "DELIVERY_SLIP", `Lưu phiếu xuất kho ${finalCode} cho đơn ${oCode || oId}${dDate ? ` (ngày giao ${dDate})` : ""}`);

      // Tự động bắn thông báo Zalo OA khi Kho xuất hàng (B2) hoặc Giao thành công (B3)
      const upperSlipSt = String(body.deliveryStatus || slipStatus || "").toUpperCase();
      if (body.isDelivered === true || upperSlipSt === "DELIVERED" || upperSlipSt === "FULLY_DELIVERED") {
        notifyZaloProactiveEvent({
          eventType: "DELIVERY_COMPLETED_POD",
          code: finalCode,
          customerName: cName,
          salesRepName: crName,
          reasonOrNote: `Đã giao thành công đơn ${oCode || oId}${dName ? ` (Người giao: ${dName})` : ""}`
        }).catch(() => {});
      } else if (upperSlipSt === "SHIPPED" || upperSlipSt === "DISPATCHED") {
        notifyZaloProactiveEvent({
          eventType: "DELIVERY_DISPATCHED",
          code: finalCode,
          customerName: cName,
          salesRepName: crName,
          extraInfo: `Thuộc đơn đặt hàng: ${oCode || oId} (${itemsArr.length} mặt hàng)`,
          reasonOrNote: dName ? `${dName}${dPhone ? ` (${dPhone})` : ""}` : "Kho đã xuất hàng đi giao"
        }).catch(() => {});
      }

      return NextResponse.json({ success: true, slip_code: finalCode });
    }

    if (action === "delete_delivery_slip") {
      const { id, slip_code } = body;
      // A slip that was not cancelled already took its goods out of stock: deleting it would lose that movement
      if (!(await deliverySlipIsCancelled(slip_code || id))) {
        return NextResponse.json({ error: "Chỉ xóa được phiếu giao đã hủy (hủy phiếu sẽ nhập lại hàng vào kho trước)." }, { status: 409 });
      }
      await query("DELETE FROM sales_delivery_slips WHERE slip_code = $1 OR id = $2", [slip_code || id, isNaN(Number(id)) ? null : Number(id)]);
      await logAudit("DELETE", "DELIVERY_SLIP", `Xóa phiếu xuất kho ${slip_code || id}`);
      return NextResponse.json({ success: true });
    }

    if (action === "rename_industry_group") {
      const { oldName, newName } = body;
      if (oldName && newName && oldName !== newName) {
        await query(
          "UPDATE sales_customers SET industry = $1 WHERE industry = $2",
          [newName, oldName]
        );
        await query(
          "UPDATE sales_customers SET classification = $1 WHERE classification = $2",
          [newName, oldName]
        );
        await logAudit("UPDATE", "SALES_CUSTOMER", `Cập nhật phân nhóm ngành hàng từ "${oldName}" thành "${newName}"`);
      }
      return NextResponse.json({ success: true });
    }

    if (action === "order") {
      if (!orderInvoiceNotesColumnEnsured) {
        try {
          await query("ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS invoice_notes TEXT");
          await query("ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS contact_person TEXT");
          await query("ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS contact_phone TEXT");
          await query("ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS delivery_address TEXT");
          await query("ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS quote_code TEXT");
          orderInvoiceNotesColumnEnsured = true;
        } catch (err) {
          console.error("Failed to ensure sales_orders extra columns:", err);
        }
      }
      const { id, order_code, customer_id, customer_name, sales_rep_name, order_date, items, total_amount } = body;
      const has = (k: string) => Object.prototype.hasOwnProperty.call(body, k) && body[k] !== undefined;

      let resolvedCustomerId: number | null = null;
      let matchedCustomer: any = null;
      if (customer_id && !isNaN(Number(customer_id))) {
        const idCheck = await query("SELECT * FROM sales_customers WHERE id = $1", [Number(customer_id)]);
        if (idCheck.rows.length > 0) {
          resolvedCustomerId = idCheck.rows[0].id;
          matchedCustomer = idCheck.rows[0];
        }
      }
      const custCodeIn = String(body.customer_code || body.customerCode || "").trim();
      if (!resolvedCustomerId && custCodeIn) {
        const codeCheck = await query("SELECT * FROM sales_customers WHERE customer_code = $1 LIMIT 1", [custCodeIn]);
        if (codeCheck.rows.length > 0) {
          resolvedCustomerId = codeCheck.rows[0].id;
          matchedCustomer = codeCheck.rows[0];
        }
      }
      if (!resolvedCustomerId && customer_name) {
        const nameCheck = await query("SELECT * FROM sales_customers WHERE LOWER(TRIM(name)) = LOWER(TRIM($1)) LIMIT 1", [String(customer_name).trim()]);
        if (nameCheck.rows.length > 0) {
          resolvedCustomerId = nameCheck.rows[0].id;
          matchedCustomer = nameCheck.rows[0];
        }
      }

      // Đơn STOCK (lưu kho gối đầu) không qua kiểm tra công nợ và duyệt giá 0đ: cờ này không được lấy từ client
      // cho người không có quyền duyệt đơn (trước đây chỉ cần gửi is_stock_order=true hoặc mã đơn chứa "STOCK").
      const stockRequested = Boolean(body.is_stock_order || body.isStockOrder || (order_code && String(order_code).includes("STOCK")));
      const canCreateStockOrder = isAdminUser(authUser) || canApproveSalesOrders(authUser);
      let isStockOrder = stockRequested && canCreateStockOrder;
      const itemsArr = Array.isArray(items) ? items : [];
      const hasZeroPrice = itemsArr.some(itemHasZeroPrice);
      const itemsError = validateOrderItems(itemsArr);
      if (itemsError) return NextResponse.json({ error: itemsError }, { status: 400 });
      // Tổng tiền luôn do máy chủ tính lại từ dòng hàng (công nợ, thu tiền, hạn mức đều dựa vào số này)
      const computedTotal = computeOrderTotal(itemsArr);
      if (has("items") && has("total_amount") && Math.abs((Number(total_amount) || 0) - computedTotal) > 1) {
        console.warn(`[sales/order] Tổng tiền client (${total_amount}) khác tổng tính lại (${computedTotal}) cho đơn ${order_code || "(mới)"}; dùng tổng tính lại.`);
      }
      // Chỉ Kế toán / Quản trị viên được đổi trạng thái thanh toán & hóa đơn; chỉ Quản trị viên được lùi trạng thái
      const canSetFinanceStatus = isAccountantUser(authUser);
      const canRollback = isAdminUser(authUser);
      // Chính sách giá "STOCK" chỉ dành cho đơn STOCK đã được cho phép (nó cũng đánh dấu đơn là STOCK khi sửa sau này)
      const safePricePolicy = (v: any) => {
        const policy = String(v || "STANDARD");
        return policy.toUpperCase() === "STOCK" && !isStockOrder ? "STANDARD" : policy;
      };

      // Một lần "sửa đơn" chỉ mang theo order_code: tìm đơn đang có theo id, rồi theo mã.
      // (Trước đây thiếu id nên mỗi lần sửa lại INSERT thêm một dòng SO trùng mã, reset trạng thái giao/thanh toán.)
      // Tìm đơn theo MÃ ĐƠN trước; id số chỉ dùng khi không gửi mã (id lấy từ màn hình có thể là của đơn khác
      // -> trước đây sửa đơn này lại ghi đè sang đơn kia, kể cả tên khách hàng)
      let existing: any = null;
      if (order_code && String(order_code).trim()) {
        existing = (await query("SELECT * FROM sales_orders WHERE order_code = $1 ORDER BY id ASC LIMIT 1", [String(order_code).trim()])).rows[0] || null;
      } else if (id && !isNaN(Number(id))) {
        existing = (await query("SELECT * FROM sales_orders WHERE id = $1", [Number(id)])).rows[0] || null;
      }

      if (existing) {
        const isRollback = Boolean(body.force_rollback) && canRollback;
        // Đơn đã hủy không được sửa: lần lưu trước đây đưa trạng thái giao về PENDING, ghi đè dòng hàng & ghi chú hủy
        // (đơn bị "sống lại" trong CSDL trong khi màn hình vẫn hiện đã hủy). Chỉ Quản trị viên khôi phục có chủ đích.
        if (String(existing.delivery_status || "").toUpperCase() === "CANCELLED" && !isRollback) {
          return NextResponse.json({
            error: `Đơn ${existing.order_code} đã bị hủy nên không thể sửa. Nếu khách vẫn đặt hàng, hãy tạo đơn mới (nút Copy) hoặc nhờ Quản trị viên khôi phục đơn.`,
            cancelled: true
          }, { status: 409 });
        }
        // Đơn đang có: loại đơn theo dữ liệu đã lưu, không theo cờ client gửi lên
        isStockOrder = String(existing.order_code || "").includes("STOCK") || String(existing.applied_price_policy || "").toUpperCase() === "STOCK";
        if (has("items") && !isStockOrder) {
          for (const it of itemsArr) {
            if (it?.status === "CANCELLED") continue;
            const p = orderLinePrice(it);
            const isGiftItem = Boolean(it?.isGift || it?.is_gift || it?.isSample || it?.is_sample);
            if (!(p > 0) && !isGiftItem) {
              const pLabel = it?.productName || it?.product_name || it?.productCode || it?.product_code || "Sản phẩm";
              return NextResponse.json({
                error: `Mặt hàng "${pLabel}" chưa nhập đơn giá (> 0đ). Nếu là hàng tặng 0 đồng, bắt buộc phải tích vào nút "🎁 Tặng" trước khi lưu đơn SO!`
              }, { status: 400 });
            }
          }
        }
        const sets: string[] = [];
        const params: any[] = [];
        const set = (col: string, val: any, cast = "") => { params.push(val); sets.push(`${col} = $${params.length}${cast}`); };

        if (has("customer_name")) set("customer_name", customer_name);
        if (has("customer_id") || has("customer_name")) set("customer_id", resolvedCustomerId ?? existing.customer_id);
        if (has("sales_rep_name")) set("sales_rep_name", sales_rep_name);
        if (has("sales_rep_id") && body.sales_rep_id) set("sales_rep_id", String(body.sales_rep_id));
        if (has("order_date") && order_date) set("order_date", order_date);
        if (has("items")) set("items", JSON.stringify(itemsArr), "::jsonb");
        if (has("items")) set("total_amount", computedTotal);
        if (has("notes")) set("notes", body.notes);
        if (has("order_notes")) set("order_notes", body.order_notes ? String(body.order_notes).slice(0, 2000) : null);
        if (has("invoice_notes") || has("invoiceNotes")) set("invoice_notes", (body.invoice_notes ?? body.invoiceNotes) ? String(body.invoice_notes ?? body.invoiceNotes).slice(0, 2000) : null);
        if (has("applied_price_policy")) set("applied_price_policy", safePricePolicy(body.applied_price_policy));
        if (has("vat_requested")) set("vat_requested", Boolean(body.vat_requested));
        for (const col of ["vat_company_name", "vat_tax_code", "vat_address", "vat_email", "shipping_method", "tracking_code"]) {
          if (has(col)) set(col, body[col] || null);
        }
        if (has("contact_person") || has("contactPerson") || has("customerContact")) {
          set("contact_person", body.contact_person ?? body.contactPerson ?? body.customerContact ?? null);
        }
        if (has("contact_phone") || has("contactPhone") || has("customerPhone")) {
          set("contact_phone", body.contact_phone ?? body.contactPhone ?? body.customerPhone ?? null);
        }
        if (has("delivery_address") || has("deliveryAddress") || has("customerAddress")) {
          set("delivery_address", body.delivery_address ?? body.deliveryAddress ?? body.customerAddress ?? null);
        }
        if (has("quote_code") || has("quoteId")) {
          set("quote_code", body.quote_code ?? body.quoteId ?? null);
        }
        if (has("pr_code") || has("prCode")) set("pr_code", body.pr_code || body.prCode || null);
        if (has("procure_status") || has("procureStatus")) set("procure_status", body.procure_status || body.procureStatus || null);
        if (has("procure_order_code") || has("procureOrderCode")) set("procure_order_code", body.procure_order_code || body.procureOrderCode || null);
        if (has("fulfillment_source") || has("fulfillmentSource")) set("fulfillment_source", body.fulfillment_source || body.fulfillmentSource || null);
        if (has("invoiced_delivery_slips")) set("invoiced_delivery_slips", JSON.stringify(body.invoiced_delivery_slips || []), "::jsonb");
        // Monotonic FSM: a stale form can never move an order backwards
        if (has("delivery_status")) set("delivery_status", resolveMonotonicStatus(existing.delivery_status, body.delivery_status, DELIVERY_STATUS_HIERARCHY, isRollback));
        // Thanh toán chỉ đổi qua sổ thu tiền (record_customer_payment); hóa đơn chỉ Kế toán đổi
        if (has("payment_status") && canSetFinanceStatus) set("payment_status", resolveMonotonicStatus(existing.payment_status, body.payment_status, PAYMENT_STATUS_HIERARCHY, isRollback));
        if (has("invoice_status") && canSetFinanceStatus) set("invoice_status", resolveMonotonicStatus(existing.invoice_status, body.invoice_status, INVOICE_STATUS_HIERARCHY, isRollback));

        // Re-evaluate approvals when the content changes (an approved order could otherwise be edited
        // to 0đ items or a much larger amount without new approval)
        let priceApprovalStatus = existing.price_approval_status || "APPROVED";
        if (has("items")) {
          const itemsChanged = stableStringify(parseJsonArray(existing.items)) !== stableStringify(itemsArr);
          set("has_zero_price_items", hasZeroPrice);
          if (!isStockOrder && hasZeroPrice && itemsChanged) priceApprovalStatus = "PENDING_APPROVAL";
          if (!hasZeroPrice && priceApprovalStatus === "PENDING_APPROVAL") priceApprovalStatus = "APPROVED";
          if (priceApprovalStatus !== existing.price_approval_status) set("price_approval_status", priceApprovalStatus);
        }

        let isCreditBlocked = Boolean(existing.is_credit_blocked);
        let creditBlockReason = existing.credit_block_reason || "";
        const newTotal = has("items") ? computedTotal : (Number(existing.total_amount) || 0);
        const customerChanged = resolvedCustomerId !== null && resolvedCustomerId !== existing.customer_id;

        if (!isStockOrder) {
          const custForCredit = matchedCustomer || {
            id: resolvedCustomerId ?? existing.customer_id ?? null,
            name: customer_name || existing.customer_name || "",
            credit_limit: DEFAULT_CREDIT_LIMIT,
            credit_term_days: DEFAULT_CREDIT_TERM_DAYS
          };
          const credit = await evaluateCredit(custForCredit, newTotal, existing.id);
          if (credit.blocked) {
            isCreditBlocked = true;
            creditBlockReason = credit.reason;
            set("is_credit_blocked", true);
            set("credit_block_reason", credit.reason);
          } else if (existing.is_credit_blocked) {
            isCreditBlocked = false;
            creditBlockReason = "";
            set("is_credit_blocked", false);
            set("credit_block_reason", "");
          }
        }

        // Đơn đã được duyệt mà bị sửa mặt hàng / tổng tiền / khách hàng:
        // - Nếu sau khi sửa vẫn có dòng 0đ hoặc bị khóa công nợ -> bắt buộc duyệt lại (approvalReset = true)
        // - Nếu sau khi sửa toàn bộ mặt hàng đã có giá > 0 và công nợ an toàn -> tự động hợp lệ (APPROVED)
        const contentChanged = (has("items") && stableStringify(parseJsonArray(existing.items)) !== stableStringify(itemsArr))
          || customerChanged;
        const effectiveHasZero = has("items") ? hasZeroPrice : Boolean(existing.has_zero_price_items);
        const requiresManualApproval = !isStockOrder && (effectiveHasZero || isCreditBlocked);
        let approvalReset = false;
        if (contentChanged && String(existing.approval_status || "").toUpperCase() === "APPROVED" && requiresManualApproval) {
          approvalReset = true;
          set("approval_status", null);
          set("approved_by", null);
          set("approved_at", null);
          set("approval_note", `Cần duyệt lại: đơn được sửa sau khi đã duyệt (trước đó duyệt bởi ${existing.approved_by || "?"})`);
        } else if (!requiresManualApproval && (existing.approval_status !== "APPROVED" || String(existing.approval_note || "").startsWith("Cần duyệt lại"))) {
          set("approval_status", "APPROVED");
          set("approval_note", null);
        }

        if (sets.length > 0) {
          params.push(existing.id);
          await query(`UPDATE sales_orders SET ${sets.join(", ")} WHERE id = $${params.length}`, params);
        }
        await logAudit("UPDATE", "SALES_ORDER", `Cập nhật đơn hàng ${existing.order_code} cho ${customer_name || existing.customer_name}${approvalReset ? " [ĐÃ DUYỆT -> CHỜ DUYỆT LẠI]" : ""}`);
        return NextResponse.json({
          success: true,
          approval_reset: approvalReset,
          approval_status: approvalReset ? null : (existing.approval_status ?? null),
          id: existing.id,
          order_code: existing.order_code,
          code: existing.order_code,
          is_credit_blocked: isCreditBlocked,
          credit_block_reason: creditBlockReason,
          has_zero_price_items: has("items") ? hasZeroPrice : Boolean(existing.has_zero_price_items),
          price_approval_status: priceApprovalStatus
        });
      }

      // ---- New order ----
      if (stockRequested && !isStockOrder) {
        return forbiddenResponse("Chỉ Trưởng/Phó phòng Kinh doanh hoặc Quản trị viên được tạo đơn STOCK (lưu kho gối đầu, không kiểm tra công nợ).");
      }
      if (!isStockOrder) {
        for (const it of itemsArr) {
          if (it?.status === "CANCELLED") continue;
          const p = orderLinePrice(it);
          const isGiftItem = Boolean(it?.isGift || it?.is_gift || it?.isSample || it?.is_sample);
          if (!(p > 0) && !isGiftItem) {
            const pLabel = it?.productName || it?.product_name || it?.productCode || it?.product_code || "Sản phẩm";
            return NextResponse.json({
              error: `Mặt hàng "${pLabel}" chưa nhập đơn giá (> 0đ). Nếu là hàng tặng 0 đồng, bắt buộc phải tích vào nút "🎁 Tặng" trước khi lưu đơn SO!`
            }, { status: 400 });
          }
        }
      }
      let isCreditBlocked = false;
      let creditBlockReason = "";
      if (!isStockOrder) {
        const custForCredit = matchedCustomer || {
          id: resolvedCustomerId,
          name: customer_name || "",
          credit_limit: DEFAULT_CREDIT_LIMIT,
          credit_term_days: DEFAULT_CREDIT_TERM_DAYS
        };
        const credit = await evaluateCredit(custForCredit, computedTotal, null);
        isCreditBlocked = credit.blocked;
        creditBlockReason = credit.reason;
      }
      const priceApprovalStatus = (!isStockOrder && hasZeroPrice) ? "PENDING_APPROVAL" : "APPROVED";

      const code = (order_code && (/^SO\d{2}-[A-Z0-9]{2,5}-\d{4,5}$/.test(order_code) || (isStockOrder && String(order_code).includes("STOCK"))))
        ? String(order_code).trim()
        : await generateDocumentCode({
            docType: "SO",
            customerName: customer_name,
            salesRepName: sales_rep_name,
            tagMode: isStockOrder ? "STOCK" : "CUSTOMER"
          });
      const ins = await query(
        `INSERT INTO sales_orders (
          order_code, customer_id, customer_name, sales_rep_name, order_date, items, total_amount,
          delivery_status, payment_status, invoice_status, notes,
          is_credit_blocked, credit_block_reason, has_zero_price_items, price_approval_status, applied_price_policy,
          vat_requested, vat_company_name, vat_tax_code, vat_address, vat_email, shipping_method, tracking_code, invoiced_delivery_slips,
          pr_code, procure_status, procure_order_code, fulfillment_source, sales_rep_id, order_notes, invoice_notes,
          contact_person, contact_phone, delivery_address, quote_code
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34, $35)
        RETURNING id`,
        [
          code, resolvedCustomerId, customer_name, sales_rep_name, order_date || todayVN(),
          JSON.stringify(itemsArr), computedTotal, body.delivery_status || "PENDING",
          (canSetFinanceStatus && body.payment_status) || "UNPAID",
          (canSetFinanceStatus && body.invoice_status) || "PENDING_INVOICE", body.notes,
          isCreditBlocked, creditBlockReason, hasZeroPrice, priceApprovalStatus, safePricePolicy(body.applied_price_policy),
          Boolean(body.vat_requested), body.vat_company_name || null, body.vat_tax_code || null, body.vat_address || null, body.vat_email || null,
          body.shipping_method || "Xe lạnh chuyên dụng", body.tracking_code || null, JSON.stringify(body.invoiced_delivery_slips || []),
          body.pr_code || body.prCode || null, body.procure_status || body.procureStatus || null, body.procure_order_code || body.procureOrderCode || null, body.fulfillment_source || body.fulfillmentSource || null,
          body.sales_rep_id ? String(body.sales_rep_id) : null,
          body.order_notes ? String(body.order_notes).slice(0, 2000) : null,
          (body.invoice_notes ?? body.invoiceNotes) ? String(body.invoice_notes ?? body.invoiceNotes).slice(0, 2000) : null,
          (body.contact_person ?? body.contactPerson ?? body.customerContact) || null,
          (body.contact_phone ?? body.contactPhone ?? body.customerPhone) || null,
          (body.delivery_address ?? body.deliveryAddress ?? body.customerAddress) || null,
          (body.quote_code ?? body.quoteId) || null
        ]
      );
      await logAudit("CREATE", "SALES_ORDER", `Tạo mới đơn hàng thương mại ${code} (${computedTotal} đ)${isCreditBlocked ? " [BỊ KHÓA DO VI PHẠM CÔNG NỢ]" : ""}`);
      if (!isStockOrder && (isCreditBlocked || priceApprovalStatus === "PENDING_APPROVAL")) {
        const reasons: string[] = [];
        if (priceApprovalStatus === "PENDING_APPROVAL") reasons.push("Có mặt hàng giá 0 đồng / Quà tặng");
        if (isCreditBlocked) reasons.push(creditBlockReason || "Khóa hạn mức công nợ");
        notifyZaloProactiveEvent({
          eventType: "SO_APPROVAL_NEEDED",
          code,
          customerName: customer_name,
          salesRepName: sales_rep_name,
          totalAmount: computedTotal,
          reasonOrNote: reasons.join(" • ")
        }).catch(() => {});
      }
      return NextResponse.json({
        success: true,
        id: ins.rows[0]?.id,
        order_code: code,
        code,
        is_credit_blocked: isCreditBlocked,
        credit_block_reason: creditBlockReason,
        has_zero_price_items: hasZeroPrice,
        price_approval_status: priceApprovalStatus
      });
    }

    // Duyệt / từ chối yêu cầu đặt hàng (SO): quyết định được ghi và kiểm tra tại máy chủ.
    // Đơn đang bị khóa công nợ cần Kế toán mở khóa (release_credit), đơn có hàng 0đ / quà tặng cần
    // Ban Giám Đốc duyệt giá (approve_price) trước khi được duyệt.
    if (action === "approve_order") {
      const me = await getAuthorizedUser(req);
      setAuditActor(me);
      if (!me) return unauthorizedResponse();
      if (!canApproveSalesOrders(me)) {
        return forbiddenResponse("Chỉ Trưởng/Phó phòng Kinh doanh, Quản lý hoặc Ban Giám Đốc mới có quyền duyệt yêu cầu đặt hàng.");
      }
      const approve = body.approve !== false;
      const codes: string[] = (Array.isArray(body.order_codes) ? body.order_codes : [body.order_code])
        .map((c: any) => String(c || "").trim())
        .filter(Boolean);
      if (codes.length === 0) return NextResponse.json({ error: "Thiếu mã đơn hàng" }, { status: 400 });
      const note = body.note ? String(body.note) : null;

      const results = await withTransaction(async (c) => {
        const out: { order_code: string; ok: boolean; approval_status?: string; error?: string }[] = [];
        for (const code of codes) {
          const row = (await c.query("SELECT id, order_code, is_credit_blocked, price_approval_status, approval_status FROM sales_orders WHERE order_code = $1 FOR UPDATE", [code])).rows[0];
          if (!row) {
            out.push({ order_code: code, ok: false, error: "Đơn chưa được lưu vào CSDL. Hãy mở và lưu lại đơn trước khi duyệt." });
            continue;
          }
          if (approve && row.is_credit_blocked) {
            out.push({ order_code: code, ok: false, error: "Đơn đang bị khóa công nợ, cần Kế toán mở khóa trước." });
            continue;
          }
          if (approve && row.price_approval_status === "PENDING_APPROVAL") {
            out.push({ order_code: code, ok: false, error: "Đơn có hàng 0đ / quà tặng chưa được Ban Giám Đốc duyệt giá." });
            continue;
          }
          const status = approve ? "APPROVED" : "REJECTED";
          await c.query(
            "UPDATE sales_orders SET approval_status = $1, approved_by = $2, approved_at = CURRENT_TIMESTAMP, approval_note = $3 WHERE id = $4",
            [status, me.full_name || me.username, note, row.id]
          );
          out.push({ order_code: code, ok: true, approval_status: status });
        }
        return out;
      });
      const okCodes = results.filter(r => r.ok).map(r => r.order_code);
      if (okCodes.length > 0) {
        await logAudit(approve ? "APPROVE_ORDER" : "REJECT_ORDER", "SALES_ORDER", `${approve ? "Duyệt" : "Từ chối"} yêu cầu đặt hàng ${okCodes.join(", ")}${note ? ` — ${note}` : ""}`, me.username, me.full_name);
      }
      return NextResponse.json({ success: okCodes.length > 0, results, approved_by: me.full_name || me.username });
    }

    // Xóa đơn hàng: xóa trong CSDL (trước đây chỉ xóa trên giao diện nên đơn "sống lại" khi tải lại trang)
    if (action === "delete_order") {
      const me = await getAuthorizedUser(req);
      setAuditActor(me);
      if (!me) return unauthorizedResponse();
      if (!hasPermission(me, "sales.delete") && !isAdminUser(me)) {
        return forbiddenResponse("Bạn không có quyền xóa đơn hàng.");
      }
      const code = String(body.order_code || "").trim();
      if (!code) return NextResponse.json({ error: "Thiếu mã đơn hàng" }, { status: 400 });

      const result = await withTransaction(async (c) => {
        const rows = (await c.query("SELECT * FROM sales_orders WHERE order_code = $1 FOR UPDATE", [code])).rows;
        if (rows.length === 0) return { deleted: 0 };
        for (const ord of rows) {
          const delivered = (DELIVERY_STATUS_HIERARCHY[String(ord.delivery_status || "").toUpperCase()] ?? 0) >= 3;
          const invoiced = (INVOICE_STATUS_HIERARCHY[String(ord.invoice_status || "").toUpperCase()] ?? 0) > 0 || parseJsonArray(ord.invoiced_delivery_slips).length > 0;
          const paid = (PAYMENT_STATUS_HIERARCHY[String(ord.payment_status || "").toUpperCase()] ?? 0) > 0;
          if (delivered || invoiced || paid) {
            throw new HttpError(409, `Đơn ${code} đã giao hàng / xuất hóa đơn / thanh toán nên không được xóa. Hãy dùng quy trình hủy dòng hoặc trả hàng (RMA).`);
          }
        }
        const active = await c.query(
          "SELECT DISTINCT product_code FROM inventory_reservations WHERE order_code = $1 AND status = 'ACTIVE' ORDER BY product_code",
          [code]
        );
        for (const r of active.rows) {
          if (r.product_code) await releaseReservationsFor(c, code, r.product_code, ` • [Tự động nhả do xóa đơn ${code}]`);
        }
        await c.query("DELETE FROM sales_orders WHERE order_code = $1", [code]);
        return { deleted: rows.length };
      });
      await logAudit("DELETE", "SALES_ORDER", `Xóa đơn hàng ${code} (${result.deleted} bản ghi CSDL)`, me.username, me.full_name);
      return NextResponse.json({ success: true, deleted: result.deleted });
    }

    // Hủy toàn bộ đơn hàng (SO) khi khách báo hủy trước khi đặt hàng NCC / giao hàng
    if (action === "cancel_order") {
      const me = await getAuthorizedUser(req);
      setAuditActor(me);
      if (!me) return unauthorizedResponse();
      const code = String(body.order_code || body.id || "").trim();
      const reason = String(body.reason || "").trim();
      if (!code) return NextResponse.json({ error: "Thiếu mã đơn hàng cần hủy" }, { status: 400 });
      // Bắt buộc ghi lý do hủy thật (trước đây ô lý do điền sẵn câu mặc định nên dễ bấm OK nhầm)
      if (reason.length < 5) return NextResponse.json({ error: "Vui lòng nhập lý do hủy đơn (ít nhất 5 ký tự)." }, { status: 400 });

      const result = await withTransaction(async (c) => {
        const ordRes = await c.query("SELECT * FROM sales_orders WHERE order_code = $1 ORDER BY id ASC FOR UPDATE", [code]);
        const ord = ordRes.rows[0];
        if (!ord) {
          // Đơn chỉ mới lưu ở client storage, vẫn hỗ trợ hủy PR và giải phóng giữ hàng nếu có
          const activeRes = await c.query(
            "SELECT DISTINCT product_code FROM inventory_reservations WHERE order_code = $1 AND status = 'ACTIVE'",
            [code]
          );
          for (const r of activeRes.rows) {
            if (r.product_code) await releaseReservationsFor(c, code, r.product_code, ` • [Giải phóng giữ hàng do hủy đơn ${code}: ${reason}]`);
          }
          const prPattern = `%${code}%`;
          await c.query(
            `UPDATE workflow_requests
                SET status = 'CANCELLED',
                    results_summary = COALESCE(results_summary, '') || $2
              WHERE (workflow_code = $1 OR title ILIKE $3 OR description ILIKE $3)
                AND status IN ('PENDING', 'IN_PROGRESS', 'APPROVED')`,
            [body.pr_code || code.replace(/^SO/, "PR"), ` • [Hủy tự động do hủy đơn ${code}: ${reason}]`, prPattern]
          );
          return { cancelled: true, order_code: code };
        }

        // Kiểm tra phiếu giao hàng chưa hủy
        const slipRes = await c.query(
          "SELECT slip_code, status, extra_data FROM sales_delivery_slips WHERE order_code = $1",
          [code]
        );
        const activeSlips = slipRes.rows.filter((s: any) => {
          const st = String(s.status || "").toUpperCase();
          if (st === "CANCELLED") return false;
          let ex: any = s.extra_data;
          if (typeof ex === "string") { try { ex = JSON.parse(ex || "{}"); } catch { ex = {}; } }
          if (String(ex?.deliveryStatus || "").toUpperCase() === "CANCELLED") return false;
          return true;
        });
        if (activeSlips.length > 0) {
          throw new HttpError(409, `Đơn ${code} đã phát sinh Phiếu giao hàng (${activeSlips.map((s: any) => s.slip_code).join(", ")}). Vui lòng hủy phiếu giao hàng trước khi hủy đơn!`);
        }

        const delStatus = String(ord.delivery_status || "").toUpperCase();
        if (delStatus === "DELIVERED" || delStatus === "PARTIALLY_DELIVERED" || delStatus === "SHIPPED") {
          throw new HttpError(409, `Đơn ${code} đã xuất kho / giao hàng (${delStatus}), không thể hủy trực tiếp.`);
        }

        const rawItems = parseJsonArray(ord.items);
        const cancelledItems = rawItems.map((it: any) => ({
          ...it,
          status: "CANCELLED",
          cancelledAt: new Date().toISOString(),
          cancelledBy: me.full_name || me.username,
          cancelReason: reason
        }));
        const cancelNote = `[HỦY ĐƠN - ${todayVN()} bởi ${me.full_name || me.username}: ${reason}]`;
        const updatedNotes = ord.notes ? `${ord.notes} • ${cancelNote}` : cancelNote;

        await c.query(
          `UPDATE sales_orders
              SET delivery_status = 'CANCELLED',
                  procure_status = CASE WHEN procure_status IN ('PR_PENDING', 'PR_CREATED', 'PENDING') THEN 'CANCELLED' ELSE procure_status END,
                  items = $1::jsonb,
                  notes = $2
            WHERE order_code = $3`,
          [JSON.stringify(cancelledItems), updatedNotes, code]
        );

        // Giải phóng toàn bộ giữ hàng (inventory_reservations) đang ACTIVE của đơn
        const activeRes = await c.query(
          "SELECT DISTINCT product_code FROM inventory_reservations WHERE order_code = $1 AND status = 'ACTIVE'",
          [code]
        );
        for (const r of activeRes.rows) {
          if (r.product_code) await releaseReservationsFor(c, code, r.product_code, ` • [Giải phóng giữ hàng do hủy đơn ${code}: ${reason}]`);
        }

        // Hủy PR liên kết nếu đang chờ Cung ứng xử lý
        const prCode = ord.pr_code || body.pr_code || code.replace(/^SO/, "PR");
        const prPattern = `%${code}%`;
        await c.query(
          `UPDATE workflow_requests
              SET status = 'CANCELLED',
                  results_summary = COALESCE(results_summary, '') || $2
            WHERE (workflow_code = $1 OR title ILIKE $3 OR description ILIKE $3)
              AND status IN ('PENDING', 'IN_PROGRESS', 'APPROVED')`,
          [prCode, ` • [Hủy tự động do hủy đơn ${code}: ${reason}]`, prPattern]
        );

        return { cancelled: true, order_code: code, items: cancelledItems, notes: updatedNotes };
      });

      await logAudit("CANCEL_ORDER", "SALES_ORDER", `Hủy đơn đặt hàng ${code}: ${reason}`, me.username, me.full_name);
      return NextResponse.json({ success: true, ...result });
    }

    // 1.1 Explicit Delivery Status Update with FSM Guard (Ngăn chặn lùi bước)
    if (action === "update_delivery_status") {
      const { order_id, order_code, delivery_status, delivered_at, invoice_no, invoice_date, invoice_status, invoice_files, delivery_notes, force_rollback, rollback_reason } = body;
      const orderRes = await query(
        "SELECT id, order_code, delivery_status, invoice_status, invoice_no, invoice_date, approval_status, is_credit_blocked, price_approval_status FROM sales_orders WHERE (CASE WHEN $2::text IS NOT NULL THEN order_code = $2::text WHEN $3::text IS NOT NULL AND $3::text !~ '^[0-9]+$' THEN order_code = $3::text ELSE id = $1::int END) ORDER BY id LIMIT 1",
        [numericIdOrNull(order_id), String(order_code || "").trim() || null, typeof order_id === "string" ? order_id.trim() : null]
      );
      if (orderRes.rows.length === 0) {
        return NextResponse.json({ error: "Không tìm thấy đơn hàng" }, { status: 404 });
      }
      const ord = orderRes.rows[0];
      const isRollback = Boolean(force_rollback);
      const targetUpper = String(delivery_status || "").toUpperCase();

      if (["PACKED", "READY", "SHIPPED", "DISPATCHED", "PARTIALLY_DELIVERED", "DELIVERED"].includes(targetUpper)) {
        const appSt = String(ord.approval_status || "").toUpperCase();
        const priceSt = String(ord.price_approval_status || "").toUpperCase();
        const delSt = String(ord.delivery_status || "").toUpperCase();
        if (ord.is_credit_blocked === true || ["PENDING_APPROVAL", "REJECTED"].includes(appSt) || priceSt === "PENDING_APPROVAL" || delSt === "CANCELLED") {
          return NextResponse.json({
            error: `Đơn hàng ${ord.order_code} đang bị khóa công nợ, chờ duyệt hoặc đã hủy — không thể chuyển trạng thái giao hàng sang "${delivery_status}".`
          }, { status: 400 });
        }
      }

      const currDelLevel = DELIVERY_STATUS_HIERARCHY[ord.delivery_status?.toUpperCase()] ?? 0;
      const nextDelLevel = DELIVERY_STATUS_HIERARCHY[delivery_status?.toUpperCase()] ?? 0;

      // Chặn đứng hành vi lùi trạng thái nếu không có cờ rollback và lý do cụ thể
      if (!isRollback && nextDelLevel < currDelLevel && delivery_status?.toUpperCase() !== "CANCELLED") {
        return NextResponse.json({
          error: `[Bảo vệ tiến trình]: Đơn hàng đã ở trạng thái "${ord.delivery_status}". Không thể lùi bước về "${delivery_status}". Nếu muốn trả/hoàn đơn, vui lòng dùng quy trình RMA hoặc Rollback có lý do.`
        }, { status: 400 });
      }

      const safeDelStatus = resolveMonotonicStatus(ord.delivery_status, delivery_status, DELIVERY_STATUS_HIERARCHY, isRollback);
      const safeInvStatus = invoice_status ? resolveMonotonicStatus(ord.invoice_status, invoice_status, INVOICE_STATUS_HIERARCHY, isRollback) : ord.invoice_status;

      const deliveredDate = delivered_at ? parseSqlDate(delivered_at) : null;
      const invNo = String(invoice_no || "").trim() || null;
      const invDate = invNo ? (invoice_date ? parseSqlDate(invoice_date) : todayVN()) : null;
      await query(
        `UPDATE sales_orders
         SET delivery_status = $1::text,
             invoice_status = COALESCE($2, invoice_status),
             invoice_no = COALESCE($3, invoice_no),
             invoice_date = COALESCE($4, invoice_date),
             delivered_at = CASE WHEN $7::date IS NOT NULL AND $1::text IN ('DELIVERED', 'PARTIALLY_DELIVERED') THEN COALESCE(delivered_at, $7::date) ELSE delivered_at END,
             notes = CASE WHEN $5::text IS NOT NULL AND $5::text != '' THEN COALESCE(notes, '') || ' • [Giao hàng: ' || $5::text || ']' ELSE notes END
         WHERE id = $6`,
        [safeDelStatus, safeInvStatus, invNo, invDate, delivery_notes || null, ord.id, deliveredDate]
      );

      await logAudit("UPDATE_DELIVERY_STATUS", "SALES_ORDER", `Cập nhật giao hàng đơn ${ord.order_code}: ${safeDelStatus} (HĐ: ${invoice_no || 'N/A'})${isRollback ? ` [ROLLBACK: ${rollback_reason}]` : ''}`);
      return NextResponse.json({ success: true, delivery_status: safeDelStatus, invoice_status: safeInvStatus });
    }

    // 2.0 Partial Invoicing per Delivery Slip (Yêu cầu 9)
    if (action === "partial_invoice") {
      const { order_id, order_code, delivery_slip_id, invoice_no, invoice_date, invoice_amount, invoice_files, is_final, invoiced_items } = body;
      const invNoClean = String(invoice_no || "").trim();
      if (!invNoClean) return NextResponse.json({ error: "Thiếu số hóa đơn" }, { status: 400 });

      const result = await withTransaction(async (c) => {
        const orderRes = await c.query(
          "SELECT id, order_code, total_amount, invoiced_delivery_slips FROM sales_orders WHERE (CASE WHEN $2::text IS NOT NULL THEN order_code = $2::text WHEN $3::text IS NOT NULL AND $3::text !~ '^[0-9]+$' THEN order_code = $3::text ELSE id = $1::int END) ORDER BY id LIMIT 1 FOR UPDATE",
          [numericIdOrNull(order_id), String(order_code || "").trim() || null, typeof order_id === "string" ? order_id.trim() : null]
        );
        if (orderRes.rows.length === 0) throw new HttpError(404, "Không tìm thấy đơn hàng");
        const ord = orderRes.rows[0];
        const orderTotal = Number(ord.total_amount) || 0;
        const existingSlips = parseJsonArray(ord.invoiced_delivery_slips);

        const newSlipAmount = Number(invoice_amount) || 0;
        // Sửa hóa đơn đã xuất của phiếu: chỉ Kế toán / Quản trị viên
        const prevRec = existingSlips.find((s: any) => s.delivery_slip_id === delivery_slip_id) || null;
        if (prevRec) {
          if (!isAccountantUser(authUser)) {
            throw new HttpError(403, "Phiếu này đã xuất hóa đơn. Chỉ Kế toán / Quản trị viên được sửa số hóa đơn.");
          }
        }
        const otherSlipsTotal = existingSlips
          .filter((s: any) => s.delivery_slip_id !== delivery_slip_id)
          .reduce((sum: number, s: any) => sum + (Number(s.invoice_amount) || 0), 0);
        const projectedInvoicedTotal = otherSlipsTotal + newSlipAmount;

        // Chốt chặn logic an toàn: Tránh xuất hóa đơn vượt quá giá trị đơn hàng
        if (orderTotal > 0 && projectedInvoicedTotal > Math.round(orderTotal * 1.05)) {
          throw new HttpError(400, `Tổng tiền hóa đơn lũy kế (${projectedInvoicedTotal.toLocaleString('vi-VN', { maximumFractionDigits: 0 })} đ) vượt quá tổng giá trị đơn hàng (${orderTotal.toLocaleString('vi-VN', { maximumFractionDigits: 0 })} đ)! Vui lòng đối soát lại số tiền phiếu giao.`);
        }

        const newRecord = {
          delivery_slip_id,
          invoice_no: invNoClean,
          invoice_date: invoice_date ? parseSqlDate(invoice_date) : todayVN(),
          invoice_amount: newSlipAmount,
          invoice_files: invoice_files || [],
          invoiced_items: invoiced_items || [],
          created_at: new Date().toISOString()
        };

        const updatedSlips = [...existingSlips.filter((s: any) => s.delivery_slip_id !== delivery_slip_id), newRecord];
        const isActuallyFullyInvoiced = is_final || (orderTotal > 0 && projectedInvoicedTotal >= orderTotal * 0.99);
        const newStatus = isActuallyFullyInvoiced ? "ISSUED" : "PARTIALLY_INVOICED";

        // Số HĐ cấp đơn = số HĐ đầu tiên; nếu đang sửa chính số đó thì cập nhật theo
        await c.query(
          `UPDATE sales_orders
           SET invoiced_delivery_slips = $1::jsonb,
               invoice_status = $2,
               invoice_no = CASE WHEN invoice_no IS NULL OR ($6::text IS NOT NULL AND invoice_no = $6::text) THEN $3 ELSE invoice_no END,
               invoice_date = CASE WHEN invoice_date IS NULL OR ($6::text IS NOT NULL AND invoice_no = $6::text) THEN $4::date ELSE invoice_date END
           WHERE id = $5`,
          [JSON.stringify(updatedSlips), newStatus, invNoClean, newRecord.invoice_date, ord.id, prevRec ? String(prevRec.invoice_no || "") || null : null]
        );

        if (delivery_slip_id) {
          await c.query(
            `UPDATE sales_delivery_slips
             SET invoice_number = $1, invoice_date = $2, updated_at = CURRENT_TIMESTAMP
             WHERE slip_code = $3`,
            [invNoClean, newRecord.invoice_date, delivery_slip_id]
          );
        }
        return { ord, updatedSlips, newStatus, prevRec };
      });

      await logAudit(
        result.prevRec ? "EDIT_INVOICE" : "PARTIAL_INVOICE",
        "SALES_ORDER",
        result.prevRec
          ? `Sửa HĐ phiếu ${delivery_slip_id} (Đơn ${result.ord.order_code}): ${result.prevRec.invoice_no} -> ${invNoClean}, ${Number(result.prevRec.invoice_amount || 0).toLocaleString("vi-VN", { maximumFractionDigits: 0 })} -> ${(Number(invoice_amount) || 0).toLocaleString("vi-VN", { maximumFractionDigits: 0 })} đ`
          : `Xuất HĐ ${invNoClean} cho Phiếu Giao Hàng ${delivery_slip_id} (Đơn ${result.ord.order_code})`
      );
      return NextResponse.json({ success: true, invoiced_delivery_slips: result.updatedSlips, invoice_status: result.newStatus });
    }

    // Thu tiền khách hàng (Kế toán): ghi sổ thanh toán, cập nhật số đã thu và trạng thái thanh toán của đơn.
    // Bấm 2 lần / gửi lại cùng request_id không bị ghi trùng. Không cho thu vượt giá trị đơn.
    if (action === "record_customer_payment") {
      const me = await getAuthorizedUser(req);
      setAuditActor(me);
      if (!me) return unauthorizedResponse();
      if (!isAccountantUser(me)) {
        return forbiddenResponse("Chỉ Kế toán / Ban Giám Đốc mới được ghi nhận thu tiền khách hàng.");
      }
      const amount = Math.round((Number(body.amount) || 0) * 100) / 100;
      if (!(amount > 0)) return NextResponse.json({ error: "Số tiền thu phải lớn hơn 0" }, { status: 400 });
      const payDate = body.payment_date ? parseSqlDate(body.payment_date) : todayVN();
      const requestId = body.request_id ? String(body.request_id).slice(0, 100) : null;

      const result = await withTransaction(async (c) => {
        const lookupCode = String(body.order_code || body.order_id || "").trim() || null;
        let ord = (await c.query(
          "SELECT id, order_code, total_amount, COALESCE(amount_paid, 0) AS amount_paid, payment_status FROM sales_orders WHERE (CASE WHEN $2::text IS NOT NULL AND $2::text !~ '^[0-9]+$' THEN UPPER(TRIM(order_code)) = UPPER(TRIM($2::text)) ELSE id = $1::int END) ORDER BY id LIMIT 1 FOR UPDATE",
          [numericIdOrNull(body.order_id), lookupCode]
        )).rows[0];
        if (!ord && lookupCode) {
          // Nếu đơn SO vừa tạo trong sales_factory_orders (app_storage) nhưng chưa đồng bộ sang bảng sales_orders: tự động khởi tạo vào sales_orders
          const stRow = (await c.query("SELECT data FROM app_storage WHERE key = 'sales_factory_orders' FOR UPDATE")).rows[0];
          const foList: any[] = Array.isArray(stRow?.data) ? stRow.data : [];
          const fo = foList.find((x: any) => {
            const c1 = String(x?.linkedSalesOrderId || "").trim().toUpperCase();
            const c2 = String(x?.id || "").trim().toUpperCase();
            const c3 = String(x?.order_code || "").trim().toUpperCase();
            const target = lookupCode.toUpperCase();
            return (c1 && c1 === target) || (c2 && c2 === target) || (c3 && c3 === target);
          });
          if (fo) {
            const canonicalCode = String(fo.linkedSalesOrderId || fo.order_code || fo.id || lookupCode).trim();
            const foItems = Array.isArray(fo.items) ? fo.items : [];
            const foTotal = Math.round(foItems.filter((it: any) => it?.status !== "CANCELLED").reduce((s: number, it: any) => s + (Number(it?.quantity) || 0) * (Number(it?.unitPrice ?? it?.unit_price ?? it?.price) || 0), 0)) || Number(fo.totalAmount ?? fo.total_amount) || 0;
            const ins = await c.query(
              `INSERT INTO sales_orders (order_code, customer_name, sales_rep_name, order_date, items, total_amount, delivery_status, payment_status, amount_paid)
               VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, 'UNPAID', 0)
               RETURNING id, order_code, total_amount, COALESCE(amount_paid, 0) AS amount_paid, payment_status`,
              [
                canonicalCode,
                fo.customerName || fo.customer_name || "Khách hàng",
                fo.salesRep || fo.sales_rep_name || me.full_name || me.username,
                fo.createdAt ? parseSqlDate(fo.createdAt) : todayVN(),
                JSON.stringify(foItems),
                foTotal,
                fo.isDelivered ? "DELIVERED" : "PENDING"
              ]
            );
            ord = ins.rows[0];
          }
        }
        if (!ord) throw new HttpError(404, "Không tìm thấy đơn hàng");
        if (requestId) {
          const dup = await c.query("SELECT id FROM sales_payments WHERE order_id = $1 AND request_id = $2", [ord.id, requestId]);
          if (dup.rows[0]) return { ord, duplicate: true, paid: Number(ord.amount_paid), status: ord.payment_status };
        }
        const total = Number(ord.total_amount) || 0;
        const paidBefore = Number(ord.amount_paid) || 0;
        if (total > 0 && paidBefore + amount > total + 0.5) {
          throw new HttpError(409, `Đơn ${ord.order_code}: giá trị ${total.toLocaleString("vi-VN", { maximumFractionDigits: 0 })} đ, đã thu ${paidBefore.toLocaleString("vi-VN", { maximumFractionDigits: 0 })} đ — khoản thu ${amount.toLocaleString("vi-VN", { maximumFractionDigits: 0 })} đ vượt số còn phải thu.`);
        }
        // Phân bổ khoản thu theo phiếu giao (Kế toán chọn phiếu nào được thanh toán). Không gửi -> khoản thu chung / tiền cọc của đơn.
        const rawAlloc: any[] = Array.isArray(body.allocations) && body.allocations.length > 0
          ? body.allocations
          : [{ delivery_slip_code: body.delivery_slip_code || null, amount }];
        const alloc = rawAlloc
          .map((a: any) => ({ slip: a?.delivery_slip_code ? String(a.delivery_slip_code).trim() : null, amount: Math.round((Number(a?.amount) || 0) * 100) / 100 }))
          .filter((a: any) => a.amount > 0);
        const allocSum = alloc.reduce((s: number, a: any) => s + a.amount, 0);
        if (Math.abs(allocSum - amount) > 0.5) throw new HttpError(400, "Tổng tiền phân bổ cho các phiếu giao phải bằng số tiền thu");
        const slipCodes = alloc.map((a: any) => a.slip).filter(Boolean);
        if (slipCodes.length > 0) {
          const slipRows = (await c.query("SELECT slip_code, order_code, items FROM sales_delivery_slips WHERE slip_code = ANY($1::text[])", [slipCodes])).rows;
          const oItems = parseJsonArray((await c.query("SELECT items FROM sales_orders WHERE id = $1", [ord.id])).rows[0]?.items);
          const unitOf = (code: string) => { const it = oItems.find((x: any) => String(x?.productCode || x?.product_code || "") === code); return Number(it?.unitPrice ?? it?.price) || 0; };
          for (const a of alloc) {
            if (!a.slip) continue;
            const sr = slipRows.find((r: any) => r.slip_code === a.slip);
            if (!sr || String(sr.order_code || "") !== String(ord.order_code)) throw new HttpError(400, `Phiếu giao ${a.slip} không thuộc đơn ${ord.order_code}`);
            const value = Math.round(parseJsonArray(sr.items).reduce((s: number, it: any) => {
              const code = String(it?.productCode || it?.product_code || "");
              return s + (Number(it?.quantity) || 0) * (Number(it?.unitPrice ?? it?.price) || unitOf(code));
            }, 0));
            const paidSlip = Number((await c.query("SELECT COALESCE(SUM(amount), 0) AS s FROM sales_payments WHERE order_id = $1 AND delivery_slip_code = $2 AND voided_at IS NULL", [ord.id, a.slip])).rows[0]?.s) || 0;
            if (value > 0 && paidSlip + a.amount > value + 0.5) {
              throw new HttpError(409, `Phiếu ${a.slip}: giá trị ${value.toLocaleString("vi-VN", { maximumFractionDigits: 0 })} đ, đã thu ${paidSlip.toLocaleString("vi-VN", { maximumFractionDigits: 0 })} đ — không thu vượt.`);
            }
          }
        }
        for (let i = 0; i < alloc.length; i++) {
          await c.query(
            `INSERT INTO sales_payments (order_id, order_code, amount, payment_date, method, reference, notes, request_id, created_by, delivery_slip_code)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [ord.id, ord.order_code, alloc[i].amount, payDate, body.method || "Chuyển khoản", body.reference || null, body.notes || null,
             requestId ? (i === 0 ? requestId : `${requestId}#${i}`) : null, me.full_name || me.username, alloc[i].slip]
          );
        }
        const paid = paidBefore + amount;
        const status = total > 0 && paid >= total - 0.5 ? "PAID" : "PARTIALLY_PAID";
        await c.query("UPDATE sales_orders SET amount_paid = $1, payment_status = $2 WHERE id = $3", [paid, status, ord.id]);

        // Đồng bộ ngay amountPaid & payment_status vào sales_factory_orders (app_storage) để giao diện SO / Sale / Admin thấy tức thì
        try {
          const stRow = (await c.query("SELECT data FROM app_storage WHERE key = 'sales_factory_orders' FOR UPDATE")).rows[0];
          if (Array.isArray(stRow?.data)) {
            const targetUpper = String(ord.order_code || "").trim().toUpperCase();
            let touched = false;
            const nextFo = stRow.data.map((fo: any) => {
              const c1 = String(fo?.linkedSalesOrderId || "").trim().toUpperCase();
              const c2 = String(fo?.id || "").trim().toUpperCase();
              const c3 = String(fo?.order_code || "").trim().toUpperCase();
              if (c1 === targetUpper || c2 === targetUpper || c3 === targetUpper) {
                touched = true;
                return { ...fo, amountPaid: paid, amount_paid: paid, payment_status: status };
              }
              return fo;
            });
            if (touched) {
              await c.query(
                "UPDATE app_storage SET data = $1::jsonb, version = COALESCE(version, 1) + 1, updated_at = now() WHERE key = 'sales_factory_orders'",
                [JSON.stringify(nextFo)]
              );
            }
          }
        } catch { /* ignore storage sync error */ }

        return { ord, duplicate: false, paid, status };
      });
      if (!result.duplicate) {
        await logAudit("CUSTOMER_PAYMENT", "SALES_ORDER", `Thu ${amount.toLocaleString("vi-VN", { maximumFractionDigits: 0 })} đ đơn ${result.ord.order_code} (${result.status})`, me.username, me.full_name);
        notifyZaloProactiveEvent({
          eventType: "INVOICE_OR_PAYMENT_RECORDED",
          code: result.ord.order_code,
          totalAmount: amount,
          reasonOrNote: `Kế toán ghi nhận thu tiền khách hàng (${result.status === "PAID" ? "Đã thu đủ 100%" : "Thu 1 phần"}) bởi ${me.full_name || me.username}`
        }).catch(() => {});
      }
      return NextResponse.json({ success: true, amount_paid: result.paid, payment_status: result.status, duplicate: result.duplicate });
    }

    // Hủy khoản thu ghi nhầm (Kế toán / Quản trị): giữ trong sổ, tính lại số đã thu & trạng thái thanh toán. "Sửa" = hủy rồi ghi lại.
    if (action === "void_customer_payment") {
      const me = await getAuthorizedUser(req);
      setAuditActor(me);
      if (!me) return unauthorizedResponse();
      if (!isAccountantUser(me)) {
        return forbiddenResponse("Chỉ Kế toán / Ban Giám Đốc mới được hủy hoặc sửa khoản thu.");
      }
      const pid = Number(body.payment_id);
      const reason = String(body.reason || "").trim();
      if (!Number.isInteger(pid) || pid <= 0) return NextResponse.json({ error: "Thiếu khoản thu cần hủy" }, { status: 400 });
      if (!reason) return NextResponse.json({ error: "Nhập lý do hủy khoản thu" }, { status: 400 });
      const result = await withTransaction(async (c) => {
        const pay = (await c.query("SELECT id, order_id, order_code, amount, voided_at FROM sales_payments WHERE id = $1 FOR UPDATE", [pid])).rows[0];
        if (!pay) throw new HttpError(404, "Không tìm thấy khoản thu");
        if (pay.voided_at) throw new HttpError(409, "Khoản thu này đã được hủy trước đó");
        const ord = (await c.query("SELECT id, total_amount FROM sales_orders WHERE id = $1 FOR UPDATE", [pay.order_id])).rows[0];
        await c.query("UPDATE sales_payments SET voided_at = now(), voided_by = $1, void_reason = $2 WHERE id = $3", [me.full_name || me.username, reason.slice(0, 500), pid]);
        const paid = Number((await c.query("SELECT COALESCE(SUM(amount), 0) AS s FROM sales_payments WHERE order_id = $1 AND voided_at IS NULL", [pay.order_id])).rows[0]?.s) || 0;
        const total = Number(ord?.total_amount) || 0;
        const status = paid <= 0 ? "UNPAID" : (total > 0 && paid >= total - 0.5 ? "PAID" : "PARTIALLY_PAID");
        await c.query("UPDATE sales_orders SET amount_paid = $1, payment_status = $2 WHERE id = $3", [paid, status, pay.order_id]);
        try {
          const stRow = (await c.query("SELECT data FROM app_storage WHERE key = 'sales_factory_orders' FOR UPDATE")).rows[0];
          if (Array.isArray(stRow?.data)) {
            const targetUpper = String(pay.order_code || "").trim().toUpperCase();
            let touched = false;
            const nextFo = stRow.data.map((fo: any) => {
              const c1 = String(fo?.linkedSalesOrderId || "").trim().toUpperCase();
              const c2 = String(fo?.id || "").trim().toUpperCase();
              const c3 = String(fo?.order_code || "").trim().toUpperCase();
              if (c1 === targetUpper || c2 === targetUpper || c3 === targetUpper) {
                touched = true;
                return { ...fo, amountPaid: paid, amount_paid: paid, payment_status: status };
              }
              return fo;
            });
            if (touched) {
              await c.query(
                "UPDATE app_storage SET data = $1::jsonb, version = COALESCE(version, 1) + 1, updated_at = now() WHERE key = 'sales_factory_orders'",
                [JSON.stringify(nextFo)]
              );
            }
          }
        } catch { /* ignore storage sync error */ }
        return { order_code: pay.order_code, amount: Number(pay.amount) || 0, paid, status };
      });
      await logAudit("VOID_CUSTOMER_PAYMENT", "SALES_ORDER", `Hủy khoản thu ${result.amount.toLocaleString("vi-VN", { maximumFractionDigits: 0 })} đ đơn ${result.order_code}: ${reason}`, me.username, me.full_name);
      return NextResponse.json({ success: true, amount_paid: result.paid, payment_status: result.status, order_code: result.order_code });
    }

    // 2.1 Release Credit Block (Accounting unblock) - Requirement 10 & 11
    if (action === "release_credit") {
      const me = await getAuthorizedUser(req);
      setAuditActor(me);
      if (!me) return unauthorizedResponse();
      if (!isAccountantUser(me)) {
        return forbiddenResponse("Chỉ Kế toán / Ban Giám Đốc mới được mở khóa công nợ.");
      }
      const { order_id, override_reason } = body;
      const override_by = me.full_name || me.username;
      // order_id from the UI is the order code: match the numeric id or the code
      const upd = await query(
        `UPDATE sales_orders
         SET is_credit_blocked = false,
             credit_override_by = $1,
             credit_override_at = CURRENT_TIMESTAMP,
             credit_override_reason = $2
         WHERE (CASE WHEN $4::text IS NOT NULL AND $4::text !~ '^[0-9]+$' THEN order_code = $4::text ELSE id = $3::int END)`,
        [override_by || "Kế Toán Trưởng", override_reason || "Kế toán bảo lãnh mở khóa", numericIdOrNull(order_id), String(body.order_code || order_id || "").trim() || null]
      );
      if (upd.rowCount === 0) return NextResponse.json({ error: "Không tìm thấy đơn hàng trong CSDL" }, { status: 404 });
      await logAudit("RELEASE_CREDIT", "SALES_ORDER", `Kế toán ${override_by} mở khóa công nợ cho đơn #${order_id}: ${override_reason}`);
      return NextResponse.json({ success: true });
    }

    // 2.2 Approve Price Policy / Zero-price Item - Requirement 12 & 13
    if (action === "approve_price") {
      const me = await getAuthorizedUser(req);
      setAuditActor(me);
      if (!me) return unauthorizedResponse();
      if (
        !hasPermission(me, "sales.approve_zero_price") &&
        !hasPermission(me, "sales.approve_quotes") &&
        !hasPermission(me, "sales.approve_discount") &&
        !hasPermission(me, "sales.approve_orders") &&
        !isAdminUser(me)
      ) {
        return forbiddenResponse("Chỉ Ban Giám Đốc hoặc nhân sự được phân quyền duyệt báo giá / đơn hàng 0đ mới được duyệt đơn 0đ / quà tặng.");
      }
      const { order_id, notes } = body;
      const isRejected = body.approve === false || body.status === "REJECTED";
      const approved_by = me.full_name || me.username;
      const nextPriceStatus = isRejected ? "REJECTED" : "APPROVED";
      const defaultNote = isRejected
        ? `Từ chối đơn 0đ/quà tặng bởi ${approved_by || "Quản lý"}`
        : `Duyệt giá/quà tặng bởi ${approved_by || "Quản lý"}`;
      const upd = await query(
        `UPDATE sales_orders
         SET price_approval_status = $4::text,
             price_approval_notes = $1::text,
             approval_status = CASE WHEN $4::text = 'REJECTED' THEN 'REJECTED' WHEN NOT COALESCE(is_credit_blocked, FALSE) THEN 'APPROVED' ELSE approval_status END,
             approved_by = COALESCE($5::text, approved_by),
             approved_at = CURRENT_TIMESTAMP
         WHERE (CASE WHEN $3::text IS NOT NULL AND $3::text !~ '^[0-9]+$' THEN order_code = $3::text ELSE id = $2::int END)`,
        [notes || body.approval_notes || defaultNote, numericIdOrNull(order_id), String(body.order_code || order_id || "").trim() || null, nextPriceStatus, approved_by]
      );
      // Đồng bộ trực tiếp vào app_storage (sales_factory_orders) để tránh lệch trạng thái khi F5 hoặc khi đơn có mã chuẩn hóa
      let updatedInStorage = false;
      try {
        const targetCode = String(body.order_code || order_id || "").trim();
        if (targetCode) {
          await withTransaction(async (c) => {
            const cur = await c.query("SELECT data, version FROM app_storage WHERE key = 'sales_factory_orders' FOR UPDATE");
            const arr = cur.rows[0]?.data;
            if (Array.isArray(arr)) {
              let changed = false;
              const nextArr = arr.map((it: any) => {
                const itCode = String(it?.order_code || it?.id || "").trim();
                if (itCode === targetCode || String(it?.id || "") === String(order_id || "")) {
                  changed = true;
                  return {
                    ...it,
                    priceApprovalStatus: nextPriceStatus,
                    price_approval_status: nextPriceStatus,
                    status: isRejected ? "Rejected" : (it.isCreditBlocked ? it.status : "Approved"),
                    approvedBy: approved_by,
                    approvedAt: new Date().toISOString()
                  };
                }
                return it;
              });
              if (changed) {
                updatedInStorage = true;
                await c.query(
                  `UPDATE app_storage SET data = $1, version = COALESCE(version, 1) + 1, updated_at = now() WHERE key = 'sales_factory_orders'`,
                  [JSON.stringify(nextArr)]
                );
              }
            }
          });
        }
      } catch {}
      if (upd.rowCount === 0 && !updatedInStorage) {
        return NextResponse.json({ error: "Không tìm thấy đơn hàng trong CSDL" }, { status: 404 });
      }
      await logAudit(isRejected ? "REJECT_PRICE" : "APPROVE_PRICE", "SALES_ORDER", `${isRejected ? "Từ chối" : "Duyệt"} giá/quà tặng cho đơn SO #${order_id} bởi ${approved_by}`);
      return NextResponse.json({ success: true, status: nextPriceStatus, approved_by });
    }

    // 2.3 Reserve Stock for Sales with TTL Expiry - Requirement 6
    if (action === "reserve_stock") {
      const { order_code, customer_name, sales_rep_name, product_code, product_name, lot_number, quantity_reserved, hold_until_date, notes } = body;
      const orderCode = order_code || (await generateDocumentCode({ docType: "RES", tagMode: "GENERAL" } as any));
      const reservationId = await withTransaction((c) =>
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
      await logAudit("RESERVE_STOCK", "INVENTORY", `Sales ${sales_rep_name} giữ ${quantity_reserved} ${product_code} cho đơn ${orderCode} đến ngày ${hold_until_date}`);
      return NextResponse.json({ success: true, id: reservationId });
    }

    // 2.4 Release Stock Reservation - Requirement 6
    if (action === "release_reservation") {
      const { reservation_id, reason, actor } = body;
      await withTransaction((c) =>
        releaseReservation(c, Number(reservation_id), actor || "Hệ thống", reason || "Hết hạn giữ chỗ hoặc đơn đã xuất")
      );
      await logAudit("RELEASE_RESERVATION", "INVENTORY", `Giải phóng giữ chỗ ID #${reservation_id}: ${reason}`);
      return NextResponse.json({ success: true });
    }

    if (action === "update_invoice") {
      if (!orderInvoiceNotesColumnEnsured) {
        try {
          await query("ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS invoice_notes TEXT");
          orderInvoiceNotesColumnEnsured = true;
        } catch (err) {}
      }
      const { order_id, invoice_no, invoice_date, invoice_status, invoice_files, invoice_notes, invoiceNotes } = body;
      const cur = await query(
        "SELECT id, invoice_status FROM sales_orders WHERE (CASE WHEN $2::text IS NOT NULL AND $2::text !~ '^[0-9]+$' THEN order_code = $2::text ELSE id = $1::int END) ORDER BY id LIMIT 1",
        [numericIdOrNull(order_id), String(body.order_code || order_id || "").trim() || null]
      );
      if (cur.rows.length === 0) return NextResponse.json({ error: "Không tìm thấy đơn hàng" }, { status: 404 });
      const safeInvoiceStatus = resolveMonotonicStatus(cur.rows[0].invoice_status, invoice_status || "INVOICED", INVOICE_STATUS_HIERARCHY, Boolean(body.force_rollback));
      const hasInvNotes = invoice_notes !== undefined || invoiceNotes !== undefined;
      await query(
        `UPDATE sales_orders
            SET invoice_no = COALESCE($1, invoice_no), invoice_date = COALESCE($2, invoice_date), invoice_status = $3,
                invoice_files = CASE WHEN $6::boolean THEN $4::jsonb ELSE invoice_files END,
                invoice_notes = CASE WHEN $7::boolean THEN $8::text ELSE invoice_notes END
          WHERE id = $5`,
        [invoice_no || null, invoice_date || null, safeInvoiceStatus, JSON.stringify(invoice_files || []), cur.rows[0].id, invoice_files !== undefined, hasInvNotes, (invoice_notes ?? invoiceNotes) || null]
      );
      await logAudit("UPDATE_INVOICE", "SALES_ORDER", `Cập nhật HĐ ${invoice_no} cho đơn hàng ID ${order_id}`);
      return NextResponse.json({ success: true });
    }

    if (action === "quotation") {
      const code = body.quote_code || body.id;
      const custName = body.customer_name || body.customerName || "Khách Hàng";
      const repName = body.sales_rep_name || body.salesRepName || "Nhân viên kinh doanh";

      let validCustId: number | null = null;
      const cid = body.customer_id || body.customerId;
      if (cid) {
        const parsedId = parseInt(cid);
        if (!isNaN(parsedId)) {
          const cCheck = await query("SELECT id FROM sales_customers WHERE id = $1", [parsedId]);
          if (cCheck.rows.length > 0) validCustId = parsedId;
        }
      }

      if (!validCustId && custName) {
        const byName = await query("SELECT id FROM sales_customers WHERE LOWER(TRIM(name)) = LOWER(TRIM($1)) LIMIT 1", [String(custName)]);
        if (byName.rows[0]) validCustId = byName.rows[0].id;
      }
      const dateVal = parseSqlDate(body.date);
      const validUntilVal = body.valid_until ? parseSqlDate(body.valid_until) : (body.validUntil ? parseSqlDate(body.validUntil) : null);
      const items = Array.isArray(body.items) ? body.items : (typeof body.items === 'string' ? JSON.parse(body.items || '[]') : []);
      const subtotal = Number(body.subtotal !== undefined ? body.subtotal : body.totalBeforeVat) || 0;
      const discountRate = Number(body.discount_rate !== undefined ? body.discount_rate : body.discountRate) || 0;
      const discountAmount = Number(body.discount_amount !== undefined ? body.discount_amount : body.totalDiscount) || 0;
      const taxRate = Number(body.tax_rate !== undefined ? body.tax_rate : body.taxRate) || 8;
      const taxAmount = Number(body.tax_amount !== undefined ? body.tax_amount : body.totalVat) || 0;
      const totalAmount = Number(body.total_amount !== undefined ? body.total_amount : body.totalAmount) || 0;
      const status = body.status || "DRAFT";
      const terms = body.terms !== undefined ? body.terms : (body.paymentTerms !== undefined ? body.paymentTerms : "");

      if (discountRate < 0 || discountRate > 100) {
        return NextResponse.json({ error: "Tỷ lệ chiết khấu báo giá phải nằm trong khoảng 0% - 100%." }, { status: 400 });
      }
      if (subtotal < 0 || discountAmount < 0 || taxRate < 0 || taxAmount < 0 || totalAmount < 0) {
        return NextResponse.json({ error: "Giá trị tiền hoặc thuế của báo giá không được là số âm." }, { status: 400 });
      }
      for (const it of items) {
        const q = Number(it.quantity ?? it.qty ?? 0);
        const p = Number(it.unit_price ?? it.unitPrice ?? it.price ?? 0);
        if (q < 0 || p < 0) {
          return NextResponse.json({ error: "Số lượng và đơn giá mặt hàng trong báo giá không được là số âm." }, { status: 400 });
        }
      }

      let finalCode = (code && /^BG\d{2}-[A-Z0-9]{2}-\d{4}$/.test(code))
        ? code
        : (code && String(code).trim().length > 0 ? String(code).trim() : null);

      if (!finalCode) {
        finalCode = await generateDocumentCode({
          docType: "BG",
          customerName: custName,
          salesRepName: repName,
          tagMode: "CUSTOMER"
        });
      }

      // Thông tin mở rộng (người liên hệ KH, liên hệ NVKD) lưu vào cột JSONB extra_data
      if (!quotationExtraColumnEnsured) {
        try {
          await query("ALTER TABLE sales_quotations ADD COLUMN IF NOT EXISTS extra_data JSONB DEFAULT '{}'::jsonb");
          await query("CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_quotations_quote_code ON sales_quotations (quote_code)");
          quotationExtraColumnEnsured = true;
        } catch (err) {
          console.error("Failed to ensure sales_quotations schema:", err);
        }
      }
      const extra: Record<string, any> = {};
      for (const k of QUOTATION_EXTRA_KEYS) {
        if (body[k] !== undefined && body[k] !== null) extra[k] = body[k];
      }

      // Resilient check-and-upsert that never fails even without unique constraint
      let upsertRes;
      const existing = await query("SELECT id, extra_data FROM sales_quotations WHERE quote_code = $1", [finalCode]);
      if (existing.rows.length > 0) {
        upsertRes = await query(
          `UPDATE sales_quotations SET
            customer_id = $2, customer_name = $3, sales_rep_name = $4,
            date = $5, valid_until = $6, items = $7, subtotal = $8, discount_rate = $9,
            discount_amount = $10, tax_rate = $11, tax_amount = $12, total_amount = $13,
            status = $14, terms = $15, extra_data = COALESCE(sales_quotations.extra_data, '{}'::jsonb) || $16
           WHERE quote_code = $1 RETURNING *`,
          [
            finalCode, validCustId, custName, repName,
            dateVal, validUntilVal, JSON.stringify(items), subtotal, discountRate,
            discountAmount, taxRate, taxAmount, totalAmount, status, terms, JSON.stringify(extra)
          ]
        );
      } else {
        upsertRes = await query(
          `INSERT INTO sales_quotations (
            quote_code, customer_id, customer_name, sales_rep_name, 
            date, valid_until, items, subtotal, discount_rate, 
            discount_amount, tax_rate, tax_amount, total_amount, status, terms, extra_data
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
          RETURNING *`,
          [
            finalCode, validCustId, custName, repName,
            dateVal, validUntilVal, JSON.stringify(items), subtotal, discountRate,
            discountAmount, taxRate, taxAmount, totalAmount, status, terms, JSON.stringify(extra)
          ]
        );
      }

      await logAudit("UPSERT", "SALES_QUOTE", `Lưu báo giá quan hệ ${finalCode}`);
      if (status === "PENDING_APPROVAL" || status === "PENDING_DIRECTOR_APPROVAL" || extra.hasZeroPriceItems) {
        notifyZaloProactiveEvent({
          eventType: "QUOTE_APPROVAL_NEEDED",
          code: finalCode,
          customerName: custName,
          salesRepName: repName,
          totalAmount,
          reasonOrNote: extra.hasZeroPriceItems
            ? "Báo giá có mặt hàng 0 đồng / Hàng mẫu"
            : `Chiết khấu ${discountRate}% cần phê duyệt`
        }).catch(() => {});
      }

      // Synchronize fresh list to app_storage for dual-write compatibility
      try {
        const allQ = await query("SELECT * FROM sales_quotations ORDER BY id DESC");
        const normalizedList = allQ.rows.map(normalizeQuotationRow);
        await query(
          `INSERT INTO app_storage (key, data, updated_at) VALUES ($1, $2, CURRENT_TIMESTAMP)
           ON CONFLICT (key) DO UPDATE SET data = $2, version = COALESCE(app_storage.version, 1) + 1, updated_at = CURRENT_TIMESTAMP`,
          ["sales_quotations", JSON.stringify(normalizedList)]
        );
      } catch (err) {
        console.error("Failed to sync sales_quotations to app_storage:", err);
      }

      return NextResponse.json({ success: true, quotation: normalizeQuotationRow(upsertRes.rows[0]) });
    }

    if (action === "delete_quotation") {
      const { id, quote_code } = body;
      const targetCode = quote_code || (typeof id === 'string' && isNaN(Number(id)) ? id : null);
      const targetId = !isNaN(Number(id)) ? Number(id) : null;

      await query(
        "DELETE FROM sales_quotations WHERE quote_code = $1 OR id = $2",
        [targetCode, targetId]
      );
      await logAudit("DELETE", "SALES_QUOTE", `Xóa báo giá ${targetCode || targetId}`);

      // Sync fresh snapshot to app_storage
      try {
        const allQ = await query("SELECT * FROM sales_quotations ORDER BY id DESC");
        const normalizedList = allQ.rows.map(normalizeQuotationRow);
        await query(
          `INSERT INTO app_storage (key, data, updated_at) VALUES ($1, $2, CURRENT_TIMESTAMP)
           ON CONFLICT (key) DO UPDATE SET data = $2, version = COALESCE(app_storage.version, 1) + 1, updated_at = CURRENT_TIMESTAMP`,
          ["sales_quotations", JSON.stringify(normalizedList)]
        );
      } catch (err) {}

      return NextResponse.json({ success: true });
    }

    if (action === "task") {
      const { id, task_code, title, assignee_code, assignee_name, customer_name, priority, status, deadline, description, logs } = body;
      if (id) {
        await query(
          `UPDATE sales_tasks SET title=$1, assignee_code=$2, assignee_name=$3, customer_name=$4, priority=$5, status=$6, deadline=$7, description=$8, logs=$9 WHERE id=$10`,
          [title, assignee_code, assignee_name, customer_name, priority, status, deadline, description, JSON.stringify(logs || []), id]
        );
      } else {
        const code = task_code || `TSK-${Date.now().toString().slice(-5)}`;
        await query(
          `INSERT INTO sales_tasks (task_code, title, assignee_code, assignee_name, customer_name, priority, status, deadline, description, logs)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [code, title, assignee_code, assignee_name, customer_name, priority || "MEDIUM", status || "TODO", deadline, description, JSON.stringify(logs || [])]
        );
      }
      return NextResponse.json({ success: true });
    }

    if (action === "daily") {
      const { log_date, employee_code, employee_name, work_content, result, issues, next_day_plan } = body;
      await query(
        `INSERT INTO sales_daily_logs (log_date, employee_code, employee_name, work_content, result, issues, next_day_plan)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [log_date || todayVN(), employee_code, employee_name, work_content, result, issues, next_day_plan]
      );
      return NextResponse.json({ success: true });
    }

    if (action === "update_product_price" || action === "product_price") {
      const { code, standard_price, cost_price, priceDealer1, priceDealer2 } = body;
      if (!code) {
        return NextResponse.json({ error: "Thiếu mã sản phẩm" }, { status: 400 });
      }

      await query(
        `UPDATE products 
         SET standard_price = COALESCE($1, standard_price), 
             cost_price = COALESCE($2, cost_price) 
         WHERE code = $3`,
        [standard_price !== undefined ? Number(standard_price) : null, cost_price !== undefined ? Number(cost_price) : null, code]
      );

      // Đồng bộ giá sang danh mục hàng thương mại (bảng catalog_items, mỗi mặt hàng một dòng)
      try {
        await mergeCatalogFields(null, code, {
          price: standard_price !== undefined ? Number(standard_price) : undefined,
          costPrice: cost_price !== undefined ? Number(cost_price) : undefined,
          priceDealer1: priceDealer1 !== undefined ? Number(priceDealer1) : (standard_price !== undefined ? Math.round(Number(standard_price) * 0.85) : undefined),
          priceDealer2: priceDealer2 !== undefined ? Number(priceDealer2) : (standard_price !== undefined ? Math.round(Number(standard_price) * 0.8) : undefined),
        });
      } catch (err) {
        console.error("Failed to sync catalog price update:", err);
      }

      return NextResponse.json({ success: true });
    }

    if (action === "product") {
      const { id, code, name, category, unit, specification, standard_price, cost_price, manufacturer, origin, min_stock_level } = body;
      if (id) {
        await query(
          `UPDATE products SET name=$1, category=$2, unit=$3, specification=$4, standard_price=$5, cost_price=$6, manufacturer=$7, origin=$8, min_stock_level=$9 WHERE id=$10`,
          [name, category, unit, specification, standard_price, cost_price, manufacturer, origin, min_stock_level, id]
        );
      } else {
        const existing = await query("SELECT id FROM products WHERE code = $1", [code]);
        if (existing.rows.length > 0) {
          await query(
            `UPDATE products SET name=$1, category=$2, unit=$3, specification=$4, standard_price=$5, cost_price=$6, manufacturer=$7, origin=$8, min_stock_level=$9 WHERE code=$10`,
            [name, category, unit, specification, standard_price, cost_price, manufacturer, origin, min_stock_level, code]
          );
        } else {
          await query(
            `INSERT INTO products (code, name, category, unit, specification, standard_price, cost_price, manufacturer, origin, min_stock_level)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [code, name, category, unit, specification, standard_price, cost_price, manufacturer, origin, min_stock_level]
          );
        }
      }
      return NextResponse.json({ success: true });
    }

    // 3.1 Digital Contract Management with Signed Files & Expiry (Requirement 3)
    if (action === "contract") {
      const code = body.contract_code || body.id;
      const custName = body.customer_name || body.customerName || "Khách Hàng";
      const repName = body.sales_rep_name || body.salesRepName || "Nhân viên kinh doanh";

      let validCustId: number | null = null;
      const cid = body.customer_id || body.customerId;
      if (cid) {
        const parsedId = parseInt(cid);
        if (!isNaN(parsedId)) {
          const cCheck = await query("SELECT id FROM sales_customers WHERE id = $1", [parsedId]);
          if (cCheck.rows.length > 0) validCustId = parsedId;
        }
      }

      if (!validCustId && custName) {
        const byName = await query("SELECT id FROM sales_customers WHERE LOWER(TRIM(name)) = LOWER(TRIM($1)) LIMIT 1", [String(custName)]);
        if (byName.rows[0]) validCustId = byName.rows[0].id;
      }
      const title = body.contractTitle || body.title || "Hợp đồng mua bán";
      const signDate = parseSqlDate(body.signDate || body.sign_date || body.date);
      const validUntil = (body.validUntil || body.valid_until) ? parseSqlDate(body.validUntil || body.valid_until) : null;
      const totalVal = Number(body.total_value !== undefined ? body.total_value : (body.totalAmount !== undefined ? body.totalAmount : body.totalValue)) || 0;
      const status = body.status || "ACTIVE";
      const notes = body.notes || "";
      const contractFiles = Array.isArray(body.contract_files) ? body.contract_files : (Array.isArray(body.contractFiles) ? body.contractFiles : []);
      const items = Array.isArray(body.items) ? body.items : (typeof body.items === 'string' ? JSON.parse(body.items || '[]') : []);

      if (totalVal < 0) {
        return NextResponse.json({ error: "Giá trị hợp đồng không được là số âm." }, { status: 400 });
      }
      for (const it of items) {
        const q = Number(it.quantity ?? it.qty ?? 0);
        const p = Number(it.unit_price ?? it.unitPrice ?? it.price ?? 0);
        if (q < 0 || p < 0) {
          return NextResponse.json({ error: "Số lượng và đơn giá mặt hàng trong hợp đồng không được là số âm." }, { status: 400 });
        }
      }

      let finalCode = (code && /^HD\d{2}-[A-Z0-9]{2}-\d{4}$/.test(code))
        ? code
        : (code && String(code).trim().length > 0 ? String(code).trim() : null);

      if (!finalCode) {
        finalCode = await generateDocumentCode({
          docType: "HD",
          salesRepName: repName,
          customerName: custName,
          tagMode: "CUSTOMER"
        });
      }

      if (!contractExtraColumnEnsured) {
        try {
          await query("ALTER TABLE sales_contracts ADD COLUMN IF NOT EXISTS extra_data JSONB DEFAULT '{}'::jsonb");
          await query("CREATE UNIQUE INDEX IF NOT EXISTS sales_contracts_contract_code_uidx ON sales_contracts (contract_code)");
          contractExtraColumnEnsured = true;
        } catch (e) {}
      }
      const extraData: Record<string, any> = {};
      for (const k of CONTRACT_EXTRA_KEYS) {
        if (body[k] !== undefined) extraData[k] = body[k];
      }
      const dbStatus = (status === "Signed" || status === "ACTIVE") ? "ACTIVE" : ((status === "Draft" || status === "DRAFT") ? "DRAFT" : status);

      const upsertRes = await query(
        `INSERT INTO sales_contracts (
          contract_code, customer_id, customer_name, sales_rep_name, 
          title, sign_date, valid_until, total_value, status, notes, contract_files, items, extra_data
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $15::jsonb)
        ON CONFLICT (contract_code) DO UPDATE 
        SET customer_id = COALESCE(EXCLUDED.customer_id, sales_contracts.customer_id),
            customer_name = EXCLUDED.customer_name,
            sales_rep_name = COALESCE(NULLIF(EXCLUDED.sales_rep_name, ''), sales_contracts.sales_rep_name),
            title = EXCLUDED.title,
            sign_date = EXCLUDED.sign_date,
            valid_until = COALESCE(EXCLUDED.valid_until, sales_contracts.valid_until),
            total_value = EXCLUDED.total_value,
            status = EXCLUDED.status,
            notes = CASE WHEN EXCLUDED.notes <> '' THEN EXCLUDED.notes ELSE sales_contracts.notes END,
            contract_files = CASE WHEN $13::boolean THEN EXCLUDED.contract_files ELSE sales_contracts.contract_files END,
            items = CASE WHEN $14::boolean THEN EXCLUDED.items ELSE sales_contracts.items END,
            extra_data = COALESCE(sales_contracts.extra_data, '{}'::jsonb) || EXCLUDED.extra_data
        RETURNING *`,
        [
          finalCode, validCustId, custName, repName, title, signDate, validUntil, totalVal, dbStatus, notes, JSON.stringify(contractFiles), JSON.stringify(items),
          body.contract_files !== undefined || body.contractFiles !== undefined,
          body.items !== undefined,
          JSON.stringify(extraData)
        ]
      );

      await logAudit("CREATE_OR_UPDATE", "CONTRACT", `Lưu hợp đồng số hóa ${finalCode}`);

      // Sync fresh snapshot to app_storage (preserving rich fields and removing from deleted_sales_contracts if re-created)
      try {
        const delRes = await query("SELECT data FROM app_storage WHERE key = 'deleted_sales_contracts'");
        if (Array.isArray(delRes.rows[0]?.data) && delRes.rows[0].data.length > 0) {
          const nextDel = delRes.rows[0].data.filter((x: any) => String(x || '').trim().toUpperCase() !== String(finalCode).trim().toUpperCase());
          if (nextDel.length !== delRes.rows[0].data.length) {
            await query("UPDATE app_storage SET data = $1::jsonb, updated_at = CURRENT_TIMESTAMP WHERE key = 'deleted_sales_contracts'", [JSON.stringify(nextDel)]);
          }
        }
        const allC = await query("SELECT * FROM sales_contracts ORDER BY id DESC");
        const mergedList = await mergeContractsWithStorage(allC.rows);
        await query(
          `INSERT INTO app_storage (key, data, updated_at) VALUES ($1, $2, CURRENT_TIMESTAMP)
           ON CONFLICT (key) DO UPDATE SET data = $2, version = COALESCE(app_storage.version, 1) + 1, updated_at = CURRENT_TIMESTAMP`,
          ["sales_contracts", JSON.stringify(mergedList)]
        );
      } catch (err) {
        console.error("Failed to sync sales_contracts to app_storage:", err);
      }

      return NextResponse.json({ success: true, contract: normalizeContractRow(upsertRes.rows[0]) });
    }

    if (action === "delete_contract") {
      const { id, contract_code } = body;
      const targetCode = contract_code || (typeof id === 'string' && isNaN(Number(id)) ? id : null);
      const targetId = !isNaN(Number(id)) ? Number(id) : null;

      const delRows = await query(
        "DELETE FROM sales_contracts WHERE contract_code = $1 OR id = $2 RETURNING contract_code",
        [targetCode, targetId]
      );
      const deletedCode = String(targetCode || delRows.rows[0]?.contract_code || id || '').trim();
      await logAudit("DELETE", "CONTRACT", `Xóa hợp đồng ${deletedCode || targetId}`);

      // Record deleted code and sync fresh snapshot to app_storage
      try {
        if (deletedCode) {
          const delRes = await query("SELECT data FROM app_storage WHERE key = 'deleted_sales_contracts'");
          const prevDel = Array.isArray(delRes.rows[0]?.data) ? delRes.rows[0].data : [];
          if (!prevDel.some((x: any) => String(x || '').trim().toUpperCase() === deletedCode.toUpperCase())) {
            const nextDel = [...prevDel, deletedCode];
            await query(
              `INSERT INTO app_storage (key, data, updated_at) VALUES ('deleted_sales_contracts', $1::jsonb, CURRENT_TIMESTAMP)
               ON CONFLICT (key) DO UPDATE SET data = $1::jsonb, version = COALESCE(app_storage.version, 1) + 1, updated_at = CURRENT_TIMESTAMP`,
              [JSON.stringify(nextDel)]
            );
          }
        }
        const stRes = await query("SELECT data FROM app_storage WHERE key = 'sales_contracts'");
        if (Array.isArray(stRes.rows[0]?.data)) {
          const filteredSt = stRes.rows[0].data.filter((c: any) => {
            const ck = String(c?.contract_code || c?.id || '').trim().toUpperCase();
            return ck !== deletedCode.toUpperCase();
          });
          await query(
            `INSERT INTO app_storage (key, data, updated_at) VALUES ('sales_contracts', $1::jsonb, CURRENT_TIMESTAMP)
             ON CONFLICT (key) DO UPDATE SET data = $1::jsonb, version = COALESCE(app_storage.version, 1) + 1, updated_at = CURRENT_TIMESTAMP`,
            [JSON.stringify(filteredSt)]
          );
        }
        const allC = await query("SELECT * FROM sales_contracts ORDER BY id DESC");
        const mergedList = await mergeContractsWithStorage(allC.rows);
        await query(
          `INSERT INTO app_storage (key, data, updated_at) VALUES ($1, $2, CURRENT_TIMESTAMP)
           ON CONFLICT (key) DO UPDATE SET data = $2, version = COALESCE(app_storage.version, 1) + 1, updated_at = CURRENT_TIMESTAMP`,
          ["sales_contracts", JSON.stringify(mergedList)]
        );
      } catch (err) {}

      return NextResponse.json({ success: true });
    }

    // 3.2 Flexible Cancel Order Item (Requirement 15 - H5)
    if (action === "cancel_order_item") {
      const { order_code, product_code, reason, canceled_by } = body;
      const result = await withTransaction(async (c) => {
        const ordRes = await c.query("SELECT * FROM sales_orders WHERE order_code = $1 FOR UPDATE", [order_code]);
        if (ordRes.rows.length === 0) {
          throw new HttpError(404, "Không tìm thấy đơn hàng");
        }
        const ord = ordRes.rows[0];

        // Kiểm tra xem mặt hàng đã được xuất trên phiếu giao hàng chưa hủy hay chưa
        const slipsRes = await c.query(
          "SELECT slip_code, status, items FROM sales_delivery_slips WHERE order_code = $1 OR ($2::int IS NOT NULL AND order_id = $2::text)",
          [order_code, ord.id]
        );
        for (const slip of slipsRes.rows) {
          if (String(slip.status || "").toUpperCase() === "CANCELLED") continue;
          const slipItems = parseJsonArray(slip.items);
          const shippedQty = slipItems
            .filter((si: any) => (si.productCode || si.product_code || si.code) === product_code)
            .reduce((s: number, si: any) => s + (Number(si.quantity ?? si.qtyDeliverNow ?? si.qty ?? 0) || 0), 0);
          if (shippedQty > 0) {
            throw new HttpError(400, `Mặt hàng ${product_code} đã được xuất giao (${shippedQty}) trên phiếu ${slip.slip_code}. Không thể hủy trực tiếp dòng hàng đã giao; vui lòng hủy phiếu giao hoặc tạo phiếu trả hàng RMA.`);
          }
        }

        let items = ord.items;
        if (typeof items === "string") {
          try { items = JSON.parse(items); } catch { items = []; }
        }
        const updatedItems = items.map((it: any) => {
          const itCode = it.productCode || it.product_code;
          if (itCode === product_code && it.status !== "CANCELLED") {
            return {
              ...it,
              status: "CANCELLED",
              cancel_reason: reason || "Khách yêu cầu hủy dòng",
              canceled_at: new Date().toISOString(),
              canceled_by: canceled_by || "NVKD"
            };
          }
          return it;
        });

        // Tổng mới tính như khi lưu SO (Σ SL × đơn giá các dòng chưa hủy). Trước đây ưu tiên thành tiền lưu sẵn
        // của từng dòng: dòng đã sửa số lượng mà thành tiền còn cũ (vd ×1 -> ×5) làm tổng đơn bị hụt.
        const newTotal = computeOrderTotal(updatedItems);

        await c.query(
          `UPDATE sales_orders SET items = $1, total_amount = $2 WHERE id = $3`,
          [JSON.stringify(updatedItems), newTotal, ord.id]
        );

        // H5: Release active reservations and decrement quantity_allocated in inventory_items atomically!
        const relRes = await c.query(
          `UPDATE inventory_reservations 
           SET status = 'RELEASED', notes = COALESCE(notes, '') || ' • [Tự động nhả do hủy dòng: ' || $1 || ']'
           WHERE order_code = $2 AND product_code = $3 AND status = 'ACTIVE'
           RETURNING quantity_reserved`,
          [reason || "Hủy dòng mặt hàng", order_code, product_code]
        );

        const totalReleased = relRes.rows.reduce((sum: number, r: any) => sum + (Number(r.quantity_reserved) || 0), 0);
        if (totalReleased > 0) {
          await c.query(
            `UPDATE inventory_items 
             SET quantity_allocated = GREATEST(0, COALESCE(quantity_allocated, 0) - $1), 
                 last_updated = CURRENT_TIMESTAMP 
             WHERE product_code = $2`,
            [totalReleased, product_code]
          );
        }

        return { updatedItems, newTotal, totalReleased };
      });

      await logAudit("CANCEL_ORDER_ITEM", "SALES_ORDER", `Hủy mặt hàng ${product_code} trong đơn ${order_code}: ${reason}`);
      return NextResponse.json({ success: true, updated_items: result.updatedItems, new_total: result.newTotal });
    }

    // 3.3 Create RMA Return Request (Requirement 15 - M2)
    if (action === "create_rma") {
      const { order_code, items, reason_category, restock_action, refund_type, notes } = body;
      const code = String(order_code || "").trim();
      if (!code) throw new HttpError(400, "Thiếu mã đơn hàng cần trả");
      const wanted = (Array.isArray(items) ? items : [])
        .map((it: any) => ({ code: String(it?.product_code || it?.productCode || "").trim(), qty: Number(it?.quantity) || 0, reason: String(it?.reason || "").slice(0, 300) }))
        .filter((it: any) => it.code && it.qty > 0);
      if (wanted.length === 0) throw new HttpError(400, "Chọn ít nhất 1 mặt hàng với số lượng trả > 0");

      const created = await withTransaction(async (c) => {
        const ord = (await c.query(
          "SELECT order_code, customer_name, items, delivery_status FROM sales_orders WHERE order_code = $1 FOR UPDATE",
          [code]
        )).rows[0];
        if (!ord) throw new HttpError(404, `Không tìm thấy đơn hàng ${code}`);
        const asArr = (v: any): any[] => { if (Array.isArray(v)) return v; try { const x = JSON.parse(v || "[]"); return Array.isArray(x) ? x : []; } catch { return []; } };
        const asObj = (v: any): any => { if (v && typeof v === "object") return v; try { return JSON.parse(v || "{}"); } catch { return {}; } };
        const itemCode = (it: any) => String(it?.productCode || it?.product_code || it?.code || "").trim();
        const orderItems = asArr(ord.items).filter((it: any) => it?.status !== "CANCELLED");

        // Đã giao: phiếu giao đã xác nhận giao (không huỷ); đơn cũ giao không qua phiếu thì lấy SL đặt khi đơn đã DELIVERED
        const slips = (await c.query("SELECT items, status, extra_data FROM sales_delivery_slips WHERE order_code = $1", [code])).rows;
        const delivered: Record<string, number> = {};
        let anySlipDelivered = false;
        for (const s of slips) {
          const ex = asObj(s.extra_data);
          if (String(ex.deliveryStatus || s.status || "").toUpperCase() === "CANCELLED") continue;
          const isDel = ex.isDelivered === true || ex.isDelivered === "true" || String(ex.deliveryStatus || "").toUpperCase() === "DELIVERED";
          if (!isDel) continue;
          anySlipDelivered = true;
          for (const it of asArr(s.items)) { const k = itemCode(it); if (k) delivered[k] = (delivered[k] || 0) + (Number(it.quantity) || 0); }
        }
        if (!anySlipDelivered && String(ord.delivery_status || "").toUpperCase() === "DELIVERED") {
          for (const it of orderItems) { const k = itemCode(it); if (k) delivered[k] = (delivered[k] || 0) + (Number(it.quantity) || 0); }
        }
        // Đã trả / đang chờ duyệt trả
        const returned: Record<string, number> = {};
        const prev = (await c.query("SELECT items FROM rma_returns WHERE order_code = $1 AND status IN ('PENDING_APPROVAL', 'APPROVED')", [code])).rows;
        for (const r of prev) for (const it of asArr(r.items)) { const k = itemCode(it); if (k) returned[k] = (returned[k] || 0) + (Number(it.quantity) || 0); }

        const lines = wanted.map((w: any) => {
          const oi = orderItems.find((it: any) => itemCode(it) === w.code);
          if (!oi) throw new HttpError(400, `Mã ${w.code} không có trong đơn ${code}`);
          const can = (delivered[w.code] || 0) - (returned[w.code] || 0);
          if (w.qty > can + 1e-9) {
            throw new HttpError(400, `Mã ${w.code}: chỉ còn trả được ${Math.max(0, can)} (đã giao ${delivered[w.code] || 0}, đã/đang trả ${returned[w.code] || 0})`);
          }
          // Đơn giá trên SO là giá đã gồm VAT
          const unit = Number(oi.unitPrice ?? oi.price ?? oi.unit_price) || 0;
          return {
            product_code: w.code,
            product_name: oi.productName || oi.product_name || oi.name || w.code,
            unit: oi.unit || "",
            quantity: w.qty,
            unit_price: unit,
            total: Math.round(unit * w.qty),
            reason: w.reason
          };
        });
        const total = lines.reduce((s: number, x: any) => s + x.total, 0);
        const rmaCode = await generateDocumentCode({ docType: "RMA", customerName: ord.customer_name, tagMode: "CUSTOMER" });
        await c.query(
          `INSERT INTO rma_returns (rma_code, order_code, customer_name, items, total_amount, reason_category, status, restock_action, refund_type, notes)
           VALUES ($1, $2, $3, $4, $5, $6, 'PENDING_APPROVAL', $7, $8, $9)`,
          [rmaCode, code, ord.customer_name, JSON.stringify(lines), total, reason_category || "DEFECTIVE", restock_action || "RESTOCK", refund_type || "CREDIT_OFFSET", notes ? String(notes).slice(0, 1000) : null]
        );
        return { rmaCode, customer: ord.customer_name };
      });
      await logAudit("CREATE_RMA", "RMA", `Tạo yêu cầu trả hàng ${created.rmaCode} cho đơn ${code} (${created.customer})`);
      notifyZaloProactiveEvent({
        eventType: "RMA_APPROVAL_NEEDED",
        code: created.rmaCode,
        customerName: created.customer,
        reasonOrNote: `Đơn gốc ${code} • Lý do: ${reason_category || "Khách hoàn trả hàng"}`
      }).catch(() => {});
      return NextResponse.json({ success: true, rma_code: created.rmaCode });
    }

    if (action === "reject_rma") {
      const { rma_id, notes } = body;
      const who = (authUser as any)?.full_name || (authUser as any)?.username || "Người duyệt";
      const r = await query(
        `UPDATE rma_returns SET status = 'REJECTED', approved_by = $1, notes = COALESCE(notes, '') || $2
          WHERE id = $3 AND status = 'PENDING_APPROVAL' RETURNING rma_code`,
        [who, ` • [Từ chối bởi ${who}: ${String(notes || "Không đủ điều kiện trả hàng").slice(0, 500)}]`, rma_id]
      );
      if (r.rowCount === 0) throw new HttpError(409, "Phiếu trả hàng không tồn tại hoặc đã được xử lý");
      await logAudit("REJECT_RMA", "RMA", `Từ chối phiếu trả hàng ${r.rows[0].rma_code}`);
      return NextResponse.json({ success: true });
    }

    // 3.4 Approve RMA Return Request (Requirement 15 - C3)
    if (action === "approve_rma") {
      const { rma_id, restock_action, notes } = body;
      const approver = (authUser as any)?.full_name || (authUser as any)?.username || "Ban Giám Đốc";
      const approvalNote = notes || "Đã duyệt nhận hàng trả";
      const appendedNote = ` • [Duyệt bởi ${approver}: ${approvalNote}]`;

      const result = await withTransaction(async (c) => {
        // CAS: only PENDING_APPROVAL can transition to APPROVED
        const r = await c.query(
          `UPDATE rma_returns 
           SET status = 'APPROVED', approved_by = $1, 
               restock_action = COALESCE($2, restock_action), 
               notes = COALESCE(notes, '') || $3
           WHERE id = $4 AND status = 'PENDING_APPROVAL'
           RETURNING *`,
          [approver, restock_action || null, appendedNote, rma_id]
        );
        if (r.rowCount === 0) {
          throw new HttpError(409, "Phiếu RMA không tồn tại hoặc đã được xử lý trước đó");
        }
        const rma = r.rows[0];
        const finalAction = rma.restock_action || "RESTOCK";

        if (finalAction === "RESTOCK") {
          let items = rma.items;
          if (typeof items === "string") {
            try { items = JSON.parse(items); } catch { items = []; }
          }
          if (Array.isArray(items) && items.length > 0) {
            const validItems = sortByProductCode(
              items.filter((it: any) => (it.product_code || it.productCode) && Number(it.quantity) > 0),
              (it: any) => it.product_code || it.productCode
            );

            for (const it of validItems) {
              const pCode = (it.product_code || it.productCode || "").trim();
              const pName = (it.product_name || it.name || pCode).trim();
              const qty = Number(it.quantity) || 0;
              await addStock(c, {
                productCode: pCode,
                productName: pName,
                qty,
                lotNumber: it.lot_number || it.lotNumber || null,
                expiryDate: it.expiry_date || it.expiryDate || null,
                location: "Kho Trung Tâm",
                shelf: "Khu Nhập Trả RMA"
              });
            }

            // One deterministic document code per RMA
            await c.query(
              `INSERT INTO inventory_transactions (transaction_code, transaction_type, reference_code, date, performed_by, warehouse_name, items, notes)
               VALUES ($1, 'INBOUND', $2, $3, $4, 'Kho Trung Tâm', $5, $6)`,
              [`TRK-${rma.rma_code}`, rma.rma_code, todayVN(), approver, JSON.stringify(validItems), `Nhập trả kho theo phiếu RMA ${rma.rma_code} (${rma.customer_name})`]
            );
          }
        }

        // Nếu hình thức hoàn là giảm trừ công nợ (CREDIT_OFFSET), tự động giảm trừ giá trị đơn hàng gốc
        const rmaAmount = Number(rma.total_amount) || 0;
        if (String(rma.refund_type || "CREDIT_OFFSET").toUpperCase() === "CREDIT_OFFSET" && rma.order_code && rmaAmount > 0) {
          await c.query(
            `UPDATE sales_orders
             SET total_amount = GREATEST(0, COALESCE(total_amount, 0) - $1),
                 notes = COALESCE(notes, '') || $2
             WHERE order_code = $3`,
            [rmaAmount, ` • [Giảm trừ công nợ RMA ${rma.rma_code}: -${rmaAmount.toLocaleString("vi-VN", { maximumFractionDigits: 0 })} đ]`, rma.order_code]
          );
        }

        return { rma, finalAction };
      });

      await logAudit("APPROVE_RMA", "RMA", `Duyệt phiếu trả hàng ${result.rma.rma_code} (Xử lý: ${result.finalAction})`);
      return NextResponse.json({ success: true });
    }

    // Update Customer Contacts list (Add, Edit, Delete)
    if (action === "update_contacts") {
      const { customer_id, customer_code, contacts } = body;
      const contactsJson = JSON.stringify(contacts || []);
      const primaryContact = Array.isArray(contacts) ? contacts.find((c: any) => c.is_primary) : null;

      await withTransaction(async (c) => {
        let resolvedId: number | null = typeof customer_id === "number" ? customer_id : numericIdOrNull(customer_id);
        let resolvedCode: string | null = customer_code || null;

        if (resolvedId) {
          const r = await c.query("UPDATE sales_customers SET contacts = $1::jsonb WHERE id = $2 RETURNING id, customer_code", [contactsJson, resolvedId]);
          if (r.rows[0]?.customer_code && !resolvedCode) resolvedCode = r.rows[0].customer_code;
        } else if (resolvedCode) {
          const r = await c.query("UPDATE sales_customers SET contacts = $1::jsonb WHERE customer_code = $2 RETURNING id, customer_code", [contactsJson, resolvedCode]);
          if (r.rows[0]?.id && !resolvedId) resolvedId = r.rows[0].id;
        }

        if (primaryContact) {
          if (resolvedId) {
            await c.query(
              `UPDATE sales_customers 
               SET contact_person = COALESCE($1, contact_person),
                   contact_position = COALESCE($2, contact_position),
                   phone = COALESCE($3, phone),
                   email = COALESCE($4, email)
               WHERE id = $5`,
              [primaryContact.name || null, primaryContact.position || null, primaryContact.phone || null, primaryContact.email || null, resolvedId]
            );
          } else if (resolvedCode) {
            await c.query(
              `UPDATE sales_customers 
               SET contact_person = COALESCE($1, contact_person),
                   contact_position = COALESCE($2, contact_position),
                   phone = COALESCE($3, phone),
                   email = COALESCE($4, email)
               WHERE customer_code = $5`,
              [primaryContact.name || null, primaryContact.position || null, primaryContact.phone || null, primaryContact.email || null, resolvedCode]
            );
          }
        }

        if (resolvedCode && Array.isArray(contacts)) {
          await c.query("DELETE FROM customer_contacts WHERE customer_code = $1", [resolvedCode]);
          for (const ct of contacts) {
            await c.query(
              `INSERT INTO customer_contacts (customer_code, customer_id, name, position, department, phone, email, role_type, is_primary, notes)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
              [resolvedCode, resolvedId, ct.name || "", ct.position || null, ct.department || null, ct.phone || null, ct.email || null, ct.role_type || null, Boolean(ct.is_primary), ct.notes || null]
            );
          }
        }
      });

      await logAudit("UPDATE_CONTACTS", "CUSTOMER", `Cập nhật danh sách ${contacts?.length || 0} người liên hệ cho KH ${customer_code || customer_id}`);
      return NextResponse.json({ success: true, contacts });
    }

    // Sửa dữ liệu từ báo cáo "Kiểm tra dữ liệu đơn" (Quản trị viên chọn từng trường hợp; có nhật ký)
    if (action === "order_integrity_fix") {
      if (!isAdminUser(authUser)) return forbiddenResponse("Chỉ Quản trị viên được sửa dữ liệu đơn.");
      const type = String(body.type || "");
      const result = await withTransaction(async (c) => {
        if (type === "move_invoice") {
          // hóa đơn ghi nhầm vào đơn khác: chuyển về đơn sở hữu phiếu giao
          const { order_code, delivery_slip_id } = body;
          const wrong = (await c.query("SELECT id, order_code, invoice_no, invoiced_delivery_slips FROM sales_orders WHERE order_code = $1 FOR UPDATE", [order_code])).rows[0];
          const slip = (await c.query("SELECT order_code FROM sales_delivery_slips WHERE slip_code = $1", [delivery_slip_id])).rows[0];
          if (!wrong || !slip) throw new HttpError(404, "Không tìm thấy đơn hoặc phiếu giao");
          const right = (await c.query("SELECT id, order_code, total_amount, invoice_no, invoiced_delivery_slips FROM sales_orders WHERE order_code = $1 FOR UPDATE", [slip.order_code])).rows[0];
          const recs = parseJsonArray(wrong.invoiced_delivery_slips);
          const rec = recs.find((r: any) => r.delivery_slip_id === delivery_slip_id);
          if (!rec) throw new HttpError(409, "Hóa đơn này không còn nằm ở đơn sai");
          const remain = recs.filter((r: any) => r.delivery_slip_id !== delivery_slip_id);
          const wrongNo = remain.find((r: any) => r.invoice_no)?.invoice_no || null;
          await c.query(
            `UPDATE sales_orders SET invoiced_delivery_slips = $1::jsonb,
                    invoice_no = CASE WHEN invoice_no = $2 THEN $3 ELSE invoice_no END,
                    invoice_date = CASE WHEN invoice_no = $2 THEN $4::date ELSE invoice_date END,
                    invoice_status = CASE WHEN jsonb_array_length($1::jsonb) = 0 THEN 'PENDING_INVOICE' ELSE invoice_status END
              WHERE id = $5`,
            [JSON.stringify(remain), String(rec.invoice_no || ""), wrongNo, remain.find((r: any) => r.invoice_no)?.invoice_date || null, wrong.id]
          );
          if (right) {
            const rRecs = parseJsonArray(right.invoiced_delivery_slips);
            if (!rRecs.some((r: any) => r.delivery_slip_id === delivery_slip_id)) {
              const next = [...rRecs, rec];
              const sum = next.reduce((s: number, r: any) => s + (Number(r.invoice_amount) || 0), 0);
              const full = Number(right.total_amount) > 0 && sum >= Number(right.total_amount) * 0.99;
              await c.query(
                "UPDATE sales_orders SET invoiced_delivery_slips = $1::jsonb, invoice_no = COALESCE(invoice_no, $2), invoice_date = COALESCE(invoice_date, $3::date), invoice_status = $4 WHERE id = $5",
                [JSON.stringify(next), rec.invoice_no || null, rec.invoice_date || null, full ? "ISSUED" : "PARTIALLY_INVOICED", right.id]
              );
            }
          }
          return `Chuyển HĐ ${rec.invoice_no} (phiếu ${delivery_slip_id}) từ đơn ${wrong.order_code} về đơn ${slip.order_code}`;
        }
        if (type === "set_order_customer_from_slip" || type === "set_slip_customer_from_order") {
          const { slip_code } = body;
          const slip = (await c.query("SELECT slip_code, order_code, customer_name FROM sales_delivery_slips WHERE slip_code = $1 FOR UPDATE", [slip_code])).rows[0];
          if (!slip) throw new HttpError(404, "Không tìm thấy phiếu giao");
          const ord = (await c.query("SELECT id, order_code, customer_name FROM sales_orders WHERE order_code = $1 FOR UPDATE", [slip.order_code])).rows[0];
          if (!ord) throw new HttpError(404, "Không tìm thấy đơn của phiếu");
          if (type === "set_order_customer_from_slip") {
            const cust = (await c.query("SELECT id FROM sales_customers WHERE LOWER(TRIM(name)) = LOWER(TRIM($1)) LIMIT 1", [slip.customer_name])).rows[0];
            await c.query("UPDATE sales_orders SET customer_name = $1, customer_id = COALESCE($2, customer_id) WHERE id = $3", [slip.customer_name, cust?.id || null, ord.id]);
            // bản sao trên màn hình cũng theo CSDL
            await c.query(
              `UPDATE app_storage SET data = (
                 SELECT COALESCE(jsonb_agg(CASE WHEN e->>'order_code' = $1 OR e->>'id' = $1 THEN jsonb_set(e, '{customerName}', to_jsonb($2::text)) ELSE e END), '[]'::jsonb)
                 FROM jsonb_array_elements(data) e) WHERE key = 'sales_factory_orders' AND jsonb_typeof(data) = 'array'`,
              [ord.order_code, slip.customer_name]
            );
            return `Đơn ${ord.order_code}: khách "${ord.customer_name}" -> "${slip.customer_name}" (theo phiếu ${slip.slip_code})`;
          }
          await c.query("UPDATE sales_delivery_slips SET customer_name = $1 WHERE slip_code = $2", [ord.customer_name, slip.slip_code]);
          return `Phiếu ${slip.slip_code}: khách "${slip.customer_name}" -> "${ord.customer_name}" (theo đơn ${ord.order_code})`;
        }
        if (type === "restore_order_from_screen") {
          // đơn chỉ còn trong bản sao trên màn hình: ghi lại vào CSDL (giữ nguyên mã đơn)
          const code = String(body.order_code || "").trim();
          if ((await c.query("SELECT 1 FROM sales_orders WHERE order_code = $1", [code])).rows[0]) throw new HttpError(409, "Đơn đã có trong CSDL");
          const blob = parseJsonArray((await c.query("SELECT data FROM app_storage WHERE key = 'sales_factory_orders'")).rows[0]?.data);
          const fo = blob.find((x: any) => String(x?.order_code || x?.id || "") === code);
          if (!fo) throw new HttpError(404, "Không còn bản sao của đơn này trên màn hình — cần lập lại đơn");
          const custName = fo.customerName || fo.customer_name || "";
          const cust = (await c.query("SELECT id FROM sales_customers WHERE LOWER(TRIM(name)) = LOWER(TRIM($1)) LIMIT 1", [custName])).rows[0];
          const items = Array.isArray(fo.items) ? fo.items : [];
          const total = Number(fo.totalAmount ?? fo.total_amount) || items.reduce((s: number, it: any) => s + (Number(it.quantity) || 0) * (Number(it.unitPrice ?? it.price) || 0), 0);
          const slipsDelivered = (await c.query("SELECT extra_data FROM sales_delivery_slips WHERE order_code = $1", [code])).rows
            .some((r: any) => { let ex: any = r.extra_data; if (typeof ex === "string") { try { ex = JSON.parse(ex); } catch { ex = {}; } } return ex?.isDelivered === true || String(ex?.deliveryStatus || "").toUpperCase() === "DELIVERED"; });
          await c.query(
            `INSERT INTO sales_orders (order_code, customer_id, customer_name, sales_rep_name, order_date, items, total_amount, delivery_status, payment_status, invoice_status, notes, price_approval_status)
             VALUES ($1, $2, $3, $4, CURRENT_DATE, $5::jsonb, $6, $7, 'UNPAID', 'PENDING_INVOICE', $8, 'APPROVED')`,
            [code, cust?.id || null, custName, fo.salesRepName || fo.sales_rep_name || null, JSON.stringify(items), total,
             slipsDelivered ? "DELIVERED" : "PENDING", "[Khôi phục từ bản sao màn hình — kiểm tra lại ngày đơn, giá]"]
          );
          return `Khôi phục đơn ${code} (${custName}, ${total.toLocaleString("vi-VN", { maximumFractionDigits: 0 })} đ) từ bản sao màn hình`;
        }
        throw new HttpError(400, "Loại sửa không hợp lệ");
      });
      await logAudit("INTEGRITY_FIX", "SALES_ORDER", result);
      return NextResponse.json({ success: true, message: result });
    }

    return NextResponse.json({ error: "Hành động POST không hợp lệ" }, { status: 400 });
  } catch (error: any) {
    console.error("Sales API POST Error:", error);
    return NextResponse.json({ error: error.message || String(error) }, { status: httpErrorStatus(error) });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    // Phiên phải còn hiệu lực (tài khoản chưa bị khóa, mật khẩu chưa đổi): proxy chỉ kiểm tra chữ ký cookie
    const authUser = await getAuthorizedUser(req);
    if (!authUser) return unauthorizedResponse();
    setAuditActor(authUser);
    if (!isAdminUser(authUser) && !hasPermission(authUser, "sales.delete")) {
      return forbiddenResponse("Bạn không có quyền xóa dữ liệu Kinh doanh.");
    }
    const { searchParams } = new URL(req.url);
    const action = searchParams.get("action");
    const id = searchParams.get("id");

    if (action === "customer" && id) {
      const openCount = await openOrderCountForCustomer(id);
      if (openCount > 0) {
        return NextResponse.json({ error: `Khách hàng còn ${openCount} đơn hàng chưa thanh toán xong, không thể xóa.` }, { status: 409 });
      }
      if (!isNaN(Number(id))) {
        await query("DELETE FROM sales_customers WHERE id = $1", [Number(id)]);
      } else {
        await query("DELETE FROM sales_customers WHERE customer_code = $1", [id]);
      }
      await logAudit("DELETE", "SALES_CUSTOMER", `Xóa khách hàng ${id}`);
      return NextResponse.json({ success: true });
    }

    if (action === "delivery_slip" && id) {
      if (!(await deliverySlipIsCancelled(id))) {
        return NextResponse.json({ error: "Chỉ xóa được phiếu giao đã hủy (hủy phiếu sẽ nhập lại hàng vào kho trước)." }, { status: 409 });
      }
      if (!isNaN(Number(id))) {
        await query("DELETE FROM sales_delivery_slips WHERE id = $1 OR slip_code = $2", [Number(id), id]);
      } else {
        await query("DELETE FROM sales_delivery_slips WHERE slip_code = $1", [id]);
      }
      await logAudit("DELETE", "DELIVERY_SLIP", `Xóa phiếu xuất ${id}`);
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Hành động DELETE không hợp lệ" }, { status: 400 });
  } catch (error: any) {
    console.error("Sales API DELETE Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}




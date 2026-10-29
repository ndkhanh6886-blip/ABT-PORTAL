import type { PoolClient } from "pg";
import { HttpError } from "@/backend/db/db";
import { appendCatalogEntry } from "@/backend/services/catalogStore";
import { todayVN } from "@/backend/services/dates";

/**
 * Inventory ledger (Deep Code Audit H1/H2/H5).
 *
 * Every stock mutation goes through these helpers, always on a transaction client.
 *
 * Model:
 *  - `inventory_lots`   : one row per (product_code, lot_number, warehouse_location), qty >= 0 (CHECK).
 *  - `inventory_items`  : per-product aggregate (quantity_on_hand / quantity_allocated, both CHECK >= 0).
 *                         Its lot_number / expiry_date show the FEFO representative lot.
 *
 * Lock order (deadlock-free): inventory_items row -> inventory_reservations rows -> inventory_lots rows
 * -> app_storage row. Callers must process multiple products sorted by product_code.
 */

export const NO_LOT = "NO-LOT";
export const DEFAULT_LOCATION = "Kho Trung Tâm";

type Queryable = Pick<PoolClient, "query">;

/**
 * inventory_lots.expiry_date is text and holds several formats ("2028-06-30", "30/06/2028", "07.07.2028").
 * SQL expression giving it as "YYYY-MM-DD" (NULL when empty / unknown), so it can be compared and sorted.
 */
export const LOT_EXPIRY_ISO_SQL = (col = "expiry_date") => `(CASE
    WHEN ${col} ~ '^\\d{4}-\\d{2}-\\d{2}' THEN left(${col}, 10)
    WHEN ${col} ~ '^\\d{1,2}[./-]\\d{1,2}[./-]\\d{4}' THEN
      split_part(regexp_replace(${col}, '[./-]', '/', 'g'), '/', 3) || '-' ||
      lpad(split_part(regexp_replace(${col}, '[./-]', '/', 'g'), '/', 2), 2, '0') || '-' ||
      lpad(split_part(regexp_replace(${col}, '[./-]', '/', 'g'), '/', 1), 2, '0')
    ELSE NULL END)`;
const TODAY_VN_SQL = `to_char(now() AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYYY-MM-DD')`;

export const normLot = (lot?: string | null): string => {
  const s = (lot ?? "").toString().trim();
  return s ? s : NO_LOT;
};

const toQty = (v: any): number => {
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) ? n : 0;
};

/** Sort helper so multi-item operations always lock rows in the same order. */
export function sortByProductCode<T>(items: T[], getCode: (it: T) => string): T[] {
  return [...items].sort((a, b) => String(getCode(a)).localeCompare(String(getCode(b))));
}

async function lockAggregate(c: Queryable, productCode: string) {
  const r = await c.query(
    `SELECT id, product_code, quantity_on_hand, quantity_allocated, warehouse_location
       FROM inventory_items WHERE product_code = $1 FOR UPDATE`,
    [productCode]
  );
  return r.rows[0] || null;
}

/** Legacy safety net: a product that has aggregate stock but no lot rows gets one lot seeded from the aggregate. */
async function seedLotsFromAggregate(c: Queryable, productCode: string) {
  await c.query(
    `INSERT INTO inventory_lots (product_code, lot_number, expiry_date, warehouse_location, quantity_on_hand, is_quarantined, quarantine_reason)
     SELECT i.product_code,
            COALESCE(NULLIF(TRIM(i.lot_number), ''), '${NO_LOT}'),
            i.expiry_date,
            COALESCE(NULLIF(i.warehouse_location, ''), '${DEFAULT_LOCATION}'),
            GREATEST(COALESCE(i.quantity_on_hand, 0), 0),
            COALESCE(i.is_quarantined, false),
            i.quarantine_reason
       FROM inventory_items i
      WHERE i.product_code = $1
        AND COALESCE(i.quantity_on_hand, 0) > 0
        AND NOT EXISTS (SELECT 1 FROM inventory_lots l WHERE l.product_code = i.product_code)
     ON CONFLICT DO NOTHING`,
    [productCode]
  );
}

/** Decrement quantity_allocated without ever violating the CHECK; drift is logged instead of hidden. */
async function decrementAllocated(c: Queryable, productCode: string, qty: number, allocatedBefore: number) {
  if (qty <= 0) return;
  if (qty > allocatedBefore) {
    console.error("[INVENTORY_LEDGER] quantity_allocated drift detected", { productCode, qty, allocatedBefore });
  }
  await c.query(
    `UPDATE inventory_items
        SET quantity_allocated = quantity_allocated - LEAST($1::int, quantity_allocated),
            last_updated = now()
      WHERE product_code = $2`,
    [qty, productCode]
  );
}

/** Keep the aggregate's lot_number / expiry_date pointing at the FEFO lot (first-expiry, non-quarantined, in stock). */
export async function refreshAggregateLotInfo(c: Queryable, productCode: string) {
  await c.query(
    `UPDATE inventory_items i
        SET lot_number = s.lot_number, expiry_date = s.expiry_date
       FROM (SELECT NULLIF(lot_number, '${NO_LOT}') AS lot_number, expiry_date
               FROM inventory_lots
              WHERE product_code = $1 AND quantity_on_hand > 0 AND NOT is_quarantined
              ORDER BY (lot_number = '${NO_LOT}'), ${LOT_EXPIRY_ISO_SQL()} ASC NULLS LAST, id ASC
              LIMIT 1) s
      WHERE i.product_code = $1`,
    [productCode]
  );
}

export interface ProductMasterInput {
  code: string;
  name?: string;
  category?: string;
  unit?: string;
  specification?: string;
  standard_price?: number;
  cost_price?: number;
  manufacturer?: string;
  origin?: string;
  min_stock_level?: number;
  storage_condition?: string;
}

let lotUnitCostColEnsured = false;
async function ensureLotUnitCostCol(c: Queryable) {
  if (lotUnitCostColEnsured) return;
  await c.query("ALTER TABLE inventory_lots ADD COLUMN IF NOT EXISTS unit_cost NUMERIC DEFAULT 0");
  lotUnitCostColEnsured = true;
}

/**
 * Race-free "create product if missing", and when the product already exists in `products`,
 * automatically update `cost_price` (when a new lot/inbound provides `cost_price > 0`) and
 * `standard_price` (only when `standard_price > 0` is explicitly provided, preserving any existing End-User price).
 */
export async function ensureProduct(c: Queryable, p: ProductMasterInput): Promise<{ id: number | null; created: boolean }> {
  const ins = await c.query(
    `INSERT INTO products (code, name, category, unit, specification, standard_price, cost_price, manufacturer, origin, min_stock_level, storage_condition)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT (code) DO NOTHING
     RETURNING id`,
    [
      p.code,
      p.name || p.code,
      p.category || "Hàng Thương Mại",
      p.unit || "Hộp",
      p.specification || "",
      Number(p.standard_price) || 0,
      Number(p.cost_price) || 0,
      p.manufacturer || "ABT Phân Phối",
      p.origin || "Nhập khẩu / Chính hãng",
      Number(p.min_stock_level) || 10,
      p.storage_condition || null,
    ]
  );
  if (ins.rows.length > 0) return { id: ins.rows[0].id, created: true };

  const newCost = Number(p.cost_price) || 0;
  const newStdPrice = Number(p.standard_price) || 0;
  const newStorage = p.storage_condition ? String(p.storage_condition).trim() : "";
  const newMfg = p.manufacturer ? String(p.manufacturer).trim() : "";

  if (newCost > 0 || newStdPrice > 0 || newStorage || newMfg) {
    const upd = await c.query(
      `UPDATE products
          SET cost_price = CASE WHEN $2::numeric > 0 THEN $2::numeric ELSE cost_price END,
              standard_price = CASE WHEN $3::numeric > 0 THEN $3::numeric ELSE standard_price END,
              storage_condition = COALESCE(NULLIF(storage_condition, ''), NULLIF($4::text, '')),
              manufacturer = CASE
                WHEN (manufacturer IS NULL OR manufacturer = '' OR manufacturer = 'ABT' OR manufacturer = 'VIA' OR manufacturer ILIKE '%Phân Phối%')
                     AND $5::text <> '' AND $5::text NOT ILIKE '%Phân Phối%'
                THEN $5::text
                ELSE manufacturer
              END
        WHERE code = $1
        RETURNING id`,
      [p.code, newCost, newStdPrice, newStorage, newMfg]
    );
    if (upd.rows.length > 0) return { id: upd.rows[0].id, created: false };
  }

  const sel = await c.query("SELECT id FROM products WHERE code = $1", [p.code]);
  return { id: sel.rows[0]?.id ?? null, created: false };
}

export interface AddStockInput {
  productCode: string;
  productName?: string;
  productId?: number | null;
  qty: number;
  lotNumber?: string | null;
  expiryDate?: string | null;
  location?: string | null;
  shelf?: string | null;
  unitCost?: number | null;
}

/** Inbound: upsert the lot row and the aggregate atomically (no more lot/expiry overwrite). */
export async function addStock(c: Queryable, input: AddStockInput) {
  const code = String(input.productCode || "").trim();
  const qty = toQty(input.qty);
  if (!code || qty <= 0) return;

  await ensureLotUnitCostCol(c);
  await c.query(
    `INSERT INTO inventory_items (product_id, product_code, product_name, quantity_on_hand, quantity_allocated, warehouse_location, shelf_position, last_updated)
     VALUES ($1, $2, $3, 0, 0, $4, $5, now())
     ON CONFLICT (product_code) DO NOTHING`,
    [input.productId ?? null, code, input.productName || code, input.location || DEFAULT_LOCATION, input.shelf || "Kệ K01"]
  );
  const agg = await lockAggregate(c, code);
  await seedLotsFromAggregate(c, code);

  const location = input.location || agg?.warehouse_location || DEFAULT_LOCATION;
  const lotUnitCost = Number(input.unitCost) || 0;
  await c.query(
    `INSERT INTO inventory_lots (product_code, lot_number, expiry_date, warehouse_location, quantity_on_hand, unit_cost)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (product_code, lot_number, warehouse_location) DO UPDATE
       SET quantity_on_hand = inventory_lots.quantity_on_hand + EXCLUDED.quantity_on_hand,
           expiry_date = COALESCE(EXCLUDED.expiry_date, inventory_lots.expiry_date),
           unit_cost = CASE WHEN EXCLUDED.unit_cost > 0 THEN EXCLUDED.unit_cost ELSE COALESCE(inventory_lots.unit_cost, 0) END,
           last_updated = now()`,
    [code, normLot(input.lotNumber), input.expiryDate || null, location, qty, lotUnitCost]
  );
  await c.query(
    `UPDATE inventory_items
        SET quantity_on_hand = quantity_on_hand + $1,
            product_id = COALESCE(product_id, $2),
            warehouse_location = COALESCE($3, warehouse_location),
            shelf_position = COALESCE($4, shelf_position),
            last_updated = now()
      WHERE product_code = $5`,
    [qty, input.productId ?? null, input.location || null, input.shelf || null, code]
  );
  await refreshAggregateLotInfo(c, code);
}

/** Fulfil this order's ACTIVE reservations (FIFO by id) up to `qty`. Returns the quantity consumed. */
async function consumeReservations(c: Queryable, orderCode: string, productCode: string, qty: number): Promise<number> {
  const r = await c.query(
    `SELECT id, quantity_reserved FROM inventory_reservations
      WHERE order_code = $1 AND product_code = $2 AND status = 'ACTIVE'
      ORDER BY id FOR UPDATE`,
    [orderCode, productCode]
  );
  let remaining = qty;
  let consumed = 0;
  for (const row of r.rows) {
    if (remaining <= 0) break;
    const q = toQty(row.quantity_reserved);
    if (q <= 0) continue;
    if (q <= remaining) {
      await c.query(
        `UPDATE inventory_reservations
            SET status = 'FULFILLED', notes = COALESCE(notes, '') || ' • [Đã xuất kho]'
          WHERE id = $1`,
        [row.id]
      );
      consumed += q;
      remaining -= q;
    } else {
      await c.query(`UPDATE inventory_reservations SET quantity_reserved = quantity_reserved - $1 WHERE id = $2`, [remaining, row.id]);
      consumed += remaining;
      remaining = 0;
    }
  }
  return consumed;
}

export interface RemoveStockInput {
  productCode: string;
  productName?: string;
  qty: number;
  lotNumber?: string | null;
  allowInsufficient?: boolean;
  /** Sales order being shipped: its ACTIVE reservations are fulfilled first. */
  orderCode?: string | null;
}

/**
 * Outbound: availability is evaluated on the LOCKED aggregate row (no TOCTOU), allocated stock of
 * other orders is respected, quarantined lots are never picked, lots are consumed FEFO.
 */
export async function removeStock(c: Queryable, input: RemoveStockInput): Promise<{ deducted: number; shortfall: number; consumedReservation: number }> {
  const code = String(input.productCode || "").trim();
  const qty = toQty(input.qty);
  if (!code || qty <= 0) return { deducted: 0, shortfall: 0, consumedReservation: 0 };
  const lot = (input.lotNumber ?? "").toString().trim() || null;
  const allow = Boolean(input.allowInsufficient);
  const label = `${input.productName || code}${lot ? ` – Lô ${lot}` : ""}`;

  const agg = await lockAggregate(c, code);
  if (!agg) {
    if (allow) return { deducted: 0, shortfall: qty, consumedReservation: 0 };
    throw new HttpError(409, `Mặt hàng ${label} chưa có tồn kho.`);
  }

  let consumed = 0;
  if (input.orderCode) {
    consumed = await consumeReservations(c, input.orderCode, code, qty);
    await decrementAllocated(c, code, consumed, toQty(agg.quantity_allocated));
  }

  const onHand = toQty(agg.quantity_on_hand);
  const allocatedOthers = Math.max(0, toQty(agg.quantity_allocated) - consumed);
  const available = onHand - allocatedOthers;
  if (!allow && available < qty) {
    throw new HttpError(
      409,
      `Không đủ tồn khả dụng cho ${label}. Yêu cầu: ${qty}, khả dụng: ${Math.max(0, available)} (tồn ${onHand}, đang giữ chỗ cho đơn khác ${allocatedOthers}).`
    );
  }

  await seedLotsFromAggregate(c, code);
  // is_expired: hạn dùng đã qua (theo ngày Việt Nam) — lô hết hạn không được xuất, giống lô cách ly
  const lotsRes = lot
    ? await c.query(
        `SELECT id, quantity_on_hand, is_quarantined,
                COALESCE(${LOT_EXPIRY_ISO_SQL()} < ${TODAY_VN_SQL}, false) AS is_expired
           FROM inventory_lots
          WHERE product_code = $1 AND lot_number = $2 ORDER BY id FOR UPDATE`,
        [code, lot]
      )
    : await c.query(
        `SELECT id, quantity_on_hand, is_quarantined,
                COALESCE(${LOT_EXPIRY_ISO_SQL()} < ${TODAY_VN_SQL}, false) AS is_expired
           FROM inventory_lots
          WHERE product_code = $1 AND quantity_on_hand > 0
          ORDER BY ${LOT_EXPIRY_ISO_SQL()} ASC NULLS LAST, id ASC FOR UPDATE`,
        [code]
      );
  const rows = lotsRes.rows as Array<{ id: number; quantity_on_hand: number; is_quarantined: boolean; is_expired: boolean }>;
  const clean = rows.filter((r) => !r.is_quarantined && !r.is_expired);
  const cleanQty = clean.reduce((s, r) => s + toQty(r.quantity_on_hand), 0);
  const quarantinedQty = rows.filter((r) => r.is_quarantined).reduce((s, r) => s + toQty(r.quantity_on_hand), 0);
  const expiredQty = rows.filter((r) => !r.is_quarantined && r.is_expired).reduce((s, r) => s + toQty(r.quantity_on_hand), 0);

  if (!allow) {
    if (lot && rows.length === 0) throw new HttpError(409, `Không tìm thấy ${label} trong kho.`);
    if (cleanQty < qty && expiredQty > 0) {
      throw new HttpError(409, `${label}: chỉ còn ${cleanQty} khả dụng, ${expiredQty} đã hết hạn dùng (không được xuất).`);
    }
    if (cleanQty < qty && quarantinedQty > 0) {
      throw new HttpError(409, `${label}: chỉ còn ${cleanQty} khả dụng, ${quarantinedQty} đang bị cách ly/thu hồi.`);
    }
    if (lot && cleanQty < qty) throw new HttpError(409, `Không đủ tồn cho ${label}. Yêu cầu: ${qty}, lô còn: ${cleanQty}.`);
  }

  let remaining = qty;
  for (const r of clean) {
    if (remaining <= 0) break;
    const take = Math.min(toQty(r.quantity_on_hand), remaining);
    if (take <= 0) continue;
    await c.query(`UPDATE inventory_lots SET quantity_on_hand = quantity_on_hand - $1, last_updated = now() WHERE id = $2`, [take, r.id]);
    remaining -= take;
  }
  if (remaining > 0 && !allow) {
    // Aggregate (authoritative) had enough but lot detail lagged behind (legacy writers) — log for reconciliation.
    console.error("[INVENTORY_LEDGER] lot detail lower than aggregate", { productCode: code, missing: remaining });
  }

  const deductedFromLots = qty - remaining;
  const deduct = rows.length > 0 ? deductedFromLots : Math.min(qty, onHand);
  await c.query(
    `UPDATE inventory_items SET quantity_on_hand = GREATEST(0, quantity_on_hand - $1), last_updated = now() WHERE product_code = $2`,
    [deduct, code]
  );
  await refreshAggregateLotInfo(c, code);
  return { deducted: deduct, shortfall: qty - deduct, consumedReservation: consumed };
}

export interface ReserveInput {
  orderCode: string;
  customerName?: string;
  salesRepName?: string;
  productCode: string;
  productName?: string;
  lotNumber?: string | null;
  qty: number;
  holdUntil?: string | Date | null;
  notes?: string | null;
  /** When true (default) the reservation must fit into on_hand - allocated. */
  requireAvailable?: boolean;
}

/** Reserve stock: conditional allocation on the locked aggregate + reservation row, atomically. */
export async function reserveStock(c: Queryable, r: ReserveInput): Promise<number> {
  const code = String(r.productCode || "").trim();
  const qty = toQty(r.qty);
  if (!code) throw new HttpError(400, "Thiếu mã sản phẩm cần giữ chỗ.");
  if (qty <= 0) throw new HttpError(400, "Số lượng giữ chỗ phải lớn hơn 0.");

  // Trả lại tồn của các phiếu giữ chỗ đã quá hạn trước khi tính tồn khả dụng
  await releaseExpiredReservations(c, code);
  const agg = await lockAggregate(c, code);
  if (!agg) throw new HttpError(409, `Mặt hàng ${r.productName || code} chưa có trong kho, không thể giữ chỗ.`);
  const available = toQty(agg.quantity_on_hand) - toQty(agg.quantity_allocated);
  if (r.requireAvailable !== false && available < qty) {
    throw new HttpError(409, `Không đủ tồn khả dụng để giữ chỗ ${r.productName || code}. Yêu cầu: ${qty}, khả dụng: ${Math.max(0, available)}.`);
  }

  await c.query(
    `UPDATE inventory_items SET quantity_allocated = quantity_allocated + $1, last_updated = now() WHERE product_code = $2`,
    [qty, code]
  );
  const ins = await c.query(
    `INSERT INTO inventory_reservations (
       order_code, customer_name, sales_rep_name, product_code, product_name, lot_number, quantity_reserved, hold_until_date, notes, status
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'ACTIVE') RETURNING id`,
    [r.orderCode, r.customerName || null, r.salesRepName || null, code, r.productName || code, r.lotNumber || null, qty, r.holdUntil || null, r.notes || null]
  );
  return ins.rows[0].id;
}

/** Release ONE reservation: CAS on status ACTIVE, quantity taken from the DB (never from the client). Idempotent. */
export async function releaseReservation(
  c: Queryable,
  reservationId: number,
  actor: string,
  reason: string
): Promise<{ released: boolean; product_code?: string; quantity?: number }> {
  const pre = await c.query("SELECT product_code FROM inventory_reservations WHERE id = $1", [reservationId]);
  if (pre.rows.length === 0) throw new HttpError(404, "Không tìm thấy phiếu giữ chỗ.");
  const productCode = pre.rows[0].product_code;
  const agg = productCode ? await lockAggregate(c, productCode) : null; // lock order: aggregate first

  const r = await c.query(
    `UPDATE inventory_reservations
        SET status = 'RELEASED',
            notes = COALESCE(notes, '') || ' • [Giải phóng bởi ' || $1 || ': ' || $2 || ']'
      WHERE id = $3 AND status = 'ACTIVE'
      RETURNING product_code, quantity_reserved`,
    [actor, reason, reservationId]
  );
  if (r.rows.length === 0) return { released: false }; // already released / fulfilled -> no-op
  const qty = toQty(r.rows[0].quantity_reserved);
  if (agg) await decrementAllocated(c, productCode, qty, toQty(agg.quantity_allocated));
  return { released: true, product_code: productCode, quantity: qty };
}

/**
 * Giải phóng các phiếu giữ chỗ đã quá hạn giữ (hold_until_date trước hôm nay, giờ Việt Nam) để trả lại tồn khả dụng.
 * Trước đây hạn giữ chỉ được lưu mà không bao giờ áp dụng nên tồn khả dụng bị khóa vĩnh viễn.
 */
export async function releaseExpiredReservations(c: Queryable, productCode?: string): Promise<number> {
  const due = await c.query(
    `SELECT id FROM inventory_reservations
      WHERE status = 'ACTIVE' AND hold_until_date IS NOT NULL AND hold_until_date < $1::date
        AND ($2::text IS NULL OR product_code = $2::text)
      ORDER BY product_code, id`,
    [todayVN(), productCode ?? null]
  );
  let released = 0;
  for (const row of due.rows) {
    const r = await releaseReservation(c, Number(row.id), "Hệ thống", "Hết hạn giữ chỗ");
    if (r.released) released++;
  }
  return released;
}

let lastExpirySweepAt = 0;
/** Quét toàn bộ phiếu giữ chỗ quá hạn, tối đa 5 phút một lần (gọi khi mở màn hình Kho / Kinh doanh). */
export async function sweepExpiredReservations(run: (fn: (c: Queryable) => Promise<number>) => Promise<number>): Promise<void> {
  if (Date.now() - lastExpirySweepAt < 5 * 60 * 1000) return;
  lastExpirySweepAt = Date.now();
  try {
    const n = await run(c => releaseExpiredReservations(c));
    if (n > 0) console.info(`[inventory] Đã tự giải phóng ${n} phiếu giữ chỗ quá hạn.`);
  } catch (err: any) {
    lastExpirySweepAt = 0;
    console.error("[inventory] Không giải phóng được phiếu giữ chỗ quá hạn:", err?.message || err);
  }
}

/** Release all ACTIVE reservations of an order line (e.g. cancelled SO line) and give back allocation. */
export async function releaseReservationsFor(c: Queryable, orderCode: string, productCode: string, note: string): Promise<number> {
  const agg = await lockAggregate(c, productCode);
  const rel = await c.query(
    `UPDATE inventory_reservations
        SET status = 'RELEASED', notes = COALESCE(notes, '') || $1
      WHERE order_code = $2 AND product_code = $3 AND status = 'ACTIVE'
      RETURNING quantity_reserved`,
    [note, orderCode, productCode]
  );
  const releasedQty = rel.rows.reduce((s: number, row: any) => s + toQty(row.quantity_reserved), 0);
  if (agg && releasedQty > 0) await decrementAllocated(c, productCode, releasedQty, toQty(agg.quantity_allocated));
  return releasedQty;
}

/** Lot recall: quarantine the lot (and unknown-lot stock, conservatively); aggregate flagged only when no clean stock remains. */
export async function quarantineLot(c: Queryable, productCode: string, lotNumber: string, reason: string) {
  await lockAggregate(c, productCode);
  await seedLotsFromAggregate(c, productCode);
  await c.query(
    `UPDATE inventory_lots
        SET is_quarantined = true, quarantine_reason = $1, last_updated = now()
      WHERE product_code = $2 AND (lot_number = $3 OR lot_number = '${NO_LOT}')`,
    [reason, productCode, normLot(lotNumber)]
  );
  await c.query(
    `UPDATE inventory_items
        SET quarantine_reason = $1,
            is_quarantined = NOT EXISTS (
              SELECT 1 FROM inventory_lots l
               WHERE l.product_code = $2 AND l.quantity_on_hand > 0 AND NOT l.is_quarantined)
      WHERE product_code = $2`,
    [reason, productCode]
  );
  await refreshAggregateLotInfo(c, productCode);
}

/** Lift a lot quarantine; the aggregate flag stays on only while other quarantined stock exists and no clean stock does. */
export async function releaseLotQuarantine(c: Queryable, productCode: string, lotNumber: string) {
  await lockAggregate(c, productCode);
  await seedLotsFromAggregate(c, productCode);
  await c.query(
    `UPDATE inventory_lots
        SET is_quarantined = false, quarantine_reason = NULL, last_updated = now()
      WHERE product_code = $1 AND (lot_number = $2 OR lot_number = '${NO_LOT}')`,
    [productCode, normLot(lotNumber)]
  );
  await c.query(
    `UPDATE inventory_items
        SET is_quarantined = EXISTS (SELECT 1 FROM inventory_lots l WHERE l.product_code = $1 AND l.is_quarantined AND l.quantity_on_hand > 0)
                         AND NOT EXISTS (SELECT 1 FROM inventory_lots l WHERE l.product_code = $1 AND NOT l.is_quarantined AND l.quantity_on_hand > 0),
            quarantine_reason = CASE WHEN EXISTS (SELECT 1 FROM inventory_lots l WHERE l.product_code = $1 AND l.is_quarantined)
                                     THEN quarantine_reason ELSE NULL END
      WHERE product_code = $1`,
    [productCode]
  );
  await refreshAggregateLotInfo(c, productCode);
}

/** Thêm mặt hàng mới về kho vào danh mục hàng thương mại (bảng catalog_items; đã có mã thì bỏ qua). */
export async function appendCommercialCatalogEntry(c: Queryable, entry: Record<string, any>) {
  await appendCatalogEntry(c, entry);
}

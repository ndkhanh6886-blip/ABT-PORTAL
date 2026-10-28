import fs from "fs";
import { syncLegacySalesData } from "./legacySalesSync";
import { hashPassword } from "@/backend/services/passwords";
import path from "path";
import { Pool, PoolClient, types } from "pg";

/*
 * Ngày giờ theo giờ Việt Nam (UTC+7), không phụ thuộc cấu hình múi giờ của máy chủ / CSDL:
 * - Cột DATE trả về đúng chuỗi "YYYY-MM-DD". Trước đây thư viện đổi thành 0 giờ theo giờ máy chủ rồi gửi xuống
 *   trình duyệt dạng UTC ("2026-10-24T17:00Z" cho ngày 25/10) -> hạn chót hiện lùi 1 ngày, và mỗi lần mở ra lưu
 *   lại lùi thêm 1 ngày.
 * - Cột TIMESTAMP (không múi giờ) lưu giờ Việt Nam (phiên làm việc đặt múi giờ Asia/Ho_Chi_Minh bên dưới) và
 *   được đọc đúng là giờ Việt Nam.
 */
const VN_OFFSET = "+07:00";
types.setTypeParser(1082, (v: string) => v); // date
types.setTypeParser(1114, (v: string) => (v ? new Date(`${v.replace(" ", "T")}${VN_OFFSET}`) : (v as any))); // timestamp
import { AsyncLocalStorage } from "async_hooks";

/** Who performs the current request, for the audit log (set by setAuditActor in authz.ts). */
const auditActorStore = new AsyncLocalStorage<{ username: string; fullName: string }>();
export function setAuditActorContext(actor: { username: string; fullName: string }) {
  auditActorStore.enterWith(actor);
}

// Global database connection pool for TBRs Portal (PostgreSQL 18)
if (process.env.NODE_ENV === "production" && !process.env.PGPASSWORD) {
  console.warn("⚠️ CẢNH BÁO AN NINH: Biến môi trường PGPASSWORD chưa được thiết lập trong môi trường Production!");
}

const pool = new Pool({
  host: process.env.PGHOST || "127.0.0.1",
  port: parseInt(process.env.PGPORT || "5432"),
  user: process.env.PGUSER || "postgres",
  password: process.env.PGPASSWORD || "12345678",
  database: process.env.PGDATABASE || "tbrs_portal",
  max: 25,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});
// Mọi phiên làm việc dùng giờ Việt Nam: NOW()/CURRENT_TIMESTAMP/CURRENT_DATE đúng giờ, đúng ngày ở Việt Nam
// (trước đây máy chủ CSDL để UTC: thời gian lưu lệch 7 giờ, CURRENT_DATE còn là "hôm qua" trước 7 giờ sáng).
pool.on("connect", (client) => {
  client.query("SET TIME ZONE 'Asia/Ho_Chi_Minh'").catch(() => {});
});

/**
 * Business error carrying an HTTP status. Throw it inside route handlers / transactions;
 * the outer catch maps it with `httpErrorStatus(error)`.
 */
export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "HttpError";
  }
}

/** Map any thrown error to an HTTP status (HttpError -> its status, PG unique/check violations -> 409, else 500). */
export function httpErrorStatus(error: any): number {
  if (error instanceof HttpError) return error.status;
  if (error?.code === "23505" || error?.code === "23514") return 409; // unique_violation / check_violation
  if (error?.code === "55P03" || error?.code === "40P01") return 409; // lock_not_available / deadlock_detected
  return 500;
}

export async function withTransaction<T>(
  callback: (client: PoolClient) => Promise<T>,
  opts: { lockTimeoutMs?: number; statementTimeoutMs?: number } = {}
): Promise<T> {
  if (!isPersonnelEnsured) {
    await ensurePersonnelTable();
  }
  const client = await pool.connect();
  let broken: Error | undefined;
  try {
    await client.query("BEGIN");
    // Fail fast instead of piling up behind a lock (protects the 25-connection pool)
    await client.query(`SET LOCAL lock_timeout = '${Math.max(100, Math.floor(opts.lockTimeoutMs ?? 5000))}ms'`);
    await client.query(`SET LOCAL statement_timeout = '${Math.max(1000, Math.floor(opts.statementTimeoutMs ?? 30000))}ms'`);
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rbErr) {
      broken = rbErr as Error;
      console.error("[withTransaction] ROLLBACK failed, destroying connection:", rbErr);
    }
    throw error; // always surface the ORIGINAL error
  } finally {
    client.release(broken); // destroy the connection if ROLLBACK failed
  }
}

let isPersonnelEnsured = false;
let ensurePromise: Promise<void> | null = null;

const INTEGRITY_MIGRATION_LOCK_KEY = 74210001;

/**
 * Data-integrity migrations from the Deep Code Audit.
 * Serialised across instances with a session-level advisory lock; every step is idempotent
 * and NEVER deletes user data (duplicates are renamed, counters are recomputed).
 */
async function runIntegrityMigrations() {
  const client = await pool.connect();
  let locked = false;
  try {
    await client.query("SELECT pg_advisory_lock($1)", [INTEGRITY_MIGRATION_LOCK_KEY]);
    locked = true;

    const step = async (name: string, fn: () => Promise<unknown>) => {
      try {
        await fn();
      } catch (e: any) {
        console.error(`[MIGRATION:${name}] failed:`, e?.message || e);
      }
    };
    const indexExists = async (name: string) =>
      (await client.query("SELECT 1 FROM pg_indexes WHERE indexname = $1", [name])).rows.length > 0;
    const flagDone = async (key: string) =>
      (await client.query("SELECT 1 FROM app_storage WHERE key = $1", [key])).rows.length > 0;
    const setFlag = (key: string) =>
      client.query(
        `INSERT INTO app_storage (key, data, updated_at) VALUES ($1, '{"done": true}'::jsonb, NOW())
         ON CONFLICT (key) DO NOTHING`,
        [key]
      );

    // H6: chat DDL moved out of the request path (was executed on every poll / message)
    await step("chat_schema", () =>
      client.query(`
        ALTER TABLE chat_channels ADD COLUMN IF NOT EXISTS members JSONB DEFAULT '[]'::jsonb;
        ALTER TABLE chat_channels ADD COLUMN IF NOT EXISTS pinned_messages JSONB DEFAULT '[]'::jsonb;
        ALTER TABLE chat_channels ADD COLUMN IF NOT EXISTS last_message_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP;
        ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS reply_to JSONB DEFAULT NULL;
        CREATE TABLE IF NOT EXISTS chat_channel_reads (
          channel_id INT NOT NULL REFERENCES chat_channels(id) ON DELETE CASCADE,
          user_name VARCHAR(150) NOT NULL,
          last_read_message_id INT NOT NULL DEFAULT 0,
          last_read_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (channel_id, user_name)
        );
        CREATE INDEX IF NOT EXISTS idx_chat_channel_reads_lookup ON chat_channel_reads(channel_id, user_name);
        UPDATE users SET full_name = 'Quản Trị Viên Hệ Thống' WHERE username = 'admin' AND (full_name IS NULL OR full_name = '');
      `)
    );

    // C1: supplier payment ledger with idempotency key; C4: optimistic locking on PO
    await step("procurement_payments", () =>
      client.query(`
        CREATE TABLE IF NOT EXISTS procurement_payments (
          id SERIAL PRIMARY KEY,
          po_id INTEGER NOT NULL REFERENCES procurement_orders(id) ON DELETE RESTRICT,
          request_id VARCHAR(64) NOT NULL,
          amount NUMERIC(18,2) NOT NULL CHECK (amount > 0),
          method VARCHAR(100),
          reference_doc VARCHAR(150),
          payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
          notes TEXT,
          created_by VARCHAR(150),
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          CONSTRAINT procurement_payments_idem UNIQUE (po_id, request_id)
        );
        CREATE INDEX IF NOT EXISTS idx_procurement_payments_po ON procurement_payments (po_id);
        ALTER TABLE procurement_orders ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 0;
      `)
    );

    // M2/C2: widen code columns (deterministic codes like PNK-<po_code>, TRK-<rma_code>)
    await step("widen_code_columns", () =>
      client.query(`
        DO $$
        BEGIN
          IF (SELECT character_maximum_length FROM information_schema.columns
               WHERE table_name = 'inventory_transactions' AND column_name = 'transaction_code') < 120 THEN
            ALTER TABLE inventory_transactions ALTER COLUMN transaction_code TYPE VARCHAR(120);
          END IF;
          IF (SELECT character_maximum_length FROM information_schema.columns
               WHERE table_name = 'procurement_orders' AND column_name = 'inbound_transaction_code') < 120 THEN
            ALTER TABLE procurement_orders ALTER COLUMN inbound_transaction_code TYPE VARCHAR(120);
          END IF;
        END $$;
      `)
    );

    // M2/C2/C3: unique document codes. Existing duplicates are RENAMED (never deleted).
    await step("unique_transaction_code", async () => {
      if (await indexExists("inventory_transactions_code_uidx")) return;
      await client.query(`
        UPDATE inventory_transactions t
           SET transaction_code = LEFT(t.transaction_code, 90) || '-DUP-' || t.id
          FROM (SELECT id, ROW_NUMBER() OVER (PARTITION BY transaction_code ORDER BY id) AS rn
                  FROM inventory_transactions) d
         WHERE d.id = t.id AND d.rn > 1;
        CREATE UNIQUE INDEX IF NOT EXISTS inventory_transactions_code_uidx ON inventory_transactions (transaction_code);
      `);
    });
    await step("unique_rma_code", async () => {
      if (await indexExists("rma_returns_code_uidx")) return;
      await client.query(`
        UPDATE rma_returns r
           SET rma_code = LEFT(r.rma_code, 80) || '-DUP-' || r.id
          FROM (SELECT id, ROW_NUMBER() OVER (PARTITION BY rma_code ORDER BY id) AS rn FROM rma_returns) d
         WHERE d.id = r.id AND d.rn > 1;
        CREATE UNIQUE INDEX IF NOT EXISTS rma_returns_code_uidx ON rma_returns (rma_code);
      `);
    });

    // D1: editing a sales order used to INSERT a second row with the same order_code (statuses reset to
    // PENDING/UNPAID, debt counted twice). Merge each group into its oldest row: content (items, totals,
    // customer...) from the newest row = the latest edit, the most advanced statuses across the group.
    // Every merged-away row is copied to sales_orders_duplicates_archive first, then the code is made unique.
    await step("dedupe_sales_orders", async () => {
      if (await indexExists("sales_orders_order_code_uidx")) return;
      const rank = (h: Record<string, number>, v: any) => h[String(v || "").toUpperCase()] ?? 0;
      const DELIVERY: Record<string, number> = { PENDING: 0, PROCESSING: 1, PACKED: 2, READY: 2, SHIPPED: 3, DISPATCHED: 3, DELIVERED: 4 };
      const INVOICE: Record<string, number> = { PENDING_INVOICE: 0, PENDING: 0, PARTIALLY_INVOICED: 1, ISSUED: 2, INVOICED: 2 };
      const PAYMENT: Record<string, number> = { UNPAID: 0, PARTIALLY_PAID: 1, PAID: 2 };
      const pickMax = (rows: any[], col: string, h: Record<string, number>) => {
        if (rows.some(r => String(r[col] || "").toUpperCase() === "CANCELLED")) return "CANCELLED";
        return rows.reduce((best, r) => (rank(h, r[col]) > rank(h, best) ? r[col] : best), rows[0][col]);
      };
      const asArray = (v: any) => (Array.isArray(v) ? v : typeof v === "string" ? (() => { try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch { return []; } })() : []);

      await client.query("BEGIN");
      try {
        await client.query(`CREATE TABLE IF NOT EXISTS sales_orders_duplicates_archive (LIKE sales_orders INCLUDING DEFAULTS)`);
        await client.query(`ALTER TABLE sales_orders_duplicates_archive ADD COLUMN IF NOT EXISTS merged_into_id INTEGER`);
        await client.query(`ALTER TABLE sales_orders_duplicates_archive ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP`);
        const groups = await client.query(
          `SELECT order_code FROM sales_orders GROUP BY order_code HAVING COUNT(*) > 1`
        );
        for (const g of groups.rows) {
          const rows = (await client.query("SELECT * FROM sales_orders WHERE order_code = $1 ORDER BY id ASC FOR UPDATE", [g.order_code])).rows;
          if (rows.length < 2) continue;
          const keep = rows[0];
          const latest = rows[rows.length - 1];
          const slips = new Map<string, any>();
          for (const r of rows) for (const s of asArray(r.invoiced_delivery_slips)) slips.set(String(s?.delivery_slip_id ?? JSON.stringify(s)), s);
          await client.query(
            `UPDATE sales_orders SET
               customer_id = COALESCE($2, customer_id), customer_name = $3, sales_rep_name = COALESCE($4, sales_rep_name),
               items = $5::jsonb, total_amount = $6, notes = COALESCE($7, notes),
               delivery_status = $8, payment_status = $9, invoice_status = $10,
               invoice_no = COALESCE(invoice_no, $11), invoice_date = COALESCE(invoice_date, $12),
               invoiced_delivery_slips = $13::jsonb,
               vat_requested = $14, vat_company_name = COALESCE($15, vat_company_name), vat_tax_code = COALESCE($16, vat_tax_code),
               vat_address = COALESCE($17, vat_address), vat_email = COALESCE($18, vat_email),
               shipping_method = COALESCE($19, shipping_method), tracking_code = COALESCE($20, tracking_code),
               is_credit_blocked = $21, price_approval_status = $22, has_zero_price_items = $23
             WHERE id = $1`,
            [
              keep.id, latest.customer_id, latest.customer_name, latest.sales_rep_name,
              JSON.stringify(asArray(latest.items)), latest.total_amount, latest.notes,
              pickMax(rows, "delivery_status", DELIVERY), pickMax(rows, "payment_status", PAYMENT), pickMax(rows, "invoice_status", INVOICE),
              rows.map(r => r.invoice_no).find(Boolean) || null, rows.map(r => r.invoice_date).find(Boolean) || null,
              JSON.stringify(Array.from(slips.values())),
              rows.some(r => r.vat_requested), latest.vat_company_name, latest.vat_tax_code, latest.vat_address, latest.vat_email,
              latest.shipping_method, latest.tracking_code,
              rows.some(r => r.is_credit_blocked) && !rows.some(r => r.credit_override_at),
              rows.some(r => r.price_approval_status === "PENDING_APPROVAL") && latest.price_approval_status !== "APPROVED" ? "PENDING_APPROVAL" : (latest.price_approval_status || keep.price_approval_status),
              Boolean(latest.has_zero_price_items)
            ]
          );
          const dupIds = rows.slice(1).map(r => r.id);
          await client.query(
            `INSERT INTO sales_orders_duplicates_archive SELECT s.*, $2::int AS merged_into_id, CURRENT_TIMESTAMP AS archived_at FROM sales_orders s WHERE s.id = ANY($1::int[])`,
            [dupIds, keep.id]
          );
          await client.query("DELETE FROM sales_orders WHERE id = ANY($1::int[])", [dupIds]);
        }
        await client.query("CREATE UNIQUE INDEX IF NOT EXISTS sales_orders_order_code_uidx ON sales_orders (order_code)");
        await client.query("COMMIT");
      } catch (e) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw e;
      }
    });

    // S1: login protection (lockout after repeated failures), forced change of default passwords and
    // server-side session revocation (session_version is embedded in the session cookie)
    await step("user_security_columns", () =>
      client.query(`
        ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_login_count INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT false;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS session_version INTEGER NOT NULL DEFAULT 0;
      `)
    );
    // Zalo account linking by one-time code generated in the portal (no more self-linking by phone / employee code)
    await step("zalo_link_code_columns", () =>
      client.query(`
        ALTER TABLE zalo_user_bindings ADD COLUMN IF NOT EXISTS link_code_hash VARCHAR(100);
        ALTER TABLE zalo_user_bindings ADD COLUMN IF NOT EXISTS link_code_expires TIMESTAMPTZ;
      `)
    );

    // D3: approval decisions of sales order requests are recorded server-side (who / when / why)
    await step("sales_order_approval_columns", () =>
      client.query(`
        ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS approval_status VARCHAR(20);
        ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS approved_by VARCHAR(150);
        ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP WITHOUT TIME ZONE;
        ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS approval_note TEXT;
        -- owner (sales rep id) and PR / procurement links are stored with the order so the database copy
        -- is complete on its own (they used to live only in the app_storage copy and got lost on reload)
        ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS sales_rep_id VARCHAR(50);
        ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS pr_code VARCHAR(100);
        ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS procure_status VARCHAR(50);
        ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS procure_order_code VARCHAR(100);
        ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS fulfillment_source VARCHAR(50);
        -- delivery confirmation (isDelivered / deliveredAt) is kept here; the credit term starts at the delivery date
        ALTER TABLE sales_delivery_slips ADD COLUMN IF NOT EXISTS extra_data JSONB DEFAULT '{}'::jsonb;
      `)
    );

    // D2: duplicate quotation codes (rows of the same quote): keep the newest content in the oldest row.
    await step("dedupe_sales_quotations", async () => {
      if (await indexExists("idx_sales_quotations_quote_code")) return;
      await client.query("BEGIN");
      try {
        await client.query(`CREATE TABLE IF NOT EXISTS sales_quotations_duplicates_archive (LIKE sales_quotations INCLUDING DEFAULTS)`);
        await client.query(`ALTER TABLE sales_quotations_duplicates_archive ADD COLUMN IF NOT EXISTS extra_data JSONB`);
        await client.query(`ALTER TABLE sales_quotations ADD COLUMN IF NOT EXISTS extra_data JSONB DEFAULT '{}'::jsonb`);
        await client.query(`ALTER TABLE sales_quotations_duplicates_archive ADD COLUMN IF NOT EXISTS merged_into_id INTEGER`);
        const groups = await client.query(`SELECT quote_code FROM sales_quotations GROUP BY quote_code HAVING COUNT(*) > 1`);
        for (const g of groups.rows) {
          const rows = (await client.query("SELECT * FROM sales_quotations WHERE quote_code = $1 ORDER BY id ASC FOR UPDATE", [g.quote_code])).rows;
          if (rows.length < 2) continue;
          const keep = rows[0];
          const latest = rows[rows.length - 1];
          await client.query(
            `UPDATE sales_quotations SET customer_id = $2, customer_name = $3, sales_rep_name = $4, date = $5, valid_until = $6,
               items = $7::jsonb, subtotal = $8, discount_rate = $9, discount_amount = $10, tax_rate = $11, tax_amount = $12,
               total_amount = $13, status = $14, terms = $15
             WHERE id = $1`,
            [keep.id, latest.customer_id, latest.customer_name, latest.sales_rep_name, latest.date, latest.valid_until,
             typeof latest.items === "string" ? latest.items : JSON.stringify(latest.items || []), latest.subtotal, latest.discount_rate,
             latest.discount_amount, latest.tax_rate, latest.tax_amount, latest.total_amount, latest.status, latest.terms]
          );
          const dupIds = rows.slice(1).map(r => r.id);
          await client.query(
            `INSERT INTO sales_quotations_duplicates_archive (id, quote_code, customer_id, customer_name, sales_rep_name, date, valid_until, items, subtotal, discount_rate, discount_amount, tax_rate, tax_amount, total_amount, status, terms, created_at, extra_data, merged_into_id)
             SELECT id, quote_code, customer_id, customer_name, sales_rep_name, date, valid_until, items, subtotal, discount_rate, discount_amount, tax_rate, tax_amount, total_amount, status, terms, created_at, extra_data, $2::int
               FROM sales_quotations WHERE id = ANY($1::int[])`,
            [dupIds, keep.id]
          );
          await client.query("DELETE FROM sales_quotations WHERE id = ANY($1::int[])", [dupIds]);
        }
        await client.query("CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_quotations_quote_code ON sales_quotations (quote_code)");
        await client.query("COMMIT");
      } catch (e) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw e;
      }
    });

    // H2: multi-lot stock model. inventory_items stays as the per-product aggregate.
    await step("inventory_lots", () =>
      client.query(`
        CREATE TABLE IF NOT EXISTS inventory_lots (
          id SERIAL PRIMARY KEY,
          product_code VARCHAR(100) NOT NULL,
          lot_number VARCHAR(100) NOT NULL DEFAULT 'NO-LOT',
          expiry_date VARCHAR(50),
          warehouse_location VARCHAR(100) NOT NULL DEFAULT 'Kho Trung Tâm',
          quantity_on_hand INTEGER NOT NULL DEFAULT 0 CHECK (quantity_on_hand >= 0),
          is_quarantined BOOLEAN NOT NULL DEFAULT false,
          quarantine_reason TEXT,
          unit_cost NUMERIC DEFAULT 0,
          created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          last_updated TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT inventory_lots_unique UNIQUE (product_code, lot_number, warehouse_location)
        );
        ALTER TABLE inventory_lots ADD COLUMN IF NOT EXISTS unit_cost NUMERIC DEFAULT 0;
        CREATE INDEX IF NOT EXISTS idx_inventory_lots_fefo ON inventory_lots (product_code, expiry_date);
        -- Backfill: one lot per product that has stock but no lot rows yet (idempotent)
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
        ON CONFLICT DO NOTHING;
      `)
    );

    // H5: one-time reconciliation of leaked quantity_allocated, then CHECK constraints
    await step("allocation_reconcile", async () => {
      if (await flagDone("integrity_alloc_reconcile_v1")) return;
      await client.query("BEGIN");
      try {
        await client.query(`
          UPDATE inventory_reservations SET status = 'ACTIVE' WHERE status IS NULL;
          UPDATE inventory_items SET quantity_on_hand = 0 WHERE quantity_on_hand IS NULL OR quantity_on_hand < 0;
          UPDATE inventory_items i
             SET quantity_allocated = COALESCE(s.total, 0)
            FROM inventory_items i2
            LEFT JOIN (SELECT product_code, SUM(COALESCE(quantity_reserved, 0))::int AS total
                         FROM inventory_reservations WHERE status = 'ACTIVE' GROUP BY product_code) s
                   ON s.product_code = i2.product_code
           WHERE i.id = i2.id AND COALESCE(i.quantity_allocated, -1) <> COALESCE(s.total, 0);
        `);
        await setFlag("integrity_alloc_reconcile_v1");
        await client.query("COMMIT");
      } catch (e) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw e;
      }
    });
    // Ngày giao thực tế của đơn (trước đây bị ghi vào invoice_date) + sổ thu tiền khách hàng
    await step("sales_delivery_and_payments", () =>
      client.query(`
        ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS delivered_at DATE;
        ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS amount_paid NUMERIC(15,2) NOT NULL DEFAULT 0;
        CREATE TABLE IF NOT EXISTS sales_payments (
          id SERIAL PRIMARY KEY,
          order_id INTEGER NOT NULL REFERENCES sales_orders(id) ON DELETE RESTRICT,
          order_code VARCHAR(100) NOT NULL,
          amount NUMERIC(15,2) NOT NULL CHECK (amount > 0),
          payment_date DATE NOT NULL,
          method VARCHAR(50),
          reference VARCHAR(150),
          notes TEXT,
          request_id VARCHAR(100),
          created_by VARCHAR(150),
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          CONSTRAINT sales_payments_idem UNIQUE (order_id, request_id)
        );
        CREATE INDEX IF NOT EXISTS idx_sales_payments_order ON sales_payments (order_id);
      `)
    );
    // Góp ý người dùng 10/2026: ghi chú SO, thu tiền theo phiếu giao, phiếu chi NCC (nhiều PO, hủy khoản chi), HĐ đầu vào theo PO
    await step("feedback_2026_10_columns", () =>
      client.query(`
        ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS order_notes TEXT;
        ALTER TABLE sales_payments ADD COLUMN IF NOT EXISTS delivery_slip_code VARCHAR(100);
        CREATE INDEX IF NOT EXISTS idx_sales_payments_slip ON sales_payments (delivery_slip_code);
        ALTER TABLE procurement_payments ADD COLUMN IF NOT EXISTS voucher_code VARCHAR(64);
        ALTER TABLE procurement_payments ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ;
        ALTER TABLE procurement_payments ADD COLUMN IF NOT EXISTS voided_by VARCHAR(150);
        ALTER TABLE procurement_payments ADD COLUMN IF NOT EXISTS void_reason TEXT;
        CREATE INDEX IF NOT EXISTS idx_procurement_payments_voucher ON procurement_payments (voucher_code);
        ALTER TABLE procurement_orders ADD COLUMN IF NOT EXISTS supplier_invoices JSONB NOT NULL DEFAULT '[]'::jsonb;
      `)
    );
    // Hủy khoản thu ghi nhầm (giữ lịch sử, không xóa)
    await step("sales_payments_void_columns", () =>
      client.query(`
        ALTER TABLE sales_payments ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ;
        ALTER TABLE sales_payments ADD COLUMN IF NOT EXISTS voided_by VARCHAR(150);
        ALTER TABLE sales_payments ADD COLUMN IF NOT EXISTS void_reason TEXT;
      `)
    );
    // Số HĐ đầu vào trước đây chỉ nằm trong ghi chú phiếu nhập ("HĐ/Tờ khai: ..."): chép sang PO một lần
    await step("backfill_po_supplier_invoices", async () => {
      if (await flagDone("migration_backfill_po_supplier_invoices")) return;
      const tx = (await client.query(
        `SELECT transaction_code, date, notes FROM inventory_transactions
          WHERE transaction_type = 'INBOUND' AND notes LIKE 'Nhập kho theo PO %' AND notes LIKE '%HĐ/Tờ khai:%'`
      )).rows;
      let n = 0;
      for (const t of tx) {
        const notes = String(t.notes || "");
        const po = notes.match(/^Nhập kho theo PO (\S+)/)?.[1];
        const inv = notes.match(/HĐ\/Tờ khai:\s*(.+?)(?:\s+•|\s+\[req:|$)/)?.[1]?.trim();
        if (!po || !inv) continue;
        const d = t.date ? new Date(t.date) : null;
        const iso = d && !isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : null;
        const r = await client.query(
          `UPDATE procurement_orders
              SET supplier_invoices = COALESCE(supplier_invoices, '[]'::jsonb) || $1::jsonb
            WHERE po_code = $2
              AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(supplier_invoices, '[]'::jsonb)) e WHERE e->>'inbound_code' = $3)`,
          [JSON.stringify([{ invoice_no: inv.slice(0, 100), invoice_date: iso, inbound_code: t.transaction_code }]), po, t.transaction_code]
        );
        n += r.rowCount || 0;
      }
      await setFlag("migration_backfill_po_supplier_invoices");
      console.log(`[MIGRATION:backfill_po_supplier_invoices] ${n} hóa đơn đầu vào đã chép sang PO`);
    });
    // Báo cáo kết quả đã ghi trong công việc của phiếu phối hợp nhưng bên yêu cầu không thấy: chép sang trao đổi của phiếu
    await step("backfill_task_reports_to_workflow", async () => {
      if (await flagDone("migration_task_reports_to_workflow")) return;
      const rows = (await client.query(
        `SELECT t.task_code, t.assignee_name, t.result, t.attachments, w.id AS wf_id, COALESCE(w.comments, '[]'::jsonb) AS comments
           FROM company_tasks t JOIN workflow_requests w ON w.workflow_code = t.related_workflow_code
          WHERE COALESCE(TRIM(t.result), '') <> ''`
      )).rows;
      let n = 0;
      for (const r of rows) {
        const text = String(r.result).trim();
        const comments: any[] = Array.isArray(r.comments) ? r.comments : [];
        if (comments.some((c: any) => String(c?.text || "").trim() === text)) continue;
        const comment = { author: r.assignee_name || "Nhân viên", time: "Báo cáo công việc (trước đây)", text, attachments: Array.isArray(r.attachments) ? r.attachments : [], source: "task", task_code: r.task_code };
        await client.query("UPDATE workflow_requests SET comments = COALESCE(comments, '[]'::jsonb) || $1::jsonb WHERE id = $2", [JSON.stringify([comment]), r.wf_id]);
        n++;
      }
      await setFlag("migration_task_reports_to_workflow");
      console.log(`[MIGRATION:task_reports_to_workflow] ${n} báo cáo công việc đã chép sang phiếu phối hợp`);
    });
    // One-time repair of delivery / invoice status lost by the order-code bug + cancel placeholder POs
    await step("legacy_sales_sync_2026_10", async () => {
      if (await flagDone("migration_legacy_sales_sync_2026_10")) return;
      const rep = await syncLegacySalesData(client);
      await setFlag("migration_legacy_sales_sync_2026_10");
      console.log("[MIGRATION:legacy_sales_sync_2026_10]", Object.fromEntries(Object.entries(rep).map(([k, v]) => [k, (v as any[]).length])));
    });
    // PO goods receipt in several deliveries: received quantity per PO line (index -> qty)
    // Nhật ký chăm sóc khách hàng về kỹ thuật (phòng Application)
    await step("tech_care_logs", () =>
      client.query(`
        CREATE TABLE IF NOT EXISTS tech_care_logs (
          id SERIAL PRIMARY KEY,
          customer_id INT,
          customer_name VARCHAR(255) NOT NULL,
          contact_name VARCHAR(255),
          activity_type VARCHAR(50) NOT NULL,
          activity_date DATE NOT NULL DEFAULT CURRENT_DATE,
          content TEXT NOT NULL,
          satisfaction SMALLINT,
          performed_by VARCHAR(150),
          attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
          next_followup_date DATE,
          next_followup_note TEXT,
          followup_done BOOLEAN NOT NULL DEFAULT FALSE,
          created_by VARCHAR(150),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_tech_care_customer ON tech_care_logs (LOWER(customer_name));
        CREATE INDEX IF NOT EXISTS idx_tech_care_followup ON tech_care_logs (next_followup_date) WHERE followup_done = FALSE;
      `)
    );
    // Danh mục hàng thương mại: mỗi mặt hàng một dòng (thay khối JSON app_storage.sales_commercial_products).
    // Chuyển dữ liệu một lần; khối cũ giữ nguyên làm bản dự phòng.
    await step("catalog_items", async () => {
      await client.query(`
        CREATE TABLE IF NOT EXISTS catalog_items (
          code TEXT PRIMARY KEY,
          data JSONB NOT NULL,
          sort_order BIGINT NOT NULL DEFAULT 0,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_catalog_items_sort ON catalog_items (sort_order, code);
      `);
      if (await flagDone("migration_catalog_items_v1")) return;
      await client.query(`
        INSERT INTO catalog_items (code, data, sort_order)
        SELECT DISTINCT ON (TRIM(e->>'code')) TRIM(e->>'code'), jsonb_set(e, '{code}', to_jsonb(TRIM(e->>'code'))), t.ord
          FROM app_storage s, jsonb_array_elements(CASE WHEN jsonb_typeof(s.data) = 'array' THEN s.data ELSE '[]'::jsonb END) WITH ORDINALITY AS t(e, ord)
         WHERE s.key = 'sales_commercial_products' AND COALESCE(TRIM(e->>'code'), '') <> ''
         ORDER BY TRIM(e->>'code'), t.ord DESC
        ON CONFLICT (code) DO NOTHING
      `);
      await setFlag("migration_catalog_items_v1");
    });
    // Tên nhà cung cấp ABT bị sai do form nhập kho từng điền sẵn tên mẫu: sửa một lần ở mọi nơi lưu tên NCC
    // (chứng từ nhập kho đã lập giữ nguyên như lúc lập).
    await step("fix_abt_supplier_name", async () => {
      if (await flagDone("migration_fix_abt_supplier_name_v1")) return;
      const wrong = "công ty tnhh thiết bị & hóa chất abt";
      const right = "Công ty TNHH Giải pháp Y Sinh ABT";
      await client.query("UPDATE procurement_suppliers SET name = $2 WHERE LOWER(TRIM(name)) = $1", [wrong, right]);
      await client.query("UPDATE procurement_orders SET supplier_name = $2 WHERE LOWER(TRIM(supplier_name)) = $1", [wrong, right]);
      await client.query("UPDATE products SET manufacturer = $2 WHERE LOWER(TRIM(manufacturer)) = $1", [wrong, right]);
      for (const field of ["supplier", "manufacturer", "brand"]) {
        await client.query(
          `UPDATE catalog_items SET data = jsonb_set(data, ARRAY[$3::text], to_jsonb($2::text)), updated_at = now()
            WHERE LOWER(TRIM(data->>$3)) = $1`,
          [wrong, right, field]
        );
      }
      await setFlag("migration_fix_abt_supplier_name_v1");
    });
    // Dữ liệu thời gian cũ được ghi khi CSDL còn dùng múi giờ mặc định của máy chủ (UTC trên máy chủ thật):
    // dời một lần cho đúng giờ Việt Nam. Không dời nếu máy chủ CSDL vốn đã là UTC+7.
    await step("shift_timestamps_to_vn", async () => {
      if (await flagDone("migration_timestamps_vn_v1")) return;
      const tz = (await client.query("SELECT reset_val FROM pg_settings WHERE name = 'TimeZone'")).rows[0]?.reset_val || "UTC";
      const off = await client.query(
        "SELECT EXTRACT(EPOCH FROM ((now() AT TIME ZONE 'Asia/Ho_Chi_Minh') - (now() AT TIME ZONE $1)))::int AS sec",
        [tz]
      );
      const sec = Number(off.rows[0]?.sec || 0);
      // cả bước trong một giao dịch: lỗi giữa chừng thì không bảng nào bị dời (tránh dời hai lần khi chạy lại)
      await client.query("BEGIN");
      try {
      if (sec !== 0) {
        const cols = await client.query(
          `SELECT table_name, column_name FROM information_schema.columns
            WHERE table_schema = 'public' AND data_type = 'timestamp without time zone'`
        );
        for (const r of cols.rows) {
          await client.query(
            `UPDATE "${r.table_name}" SET "${r.column_name}" = "${r.column_name}" + make_interval(secs => $1) WHERE "${r.column_name}" IS NOT NULL`,
            [sec]
          );
        }
        console.log(`🕐 Đã dời dữ liệu thời gian cũ ${sec / 3600} giờ (múi giờ CSDL cũ: ${tz}) sang giờ Việt Nam.`);
      }
      await setFlag("migration_timestamps_vn_v1");
      await client.query("COMMIT");
      } catch (e) {
        await client.query("ROLLBACK").catch(() => {});
        throw e;
      }
    });
    await step("procurement_partial_receipts", () =>
      client.query(`
        ALTER TABLE procurement_orders ADD COLUMN IF NOT EXISTS received_qty JSONB NOT NULL DEFAULT '{}'::jsonb;
        CREATE INDEX IF NOT EXISTS idx_inventory_transactions_reference ON inventory_transactions (reference_code);
      `)
    );
    // Khóa lạc quan cho đơn bán: mỗi lần lưu tăng row_version, lưu đè lên bản cũ bị từ chối (409)
    await step("sales_orders_row_version", () =>
      client.query(`ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS row_version INTEGER NOT NULL DEFAULT 0`)
    );

    // Chỉ mục cho các cột tra cứu thường xuyên (lọc theo khách hàng, ngày, trạng thái, giữ chỗ)
    await step("hot_column_indexes", () =>
      client.query(`
        CREATE INDEX IF NOT EXISTS idx_sales_orders_customer_id ON sales_orders (customer_id);
        CREATE INDEX IF NOT EXISTS idx_sales_orders_order_date ON sales_orders (order_date DESC);
        CREATE INDEX IF NOT EXISTS idx_sales_orders_delivery_status ON sales_orders (delivery_status);
        CREATE INDEX IF NOT EXISTS idx_sales_quotations_customer_id ON sales_quotations (customer_id);
        CREATE INDEX IF NOT EXISTS idx_sales_contracts_customer_id ON sales_contracts (customer_id);
        CREATE INDEX IF NOT EXISTS idx_sales_payments_order_id ON sales_payments (order_id);
        CREATE INDEX IF NOT EXISTS idx_sales_delivery_slips_order_code ON sales_delivery_slips (order_code);
        CREATE INDEX IF NOT EXISTS idx_inventory_reservations_active ON inventory_reservations (status, product_code, hold_until_date);
        CREATE INDEX IF NOT EXISTS idx_inventory_transactions_date ON inventory_transactions (date DESC);
        CREATE INDEX IF NOT EXISTS idx_workflow_requests_status ON workflow_requests (status);
        CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs (created_at DESC);
      `)
    );

    await step("inventory_checks", () =>
      client.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_items_allocated_nonneg') THEN
            ALTER TABLE inventory_items ADD CONSTRAINT inventory_items_allocated_nonneg CHECK (quantity_allocated >= 0);
          END IF;
          IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_items_on_hand_nonneg') THEN
            ALTER TABLE inventory_items ADD CONSTRAINT inventory_items_on_hand_nonneg CHECK (quantity_on_hand >= 0);
          END IF;
        END $$;
      `)
    );
  } finally {
    if (locked) {
      await client.query("SELECT pg_advisory_unlock($1)", [INTEGRITY_MIGRATION_LOCK_KEY]).catch((e) =>
        console.error("[MIGRATION] advisory unlock failed:", e?.message)
      );
    }
    client.release();
  }
}

export async function ensurePersonnelTable() {
  if (isPersonnelEnsured) return;
  // Every concurrent caller awaits the same in-flight run (previously callers returned early
  // and could hit the DB before migrations had finished).
  if (!ensurePromise) {
    ensurePromise = ensurePersonnelTableImpl().finally(() => {
      ensurePromise = null;
    });
  }
  return ensurePromise;
}

async function ensurePersonnelTableImpl() {
  try {
    // 0. Ensure all core database tables exist from schema.sql
    try {
      const candidates = [
        path.join(process.cwd(), "src/backend/db/schema.sql"),
        path.join(__dirname, "schema.sql"),
        "/var/www/TBR-portal/src/backend/db/schema.sql",
        "/var/www/tbr-portal/src/backend/db/schema.sql"
      ];
      for (const p of candidates) {
        if (fs.existsSync(p)) {
          const sql = fs.readFileSync(p, "utf-8");
          await pool.query(sql);
          break;
        }
      }
    } catch (e: any) {
      console.warn("Could not execute schema.sql:", e?.message);
    }

    // 1. Ensure columns exist on users table
    try {
      await pool.query(`
        ALTER TABLE users ADD COLUMN IF NOT EXISTS permissions JSONB DEFAULT '{}';
        ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar TEXT;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS department VARCHAR(100);
        ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMP WITH TIME ZONE;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT false;
      `);
    } catch (e: any) {
      console.warn("Could not alter users table:", e?.message);
    }

    // 2. Ensure audit_logs table exists
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS audit_logs (
          id SERIAL PRIMARY KEY,
          action VARCHAR(100),
          module VARCHAR(100),
          details TEXT,
          actor_username VARCHAR(100),
          actor_name VARCHAR(150),
          ip_address VARCHAR(50),
          created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
      `);
    } catch (e: any) {
      console.warn("Could not create audit_logs table:", e?.message);
    }

    // 3. Drop unique constraint on users.email so multiple personnel can share department email
    try {
      await pool.query(`
        ALTER TABLE users DROP CONSTRAINT IF EXISTS users_email_key;
        DROP INDEX IF EXISTS users_email_key;
      `);
    } catch (e: any) {
      console.warn("Could not drop users_email_key constraint:", e?.message);
    }

    // 3b. Ensure unique indexes for ON CONFLICT targets
    try {
      await pool.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS products_code_uidx ON products (code);
        CREATE UNIQUE INDEX IF NOT EXISTS sales_customers_code_uidx ON sales_customers (customer_code);
        CREATE UNIQUE INDEX IF NOT EXISTS procurement_suppliers_code_uidx ON procurement_suppliers (supplier_code);
        ALTER TABLE procurement_suppliers ADD COLUMN IF NOT EXISTS short_name VARCHAR(100);
        CREATE UNIQUE INDEX IF NOT EXISTS inventory_items_product_code_uidx ON inventory_items (product_code);
        CREATE UNIQUE INDEX IF NOT EXISTS procurement_orders_po_code_uidx ON procurement_orders (po_code);
        ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS quantity_reserved INTEGER DEFAULT 0;
        ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS quantity_available INTEGER DEFAULT 0;

        CREATE TABLE IF NOT EXISTS supplier_products (
          id SERIAL PRIMARY KEY,
          supplier_id INTEGER NOT NULL REFERENCES procurement_suppliers(id) ON DELETE CASCADE,
          product_code VARCHAR(100) NOT NULL,
          product_name VARCHAR(255) NOT NULL,
          specification VARCHAR(255),
          unit VARCHAR(50) DEFAULT 'Cái',
          currency VARCHAR(10) DEFAULT 'VND',
          purchase_price NUMERIC DEFAULT 0,
          tax_rate NUMERIC DEFAULT 0,
          lead_time_days INTEGER DEFAULT 7,
          min_order_qty INTEGER DEFAULT 1,
          notes TEXT,
          price_history JSONB DEFAULT '[]'::jsonb,
          last_updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT supplier_products_unique UNIQUE (supplier_id, product_code)
        );
        CREATE INDEX IF NOT EXISTS idx_supplier_products_supplier ON supplier_products (supplier_id);
        CREATE INDEX IF NOT EXISTS idx_supplier_products_code ON supplier_products (product_code);
      `);
    } catch (e: any) {
      console.warn("Could not create unique indexes or alter inventory_items:", e?.message);
    }

    // 4. Ensure personnel table exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS personnel (
        id SERIAL PRIMARY KEY,
        employee_code VARCHAR(50) UNIQUE,
        full_name VARCHAR(150) NOT NULL,
        department VARCHAR(100),
        position VARCHAR(150),
        email VARCHAR(150),
        phone VARCHAR(50),
        status VARCHAR(50) DEFAULT 'ACTIVE',
        created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    const defaultPasswordHash = hashPassword("123456");

    // 5. Ensure admin account exists in users table
    await pool.query(
      `INSERT INTO users (username, password_hash, full_name, role, department, email, is_active, must_change_password)
       VALUES ('admin', $1, 'Quản Trị Viên Hệ Thống', 'admin', 'Ban Giám Đốc', 'admin@tbrscientific.com', true, true)
       ON CONFLICT (username) DO NOTHING;`,
      [defaultPasswordHash]
    );

    // 6. One-time clean reset for personnel and duplicate users (keeping only Super Admin)
    try {
      const resetFlag = await pool.query("SELECT 1 FROM app_storage WHERE key = 'personnel_reset_done_v1'");
      if (resetFlag.rows.length === 0) {
        await pool.query(`
          DELETE FROM personnel;
          DELETE FROM users WHERE username != 'admin';
          INSERT INTO app_storage (key, data, updated_at) 
          VALUES ('personnel_reset_done_v1', '{"reset": true}'::jsonb, NOW())
          ON CONFLICT (key) DO NOTHING;
        `);
        console.log("✅ Đã làm sạch dữ liệu Nhân sự & Tài khoản người dùng cũ (giữ lại Super Admin).");
      }
    } catch (e: any) {
      console.warn("Could not check/run personnel reset migration:", e?.message);
    }

    // 7. Migration v2: Auto-clean ghost duplicate records (TBRxxx/VIAxxx) from personnel, users and zalo_user_bindings
    try {
      const cleanGhostsFlag = await pool.query("SELECT 1 FROM app_storage WHERE key = 'personnel_clean_ghosts_v2'");
      if (cleanGhostsFlag.rows.length === 0) {
        await pool.query(`
          DELETE FROM personnel 
          WHERE (employee_code ~ '^TBR[0-9]+$' OR employee_code ~ '^VIA[0-9]+$')
             OR (position = 'admin' AND employee_code != 'admin');

          DELETE FROM users 
          WHERE (username ~ '^TBR[0-9]+$' OR username ~ '^VIA[0-9]+$')
            AND username != 'admin';

          DELETE FROM zalo_user_bindings 
          WHERE employee_id ~ '^TBR[0-9]+$' 
             OR employee_id ~ '^VIA[0-9]+$'
             OR (employee_id NOT IN (SELECT employee_code FROM personnel WHERE employee_code IS NOT NULL) AND employee_id != 'admin');

          INSERT INTO app_storage (key, data, updated_at) 
          VALUES ('personnel_clean_ghosts_v2', '{"cleaned": true}'::jsonb, NOW())
          ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW();
        `);
        console.log("✅ Đã tự động dọn dẹp các bản ghi lặp lại (TBRxxx/VIAxxx) trên hệ thống.");
      }
    } catch (e: any) {
      console.warn("Could not check/run ghost cleanup migration:", e?.message);
    }

    // 7b. Automatically ensure official user accounts exist for all personnel in personnel table
    try {
      await pool.query(
        `INSERT INTO users (username, password_hash, full_name, role, department, email, is_active, must_change_password)
        SELECT 
          p.employee_code AS username,
          $1 AS password_hash,
          p.full_name,
          CASE 
            WHEN p.department = 'Ban Giám Đốc' OR LOWER(p.position) LIKE '%giám đốc%' THEN 'admin'
            WHEN p.department = 'Kế Toán' OR LOWER(p.department) LIKE '%kế toán%' THEN 
              CASE WHEN LOWER(p.position) LIKE '%trưởng%' OR LOWER(p.position) LIKE '%chief%' THEN 'accountant_head' ELSE 'accountant' END
            WHEN p.department = 'Kho Vận' OR LOWER(p.department) LIKE '%kho%' THEN 
              CASE WHEN LOWER(p.position) LIKE '%trưởng%' OR LOWER(p.position) LIKE '%phụ trách%' OR LOWER(p.position) LIKE '%manager%' THEN 'warehouse_lead' ELSE 'warehouse' END
            WHEN p.department = 'Pháp Chế' OR LOWER(p.department) LIKE '%pháp chế%' THEN 
              CASE WHEN LOWER(p.position) LIKE '%trưởng%' OR LOWER(p.position) LIKE '%head%' THEN 'legal_head' ELSE 'legal' END
            WHEN p.department = 'Mua Hàng & Cung Ứng' OR LOWER(p.department) LIKE '%cung ứng%' OR LOWER(p.department) LIKE '%mua hàng%' THEN 
              CASE WHEN LOWER(p.position) LIKE '%trưởng%' OR LOWER(p.position) LIKE '%lead%' OR LOWER(p.position) LIKE '%head%' THEN 'procurement_lead' ELSE 'procurement_specialist' END
            WHEN p.department = 'Quản Lý Chất Lượng' OR p.department = 'QA/QC' OR p.department = 'QA / QC' OR LOWER(p.department) LIKE '%chất lượng%' THEN 
              CASE WHEN LOWER(p.position) LIKE '%trưởng%' OR LOWER(p.position) LIKE '%lead%' OR LOWER(p.position) LIKE '%manager%' THEN 'qa_qc_lead' ELSE 'qa_qc' END
            WHEN p.department LIKE '%Ứng Dụng%' OR p.department LIKE '%Application%' OR p.department LIKE '%Kỹ Thuật%' THEN 
              CASE WHEN LOWER(p.position) LIKE '%trưởng%' OR LOWER(p.position) LIKE '%head%' THEN 'app_head' ELSE 'app_rep' END
            WHEN p.department = 'Kinh Doanh' OR p.department = 'Marketing' THEN 
              CASE WHEN LOWER(p.position) LIKE '%trưởng%' OR LOWER(p.position) LIKE '%phó%' OR LOWER(p.position) LIKE '%giám đốc%' THEN 'sales_head' ELSE 'sales_rep' END
            ELSE 'sales_rep'
          END AS role,
          p.department,
          p.email,
          CASE WHEN p.status = 'INACTIVE' THEN false ELSE true END AS is_active,
          true AS must_change_password
        FROM personnel p
        WHERE p.employee_code IS NOT NULL 
          AND p.employee_code != '' 
          AND p.employee_code != 'admin'
        ON CONFLICT (username) DO UPDATE SET
          full_name = EXCLUDED.full_name,
          department = EXCLUDED.department,
          email = COALESCE(EXCLUDED.email, users.email);`,
        [defaultPasswordHash]
      );
      console.log("✅ Đã đảm bảo toàn bộ nhân sự có tài khoản đăng nhập chính thức.");
    } catch (e: any) {
      console.warn("Could not sync personnel to users:", e?.message);
    }

    // 8. Architectural Solution: Optimistic Locking for app_storage
    try {
      await pool.query(`
        ALTER TABLE app_storage ADD COLUMN IF NOT EXISTS version INTEGER DEFAULT 1;
      `);
    } catch (e: any) {
      console.warn("Could not add version column to app_storage:", e?.message);
    }

    // 9. Architectural Solution: Relational table for sales_delivery_slips
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS sales_delivery_slips (
          id SERIAL PRIMARY KEY,
          slip_code VARCHAR(100) NOT NULL UNIQUE,
          order_id VARCHAR(100),
          order_code VARCHAR(100),
          customer_name VARCHAR(255),
          customer_address TEXT,
          customer_phone VARCHAR(50),
          customer_contact VARCHAR(150),
          delivery_date VARCHAR(50),
          timeliness VARCHAR(100),
          dispatch_location VARCHAR(255),
          dispatcher_name VARCHAR(150),
          dispatcher_phone VARCHAR(50),
          creator_name VARCHAR(150),
          notes TEXT,
          items JSONB DEFAULT '[]'::jsonb,
          invoice_number VARCHAR(100),
          invoice_date VARCHAR(50),
          status VARCHAR(50) DEFAULT 'COMPLETED',
          created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
        CREATE UNIQUE INDEX IF NOT EXISTS sales_delivery_slips_code_uidx ON sales_delivery_slips (slip_code);
      `);

      // Auto-migrate from app_storage if table is empty
      const slipCountRes = await pool.query(`SELECT COUNT(*) as count FROM sales_delivery_slips`);
      if (parseInt(slipCountRes.rows[0]?.count || "0") === 0) {
        const storageSlips = await pool.query(`SELECT data FROM app_storage WHERE key = 'sales_delivery_slips'`);
        if (storageSlips.rows.length > 0 && Array.isArray(storageSlips.rows[0].data)) {
          const list = storageSlips.rows[0].data;
          for (const s of list) {
            if (s && (s.id || s.slip_code || s.slipCode)) {
              const code = s.id || s.slip_code || s.slipCode;
              await pool.query(
                `INSERT INTO sales_delivery_slips (
                  slip_code, order_id, order_code, customer_name, customer_address, 
                  customer_phone, customer_contact, delivery_date, timeliness, 
                  dispatch_location, dispatcher_name, dispatcher_phone, creator_name, 
                  notes, items, invoice_number, invoice_date, status
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb, $16, $17, $18)
                ON CONFLICT (slip_code) DO NOTHING`,
                [
                  code,
                  s.orderId || s.order_id || null,
                  s.orderCode || s.order_code || null,
                  s.customerName || s.customer_name || null,
                  s.customerAddress || s.customer_address || null,
                  s.customerPhone || s.customer_phone || null,
                  s.customerContact || s.customer_contact || null,
                  s.deliveryDate || s.delivery_date || null,
                  s.timeliness || null,
                  s.dispatchLocation || s.dispatch_location || null,
                  s.dispatcherName || s.dispatcher_name || null,
                  s.dispatcherPhone || s.dispatcher_phone || null,
                  s.creatorName || s.creator_name || null,
                  s.notes || null,
                  JSON.stringify(s.items || []),
                  s.invoiceNumber || s.invoice_number || null,
                  s.invoiceDate || s.invoice_date || null,
                  s.status || "COMPLETED"
                ]
              );
            }
          }
        }
      }
    } catch (e: any) {
      console.warn("Could not ensure sales_delivery_slips table or migrate data:", e?.message);
    }

    // 10. Data-integrity migrations (Deep Code Audit): ledgers, unique codes, lots, CHECKs, chat DDL
    try {
      await runIntegrityMigrations();
    } catch (e: any) {
      console.error("Could not run integrity migrations:", e?.message);
    }

    isPersonnelEnsured = true;
  } catch (err) {
    console.error("Failed to ensure personnel table:", err);
  }
}

export async function query(text: string, params?: any[]) {
  if (!isPersonnelEnsured) {
    await ensurePersonnelTable();
  }
  const start = Date.now();
  const res = await pool.query(text, params);
  const duration = Date.now() - start;
  if (process.env.NODE_ENV === "development" && duration > 500) {
    console.log("[DB QUERY SLOW]", { text, duration, rows: res.rowCount });
  }
  return res;
}

export async function logAudit(action: string, module: string, details: string, actorUsername = "system", actorName = "Hệ Thống", ip = "127.0.0.1") {
  // Calls that do not name the actor are attributed to the signed-in user of the current request
  if (actorUsername === "system") {
    const ctx = auditActorStore.getStore();
    if (ctx) {
      actorUsername = ctx.username;
      actorName = ctx.fullName;
    }
  }
  try {
    await query(
      "INSERT INTO audit_logs (action, module, details, actor_username, actor_name, ip_address) VALUES ($1, $2, $3, $4, $5, $6)",
      [action, module, details, actorUsername, actorName, ip]
    );
  } catch (e) {
    console.error("Failed to write audit log:", e);
  }
}

export default pool;


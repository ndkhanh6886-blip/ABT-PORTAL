import type { PoolClient } from "pg";

/**
 * One-time repair of sales / procurement data written while two server bugs were live:
 *  - update_delivery_status / partial_invoice failed when the UI sent the order CODE as order_id, so the
 *    database copy of delivered / invoiced orders still says PENDING (the screens showed the right state
 *    from the app_storage copy). Delivery is rebuilt from the delivery slips table (saved correctly);
 *    invoices from the order copy in app_storage.
 *  - "Gửi PR" on the sales side created a purchase order "Hãng Sản Xuất / NCC Phân Phối" with a 0 total
 *    and selling prices. Those placeholder POs (never received, never paid) are cancelled, not deleted.
 * Price approvals and credit releases are NOT replayed (the screen copy cannot prove they happened): the
 * report lists those orders so the director / accounting can approve them again (the actions now work).
 * Everything only moves forward; a report is stored in app_storage "report_legacy_sales_sync_2026_10".
 */

const DELIVERY_LEVEL: Record<string, number> = { PENDING: 0, PROCESSING: 1, PACKED: 2, READY: 2, SHIPPED: 3, DISPATCHED: 3, PARTIALLY_DELIVERED: 3.5, DELIVERED: 4 };
const INVOICE_LEVEL: Record<string, number> = { PENDING_INVOICE: 0, PENDING: 0, PARTIALLY_INVOICED: 1, ISSUED: 2, INVOICED: 2 };

const asObj = (v: any): any => {
  if (v && typeof v === "object") return v;
  if (typeof v === "string") { try { return JSON.parse(v); } catch { return {}; } }
  return {};
};
const asArr = (v: any): any[] => {
  if (Array.isArray(v)) return v;
  if (typeof v === "string") { try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch { return []; } }
  return [];
};
/** "2026-10-17", "17/10/2026", ISO timestamps -> "YYYY-MM-DD" (null when unknown). */
const isoDate = (v: any): string | null => {
  if (!v) return null;
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return null;
};
/** Invoice numbers the old screens invented ("HD-SO26-CR-1004", "HD-2026-005", "HD-PX2610-0001"). */
const isPlaceholderInvoiceNo = (v: any) => /^HD-(SO|PX|\d{4}-)/i.test(String(v || "").trim());

export async function syncLegacySalesData(client: PoolClient) {
  const report: Record<string, any[]> = {
    delivery_updated: [], invoice_updated: [], placeholder_invoice_numbers: [],
    placeholder_pos_cancelled: [], need_price_approval_again: [], credit_blocked_check: []
  };

  await client.query("BEGIN");
  try {
    const orders = (await client.query(
      "SELECT id, order_code, items, delivery_status, delivered_at, invoice_no, invoice_status, invoice_date, price_approval_status, is_credit_blocked, approval_status FROM sales_orders FOR UPDATE"
    )).rows;
    const slips = (await client.query("SELECT slip_code, order_code, items, delivery_date, status, extra_data, invoice_number FROM sales_delivery_slips")).rows;
    const blobRow = (await client.query("SELECT data FROM app_storage WHERE key = 'sales_factory_orders'")).rows[0];
    const blob = asArr(blobRow?.data);
    const blobByCode = new Map<string, any>();
    for (const fo of blob) {
      for (const k of [fo?.order_code, fo?.id, fo?.linkedSalesOrderId]) if (k) blobByCode.set(String(k), fo);
    }

    for (const o of orders) {
      const code = String(o.order_code || "");
      const fo = blobByCode.get(code) || null;

      // ---- delivery from the slips table
      const mine = slips.filter((s: any) => String(s.order_code || "") === code).map((s: any) => ({ ...s, ex: asObj(s.extra_data) }))
        .filter((s: any) => String(s.ex.deliveryStatus || "").toUpperCase() !== "CANCELLED" && String(s.status || "").toUpperCase() !== "CANCELLED");
      let target: string | null = null;
      let deliveredAt: string | null = null;
      if (mine.length > 0) {
        const delivered = mine.filter((s: any) => s.ex.isDelivered === true || s.ex.isDelivered === "true" || String(s.ex.deliveryStatus || "").toUpperCase() === "DELIVERED");
        if (delivered.length === 0) {
          target = "SHIPPED";
        } else {
          const need: Record<string, number> = {};
          for (const it of asArr(o.items)) {
            if (it?.status === "CANCELLED") continue;
            const c = String(it?.productCode || it?.product_code || "");
            if (c) need[c] = (need[c] || 0) + (Number(it.quantity) || 0);
          }
          const got: Record<string, number> = {};
          for (const s of delivered) for (const it of asArr(s.items)) {
            const c = String(it?.productCode || it?.product_code || "");
            if (c) got[c] = (got[c] || 0) + (Number(it.quantity) || 0);
          }
          const full = Object.keys(need).length > 0 && Object.entries(need).every(([c, q]) => (got[c] || 0) >= q);
          target = full ? "DELIVERED" : "PARTIALLY_DELIVERED";
          const dates = delivered.map((s: any) => isoDate(s.ex.deliveredAt) || isoDate(s.delivery_date)).filter(Boolean) as string[];
          deliveredAt = dates.sort()[0] || null;
        }
      } else if (fo && (fo.status === "Delivered" || fo.status === "COMPLETED") ) {
        // older orders delivered without slips
        target = "DELIVERED";
        deliveredAt = isoDate(fo.deliveredAt);
      }
      const curLvl = DELIVERY_LEVEL[String(o.delivery_status || "").toUpperCase()] ?? 0;
      if (target && (DELIVERY_LEVEL[target] ?? 0) > curLvl) {
        await client.query(
          "UPDATE sales_orders SET delivery_status = $1, delivered_at = COALESCE(delivered_at, $2::date) WHERE id = $3",
          [target, ["DELIVERED", "PARTIALLY_DELIVERED"].includes(target) ? deliveredAt : null, o.id]
        );
        report.delivery_updated.push({ order_code: code, from: o.delivery_status, to: target, delivered_at: deliveredAt });
      } else if (!o.delivered_at && deliveredAt && curLvl >= 3.5) {
        await client.query("UPDATE sales_orders SET delivered_at = $1::date WHERE id = $2", [deliveredAt, o.id]);
      }

      // ---- invoice from the order copy (real numbers only)
      const invLvl = INVOICE_LEVEL[String(o.invoice_status || "").toUpperCase()] ?? 0;
      const blobInvNo = String(fo?.invoiceNo || fo?.invoice_no || "").trim();
      const slipInvNo = String(mine.map((s: any) => s.invoice_number || s.ex.invoiceNo).find((x: any) => x) || "").trim();
      const invNo = blobInvNo || slipInvNo;
      const blobInvStatus = String(fo?.invoiceStatus || fo?.invoice_status || "").toUpperCase();
      if (!o.invoice_no && invLvl === 0 && invNo) {
        if (isPlaceholderInvoiceNo(invNo)) {
          report.placeholder_invoice_numbers.push({ order_code: code, invoice_no: invNo });
        } else if (blobInvStatus === "ISSUED" || blobInvStatus === "INVOICED" || blobInvStatus === "PARTIALLY_INVOICED" || slipInvNo) {
          const st = blobInvStatus === "PARTIALLY_INVOICED" ? "PARTIALLY_INVOICED" : "ISSUED";
          const invDate = isoDate(fo?.invoiceDate) || isoDate(fo?.invoice_date) || deliveredAt;
          const invSlips = asArr(fo?.invoiced_delivery_slips || fo?.invoicedDeliverySlips);
          await client.query(
            `UPDATE sales_orders SET invoice_no = $1, invoice_status = $2, invoice_date = COALESCE(invoice_date, $3::date),
                    invoiced_delivery_slips = CASE WHEN jsonb_array_length(COALESCE(invoiced_delivery_slips, '[]'::jsonb)) = 0 THEN $4::jsonb ELSE invoiced_delivery_slips END
              WHERE id = $5`,
            [invNo, st, invDate, JSON.stringify(invSlips), o.id]
          );
          report.invoice_updated.push({ order_code: code, invoice_no: invNo, status: st });
        }
      }

      // ---- approvals that may have been lost: listed, not replayed
      if (o.price_approval_status === "PENDING_APPROVAL" && String(fo?.priceApprovalStatus || "").toUpperCase() === "APPROVED") {
        report.need_price_approval_again.push({ order_code: code });
      }
      if (o.is_credit_blocked === true && (DELIVERY_LEVEL[target || String(o.delivery_status || "").toUpperCase()] ?? 0) < 4) {
        report.credit_blocked_check.push({ order_code: code });
      }
    }

    // ---- placeholder POs created by the sales screen: cancel (never received / paid), unlink from the orders
    const fake = (await client.query(
      `SELECT id, po_code FROM procurement_orders
        WHERE (supplier_name = 'Hãng Sản Xuất / NCC Phân Phối' OR po_code LIKE 'SO%')
          AND COALESCE(total_amount, 0) = 0 AND COALESCE(amount_paid, 0) = 0
          AND inbound_transaction_code IS NULL AND status NOT IN ('COMPLETED', 'CANCELLED', 'PARTIALLY_RECEIVED')
        FOR UPDATE`
    )).rows;
    for (const po of fake) {
      await client.query(
        "UPDATE procurement_orders SET status = 'CANCELLED', notes = COALESCE(notes, '') || ' • [Tự động huỷ: PO tạm do màn hình Kinh doanh tạo khi gửi PR — PO thật do Cung ứng lập]' WHERE id = $1",
        [po.id]
      );
      await client.query(
        "UPDATE sales_orders SET procure_order_code = NULL, procure_status = CASE WHEN pr_code IS NOT NULL THEN 'PR_PENDING' ELSE procure_status END WHERE procure_order_code = $1",
        [po.po_code]
      );
      report.placeholder_pos_cancelled.push({ po_code: po.po_code });
    }

    await client.query(
      `INSERT INTO app_storage (key, data, updated_at) VALUES ('report_legacy_sales_sync_2026_10', $1::jsonb, NOW())
       ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
      [JSON.stringify({ ran_at: new Date().toISOString(), ...report })]
    );
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw e;
  }
  return report;
}

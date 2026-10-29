import type { Tx } from "../core/db";

export interface BalanceMismatch {
  item_id: string;
  lot_id: string | null;
  container_id: string | null;
  location_id: string;
  balance_qty: string;
  ledger_qty: string;
}

/**
 * Nightly check: every balance must equal the sum of its ledger rows, and every reservation total
 * must match `qty_reserved`. Reports differences only; it never "fixes" a number (that would hide the
 * bug that caused it). Any mismatch is raised to the warehouse lead.
 */
export async function findBalanceMismatches(tx: Tx): Promise<BalanceMismatch[]> {
  const res = await tx.query(`
    WITH ledger AS (
      SELECT item_id, lot_id, container_id, location_id, sum(qty_delta_base) AS qty
        FROM inv.stock_ledger GROUP BY item_id, lot_id, container_id, location_id
    )
    SELECT coalesce(b.item_id, l.item_id) AS item_id, coalesce(b.lot_id, l.lot_id) AS lot_id,
           coalesce(b.container_id, l.container_id) AS container_id, coalesce(b.location_id, l.location_id) AS location_id,
           coalesce(b.qty_on_hand, 0)::text AS balance_qty, coalesce(l.qty, 0)::text AS ledger_qty
      FROM inv.stock_balance b
      FULL JOIN ledger l ON l.item_id = b.item_id AND l.lot_id IS NOT DISTINCT FROM b.lot_id
                        AND l.container_id IS NOT DISTINCT FROM b.container_id AND l.location_id = b.location_id
     WHERE coalesce(b.qty_on_hand, 0) <> coalesce(l.qty, 0)`);
  return res.rows;
}

export async function findReservationMismatches(tx: Tx): Promise<{ balance_id: string; qty_reserved: string; active_reserved: string }[]> {
  const res = await tx.query(`
    SELECT b.id AS balance_id, b.qty_reserved::text AS qty_reserved, coalesce(sum(r.qty_base - r.qty_consumed), 0)::text AS active_reserved
      FROM inv.stock_balance b
      LEFT JOIN inv.reservation r ON r.balance_id = b.id AND r.status = 'ACTIVE'
     GROUP BY b.id HAVING b.qty_reserved <> coalesce(sum(r.qty_base - r.qty_consumed), 0)`);
  return res.rows;
}

import type { Tx } from "../core/db";
import { vnToday } from "../core/dates";

/** A stock balance that may be allocated: released lot, still within its effective expiry. */
export interface Candidate {
  balance_id: string;
  item_id: string;
  lot_id: string | null;
  lot_code: string | null;
  container_id: string | null;
  location_id: string;
  available: number;
  expiry_date: string | null; // effective: min(lot expiry, container in-use expiry)
  received_date: string | null;
}

export interface Pick {
  candidate: Candidate;
  qty: number;
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

/** FEFO, then FIFO: earliest expiry first (no expiry last), then earliest received, then lot code. */
export function sortFefo(candidates: Candidate[]): Candidate[] {
  return [...candidates].sort((a, b) => {
    if (a.expiry_date !== b.expiry_date) {
      if (a.expiry_date == null) return 1;
      if (b.expiry_date == null) return -1;
      return a.expiry_date < b.expiry_date ? -1 : 1;
    }
    if (a.received_date !== b.received_date) return (a.received_date ?? "") < (b.received_date ?? "") ? -1 : 1;
    if (a.lot_code !== b.lot_code) return (a.lot_code ?? "") < (b.lot_code ?? "") ? -1 : 1;
    return a.balance_id < b.balance_id ? -1 : 1;
  });
}

/** Greedy FEFO/FIFO allocation of `qty` (base unit). Pure: never touches the database. */
export function allocate(candidates: Candidate[], qty: number): { picks: Pick[]; shortfall: number } {
  if (!(qty > 0)) throw new Error("Số lượng cần phân bổ phải lớn hơn 0");
  const picks: Pick[] = [];
  let remaining = qty;
  for (const c of sortFefo(candidates)) {
    if (remaining <= 0) break;
    if (!(c.available > 0)) continue;
    const take = round6(Math.min(c.available, remaining));
    picks.push({ candidate: c, qty: take });
    remaining = round6(remaining - take);
  }
  return { picks, shortfall: Math.max(0, remaining) };
}

/**
 * Allocatable balances of an item in the given warehouses. With `lock`, the balance rows are
 * locked FOR UPDATE in key order (fixed order → no deadlock between concurrent reservations).
 */
export async function findCandidates(
  tx: Tx,
  itemId: string,
  warehouseIds: string[],
  opts: { lock?: boolean; today?: string } = {}
): Promise<Candidate[]> {
  const today = opts.today ?? vnToday();
  // Tự động khôi phục các lô của vật tư này đang mang trạng thái EXPIRED nhưng hạn dùng đã được cập nhật còn hạn (>= today) sang RELEASED
  await tx.query(
    `UPDATE inv.lot
        SET status = 'RELEASED',
            version = version + 1,
            updated_at = now()
      WHERE item_id = $1
        AND status = 'EXPIRED'
        AND (expiry_date IS NULL OR expiry_date >= $2::date)`,
    [itemId, today]
  );
  await tx.query(
    `UPDATE inv.container c
        SET status = CASE WHEN c.status = 'EXPIRED' THEN 'AVAILABLE' ELSE c.status END,
            open_expiry_date = CASE
              WHEN c.open_expiry_date IS NOT NULL AND c.open_expiry_date < $2::date THEN l.expiry_date
              ELSE c.open_expiry_date
            END,
            version = c.version + 1,
            updated_at = now()
       FROM inv.lot l
      WHERE c.lot_id = l.id
        AND l.item_id = $1
        AND (l.expiry_date IS NULL OR l.expiry_date >= $2::date)
        AND (c.status = 'EXPIRED' OR (c.open_expiry_date IS NOT NULL AND c.open_expiry_date < $2::date))`,
    [itemId, today]
  );
  // Auto-heal: if a lot is already RELEASED (e.g. QC passed on preparation or lot screen)
  // but its stock_balance row is still sitting in a quarantine location (loc.is_quarantine = true),
  // move that balance onto the warehouse's active non-quarantine shelf (A1) so FEFO allocation can use it.
  const strandedRows = (
    await tx.query(
      `SELECT b.id AS q_bal_id,
              b.item_id,
              b.lot_id,
              b.container_id,
              b.location_id AS q_loc_id,
              b.qty_on_hand::text AS q_on_hand,
              b.qty_reserved::text AS q_reserved,
              loc.warehouse_id,
              (
                SELECT s.id
                  FROM master.location s
                 WHERE s.warehouse_id = loc.warehouse_id
                   AND s.status = 'ACTIVE'
                   AND NOT s.is_quarantine
                 ORDER BY CASE WHEN s.code = 'A1' THEN 0 ELSE 1 END, s.code
                 LIMIT 1
              ) AS target_loc_id
         FROM inv.stock_balance b
         JOIN master.location loc ON loc.id = b.location_id AND loc.is_quarantine AND loc.status = 'ACTIVE'
         JOIN inv.lot l ON l.id = b.lot_id AND l.status = 'RELEASED'
        WHERE b.item_id = $1
          AND loc.warehouse_id = ANY($2::uuid[])
          AND b.qty_on_hand > 0
          AND (l.expiry_date IS NULL OR l.expiry_date >= $3)
        FOR UPDATE OF b`,
      [itemId, warehouseIds, today]
    )
  ).rows;

  for (const sr of strandedRows) {
    if (!sr.target_loc_id) continue;
    await tx.query(
      `INSERT INTO inv.stock_balance (item_id, lot_id, container_id, location_id, qty_on_hand, qty_reserved)
       VALUES ($1, $2, $3, $4, $5::numeric, $6::numeric)
       ON CONFLICT (item_id, lot_id, container_id, location_id) DO UPDATE
         SET qty_on_hand = inv.stock_balance.qty_on_hand + EXCLUDED.qty_on_hand,
             qty_reserved = inv.stock_balance.qty_reserved + EXCLUDED.qty_reserved,
             updated_at = now()`,
      [sr.item_id, sr.lot_id, sr.container_id, sr.target_loc_id, sr.q_on_hand, sr.q_reserved]
    );
    await tx.query(
      "UPDATE inv.stock_balance SET qty_on_hand = 0, qty_reserved = 0, updated_at = now() WHERE id = $1",
      [sr.q_bal_id]
    );
    await tx.query(
      "UPDATE prep.preparation SET to_location_id = $2 WHERE lot_id = $1 AND (to_location_id IS NULL OR to_location_id = $3)",
      [sr.lot_id, sr.target_loc_id, sr.q_loc_id]
    );
  }
  const res = await tx.query(
    `SELECT b.id AS balance_id, b.item_id, b.lot_id, l.code AS lot_code, b.container_id, b.location_id,
            (b.qty_on_hand - b.qty_reserved)::text AS available,
            CASE WHEN c.open_expiry_date IS NOT NULL AND (l.expiry_date IS NULL OR c.open_expiry_date < l.expiry_date)
                 THEN c.open_expiry_date ELSE l.expiry_date END AS expiry_date,
            l.received_date
       FROM inv.stock_balance b
       JOIN master.location loc ON loc.id = b.location_id AND NOT loc.is_quarantine AND loc.status = 'ACTIVE'
       JOIN master.item i ON i.id = b.item_id
       LEFT JOIN inv.lot l ON l.id = b.lot_id
       LEFT JOIN inv.container c ON c.id = b.container_id
      WHERE b.item_id = $1 AND loc.warehouse_id = ANY($2::uuid[])
        AND b.qty_on_hand - b.qty_reserved > 0
        AND (i.tracking = 'NONE' OR (l.status = 'RELEASED' AND (l.expiry_date IS NULL OR l.expiry_date >= $3)))
        AND (b.container_id IS NULL OR (c.status IN ('AVAILABLE', 'IN_USE') AND (c.open_expiry_date IS NULL OR c.open_expiry_date >= $3)))
      ORDER BY b.item_id, b.lot_id, b.container_id, b.location_id
      ${opts.lock ? "FOR UPDATE OF b" : ""}`,
    [itemId, warehouseIds, today]
  );
  return res.rows.map((r) => ({ ...r, available: Number(r.available) }));
}

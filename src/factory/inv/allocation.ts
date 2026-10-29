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

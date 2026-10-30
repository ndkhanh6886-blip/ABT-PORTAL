import type { Tx } from "../core/db";
import type { AuthzActor } from "../core/authz";
import { writeAudit } from "../core/audit";
import { FactoryError, invalid } from "../core/errors";
import { allocate, findCandidates, type Pick } from "./allocation";

export type DemandType = "PRODUCTION_ORDER" | "SYNTHESIS_BATCH" | "EXPERIMENT" | "DEVICE_WO" | "DELIVERY" | "PREPARATION" | "OTHER";

export interface ReserveRequest {
  item_id: string;
  qty_base: number;
  warehouse_ids: string[];
  demand_entity_type: DemandType;
  demand_entity_id: string;
  /** Module asking (e.g. 'KIT'): only substitutes allowed for it are considered. */
  module?: string;
  allow_substitutes?: boolean;
}

export interface ReservationResult {
  reservation_id: string;
  item_id: string;
  lot_id: string | null;
  location_id: string;
  qty_base: number;
  substitute_for?: string;
}

/**
 * Reserves stock by FEFO → FIFO, all or nothing. Candidate balances are locked in key order, so
 * two reservations racing for the last stock cannot both succeed. When the item itself is short and
 * substitutes are allowed, approved substitutes are used by priority (quantity × ratio).
 * Module-internal: the calling module authorises its own business action.
 */
export async function reserve(tx: Tx, actor: AuthzActor, req: ReserveRequest): Promise<ReservationResult[]> {
  if (!req.warehouse_ids.length) throw invalid("Chưa chọn kho để giữ chỗ.");
  const own = allocate(await findCandidates(tx, req.item_id, req.warehouse_ids, { lock: true }), req.qty_base);
  const plan: { picks: Pick[]; substituteFor?: string }[] = [{ picks: own.picks }];
  let shortfall = own.shortfall;

  if (shortfall > 0 && req.allow_substitutes) {
    const subs = await tx.query(
      `SELECT substitute_item_id, ratio FROM master.item_substitute
        WHERE item_id = $1 AND status = 'ACTIVE' AND change_request_id IS NOT NULL
          AND (cardinality(allowed_modules) = 0 OR $2 = ANY(allowed_modules))
        ORDER BY priority, substitute_item_id`,
      [req.item_id, req.module ?? ""]
    );
    for (const s of subs.rows) {
      if (shortfall <= 0) break;
      const ratio = Number(s.ratio);
      const sub = allocate(await findCandidates(tx, s.substitute_item_id, req.warehouse_ids, { lock: true }), shortfall * ratio);
      plan.push({ picks: sub.picks, substituteFor: req.item_id });
      shortfall = sub.shortfall / ratio;
    }
  }
  if (shortfall > 1e-9) {
    const item = (await tx.query("SELECT code, base_uom FROM master.item WHERE id = $1", [req.item_id])).rows[0];
    throw new FactoryError(
      422,
      "INSUFFICIENT_STOCK",
      `Không đủ tồn khả dụng cho ${item?.code}: còn thiếu ${Number(shortfall.toFixed(6))} ${item?.base_uom}. Chỉ tính lô đã giải phóng, còn hạn, ngoài khu biệt trữ.`,
      { item_id: req.item_id, shortfall }
    );
  }

  const results: ReservationResult[] = [];
  for (const { picks, substituteFor } of plan) {
    for (const p of picks) {
      await tx.query("UPDATE inv.stock_balance SET qty_reserved = qty_reserved + $2, updated_at = now() WHERE id = $1", [
        p.candidate.balance_id,
        p.qty,
      ]);
      const r = await tx.query(
        `INSERT INTO inv.reservation (balance_id, item_id, lot_id, location_id, qty_base, demand_entity_type, demand_entity_id, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8) RETURNING id`,
        [p.candidate.balance_id, p.candidate.item_id, p.candidate.lot_id, p.candidate.location_id, p.qty, req.demand_entity_type, req.demand_entity_id, actor.userId]
      );
      results.push({
        reservation_id: r.rows[0].id,
        item_id: p.candidate.item_id,
        lot_id: p.candidate.lot_id,
        location_id: p.candidate.location_id,
        qty_base: p.qty,
        substitute_for: substituteFor,
      });
      await writeAudit(tx, actor, {
        entityType: "reservation",
        entityId: r.rows[0].id,
        action: "create",
        changes: { qty_base: [null, p.qty], lot_id: [null, p.candidate.lot_id], demand: [null, `${req.demand_entity_type}:${req.demand_entity_id}`] },
      });
    }
  }
  return results;
}

async function releaseWhere(tx: Tx, actor: AuthzActor, where: string, params: unknown[], reason: string): Promise<number> {
  const rows = (
    await tx.query(
      `SELECT r.id, r.balance_id, (r.qty_base - r.qty_consumed)::text AS remaining FROM inv.reservation r
        WHERE r.status = 'ACTIVE' AND ${where} ORDER BY r.balance_id, r.id FOR UPDATE`,
      params
    )
  ).rows;
  for (const r of rows) {
    await tx.query("UPDATE inv.stock_balance SET qty_reserved = qty_reserved - $2::numeric, updated_at = now() WHERE id = $1", [r.balance_id, r.remaining]);
    await tx.query("UPDATE inv.reservation SET status = 'RELEASED', version = version + 1, updated_at = now(), updated_by = $2 WHERE id = $1", [
      r.id,
      actor.userId,
    ]);
    await writeAudit(tx, actor, { entityType: "reservation", entityId: r.id, action: "release", changes: { status: ["ACTIVE", "RELEASED"] }, reason });
  }
  return rows.length;
}

/** Frees every active reservation of a demand (order cancelled, batch cancelled…). */
export function releaseDemandReservations(tx: Tx, actor: AuthzActor, demandType: DemandType, demandId: string, reason = "Hủy nhu cầu"): Promise<number> {
  return releaseWhere(tx, actor, "r.demand_entity_type = $1 AND r.demand_entity_id = $2", [demandType, demandId], reason);
}

/** Frees every active reservation on a lot (lot put on hold or expired). */
export async function releaseLotReservations(tx: Tx, actor: AuthzActor, lotId: string): Promise<void> {
  await releaseWhere(tx, actor, "r.lot_id = $1", [lotId], "Lô bị tạm giữ / hết hạn");
}

/**
 * Reserves `qty_base` of one specific lot (e.g. the CPG column chosen for a position), from released,
 * unexpired stock outside quarantine in the given warehouses. Balances are locked in key order.
 */
export async function reserveLot(
  tx: Tx,
  actor: AuthzActor,
  req: { lot_id: string; qty_base: number; warehouse_ids: string[]; demand_entity_type: DemandType; demand_entity_id: string }
): Promise<ReservationResult[]> {
  const lot = (await tx.query("SELECT item_id, code FROM inv.lot WHERE id = $1", [req.lot_id])).rows[0];
  if (!lot) throw invalid("Lô không tồn tại.");
  const candidates = (await findCandidates(tx, lot.item_id, req.warehouse_ids, { lock: true })).filter((c) => c.lot_id === req.lot_id);
  const plan = allocate(candidates, req.qty_base);
  if (plan.shortfall > 1e-9) {
    throw new FactoryError(422, "INSUFFICIENT_STOCK", `Lô ${lot.code} không đủ tồn khả dụng (đã giải phóng, còn hạn, ngoài biệt trữ).`, { lot_id: req.lot_id });
  }
  const results: ReservationResult[] = [];
  for (const p of plan.picks) {
    await tx.query("UPDATE inv.stock_balance SET qty_reserved = qty_reserved + $2, updated_at = now() WHERE id = $1", [p.candidate.balance_id, p.qty]);
    const r = await tx.query(
      `INSERT INTO inv.reservation (balance_id, item_id, lot_id, location_id, qty_base, demand_entity_type, demand_entity_id, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8) RETURNING id`,
      [p.candidate.balance_id, p.candidate.item_id, p.candidate.lot_id, p.candidate.location_id, p.qty, req.demand_entity_type, req.demand_entity_id, actor.userId]
    );
    results.push({ reservation_id: r.rows[0].id, item_id: p.candidate.item_id, lot_id: p.candidate.lot_id, location_id: p.candidate.location_id, qty_base: p.qty });
  }
  return results;
}

/** Frees what one demand holds on one lot (e.g. a batch whose bottle on the synthesizer was changed before the run). */
export function releaseDemandLotReservations(tx: Tx, actor: AuthzActor, demandType: DemandType, demandId: string, lotId: string, reason: string): Promise<number> {
  return releaseWhere(tx, actor, "r.demand_entity_type = $1 AND r.demand_entity_id = $2 AND r.lot_id = $3", [demandType, demandId, lotId], reason);
}

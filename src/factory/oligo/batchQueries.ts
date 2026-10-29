import { z } from "zod";
import type { Tx } from "../core/db";
import { writeAudit } from "../core/audit";
import { authorize, type AuthzActor } from "../core/authz";
import { notFound } from "../core/errors";
import { parseInput } from "../core/records";
import { listAllowedActions } from "../core/stateMachine";
import { batchMachine } from "./batches";
import { visibleOligoUnits } from "./orders";

export async function listReagentRules(tx: Tx, actor: AuthzActor) {
  await authorize(tx, actor, "oligo.view");
  return (
    await tx.query(
      `SELECT r.role, r.name, r.basis, r.qty::float AS qty, r.uom, r.item_id, r.status, r.version, i.code AS item_code, i.name AS item_name, i.base_uom
         FROM oligo.reagent_rule r LEFT JOIN master.item i ON i.id = r.item_id
        ORDER BY array_position(ARRAY['PER_CYCLE','PER_COUPLING','PER_MOD'], r.basis), r.role`
    )
  ).rows;
}

const ruleSchema = z.object({
  version: z.number().int().min(0),
  reason: z.string().trim().min(3, "nhập lý do thay đổi định mức"),
  qty: z.coerce.number().min(0).optional(),
  uom: z.string().min(1).optional(),
  item_id: z.string().uuid().nullable().optional(),
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
});

/** Consumption rules drive reservations and issues of every later batch: audited with a reason. */
export async function updateReagentRule(tx: Tx, actor: AuthzActor, role: string, input: unknown) {
  await authorize(tx, actor, "oligo.reagent.manage");
  const data = parseInput(ruleSchema, input);
  const cur = (await tx.query("SELECT * FROM oligo.reagent_rule WHERE role = $1 FOR UPDATE", [role])).rows[0];
  if (!cur) throw notFound("định mức");
  if (cur.version !== data.version) throw notFound("định mức (vừa bị sửa — tải lại)");
  const next = { qty: data.qty ?? Number(cur.qty), uom: data.uom ?? cur.uom, item_id: data.item_id === undefined ? cur.item_id : data.item_id, status: data.status ?? cur.status };
  await tx.query("UPDATE oligo.reagent_rule SET qty = $2, uom = $3, item_id = $4, status = $5, version = version + 1, updated_at = now(), updated_by = $6 WHERE role = $1", [
    role, next.qty, next.uom, next.item_id, next.status, actor.userId,
  ]);
  const changes: Record<string, [unknown, unknown]> = {};
  if (Number(cur.qty) !== next.qty) changes.qty = [Number(cur.qty), next.qty];
  for (const k of ["uom", "item_id", "status"] as const) if (cur[k] !== next[k]) changes[k] = [cur[k], next[k]];
  await writeAudit(tx, actor, { entityType: "oligo_reagent_rule", entityId: role, action: "update", changes, reason: data.reason });
}

export async function listBatches(tx: Tx, actor: AuthzActor, status?: string) {
  const units = await visibleOligoUnits(tx, actor);
  if (units !== "ALL" && !units.length) return [];
  return (
    await tx.query(
      `SELECT b.id, b.code, b.status, b.program_name, b.planned_start, b.started_at, b.finished_at, b.created_at, a.code AS synthesizer_code, a.name AS synthesizer_name,
              (SELECT count(*)::int FROM oligo.synthesis_position p WHERE p.batch_id = b.id) AS position_count
         FROM oligo.synthesis_batch b JOIN asset.asset a ON a.id = b.synthesizer_id
        WHERE ($1::uuid[] IS NULL OR b.org_unit_id = ANY($1::uuid[])) AND ($2::text IS NULL OR b.status = $2)
        ORDER BY b.created_at DESC LIMIT 200`,
      [units === "ALL" ? null : units, status ?? null]
    )
  ).rows;
}

export async function getBatch(tx: Tx, actor: AuthzActor, id: string) {
  const b = (
    await tx.query("SELECT b.*, a.code AS synthesizer_code, a.name AS synthesizer_name FROM oligo.synthesis_batch b JOIN asset.asset a ON a.id = b.synthesizer_id WHERE b.id = $1", [id])
  ).rows[0];
  if (!b) throw notFound("mẻ tổng hợp");
  const units = await visibleOligoUnits(tx, actor);
  if (units !== "ALL" && !units.includes(b.org_unit_id)) throw notFound("mẻ tổng hợp");
  const positions = (
    await tx.query(
      `SELECT p.position_no, p.couplings, p.coupling_efficiency_pct::float AS coupling_efficiency_pct, p.result, s.id AS sequence_id, s.code AS sequence_code, s.name,
              s.normalized_sequence, s.scale_code, s.status AS sequence_status, l.code AS column_lot_code
         FROM oligo.synthesis_position p JOIN oligo.oligo_sequence s ON s.id = p.sequence_id JOIN inv.lot l ON l.id = p.column_lot_id
        WHERE p.batch_id = $1 ORDER BY p.position_no`,
      [id]
    )
  ).rows;
  const reagents = (
    await tx.query(
      `SELECT u.item_id, u.role, u.est_qty_base::float AS est_qty_base, u.actual_qty_base::float AS actual_qty_base, i.code AS item_code, i.name AS item_name, i.base_uom
         FROM oligo.synthesis_reagent_use u JOIN master.item i ON i.id = u.item_id WHERE u.batch_id = $1 ORDER BY i.code`,
      [id]
    )
  ).rows;
  return { ...b, positions, reagents, actions: await listAllowedActions(tx, batchMachine, actor, b) };
}

/**
 * What a batch can be planned from: pending sequences (split parents and pooled members are not PENDING,
 * their tubes / pool master go instead), the unit's synthesizers and the consumable lots usable as columns.
 */
export async function batchCandidates(tx: Tx, actor: AuthzActor, orgUnitId: string) {
  await authorize(tx, actor, "oligo.batch.manage", orgUnitId);
  const sequences = (
    await tx.query(
      `SELECT s.id, s.code, s.name, s.normalized_sequence, s.base_count, s.scale_code, s.purification, s.relation, o.code AS order_code, o.due_date
         FROM oligo.oligo_sequence s LEFT JOIN oligo.oligo_order o ON o.id = s.order_id
        WHERE s.org_unit_id = $1 AND s.status = 'PENDING'
        ORDER BY o.due_date NULLS LAST, s.code LIMIT 500`,
      [orgUnitId]
    )
  ).rows;
  const synthesizers = (
    await tx.query(
      `SELECT a.id, a.code, a.name, a.status, a.next_calibration_due, s.column_positions, s.supported_scales
         FROM oligo.synthesizer s JOIN asset.asset a ON a.id = s.asset_id WHERE a.owner_org_unit_id = $1 AND a.status <> 'RETIRED' ORDER BY a.code`,
      [orgUnitId]
    )
  ).rows;
  const column_lots = (
    await tx.query(
      `SELECT l.id, l.code, l.expiry_date, i.code AS item_code, i.name AS item_name, sum(b.qty_on_hand - b.qty_reserved)::float AS available
         FROM inv.stock_balance b JOIN inv.lot l ON l.id = b.lot_id JOIN master.item i ON i.id = b.item_id
         JOIN master.location loc ON loc.id = b.location_id JOIN master.warehouse w ON w.id = loc.warehouse_id
        WHERE w.owner_org_unit_id = $1 AND w.status = 'ACTIVE' AND NOT loc.is_quarantine AND i.item_type = 'CONSUMABLE'
          AND l.status = 'RELEASED' AND (l.expiry_date IS NULL OR l.expiry_date >= current_date)
        GROUP BY l.id, i.id HAVING sum(b.qty_on_hand - b.qty_reserved) >= 1 ORDER BY i.code, l.expiry_date NULLS LAST`,
      [orgUnitId]
    )
  ).rows;
  return { sequences, synthesizers, column_lots };
}

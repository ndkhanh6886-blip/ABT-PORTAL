import { z } from "zod";
import type { Tx } from "../core/db";
import { writeAudit } from "../core/audit";
import { authorize, authorizeAnywhere, type AuthzActor } from "../core/authz";
import { invalid, notFound } from "../core/errors";
import { parseInput } from "../core/records";
import { listAllowedActions } from "../core/stateMachine";
import { batchMachine } from "./batches";
import { visibleOligoUnits } from "./orders";

export async function listReagentRules(tx: Tx, actor: AuthzActor) {
  await authorize(tx, actor, "oligo.view");
  return (
    await tx.query(
      `SELECT r.role, r.name, r.display_name, r.is_visible, r.basis, r.qty::float AS qty, r.uom, r.item_id, r.status, r.version, i.code AS item_code, i.name AS item_name, i.base_uom
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
  display_name: z.string().trim().max(100).nullable().optional(),
  is_visible: z.boolean().optional(),
});

/** Consumption rules drive reservations and issues of every later batch: audited with a reason. */
export async function updateReagentRule(tx: Tx, actor: AuthzActor, role: string, input: unknown) {
  await authorizeAnywhere(tx, actor, "oligo.reagent.manage");
  const data = parseInput(ruleSchema, input);
  const cur = (await tx.query("SELECT * FROM oligo.reagent_rule WHERE role = $1 FOR UPDATE", [role])).rows[0];
  if (!cur) throw notFound("định mức");
  if (cur.version !== data.version) throw notFound("định mức (vừa bị sửa — tải lại)");
  const next = {
    qty: data.qty ?? Number(cur.qty), uom: data.uom ?? cur.uom, item_id: data.item_id === undefined ? cur.item_id : data.item_id, status: data.status ?? cur.status,
    display_name: data.display_name === undefined ? cur.display_name : data.display_name || null, is_visible: data.is_visible ?? cur.is_visible,
  };
  await tx.query("UPDATE oligo.reagent_rule SET qty = $2, uom = $3, item_id = $4, status = $5, display_name = $7, is_visible = $8, version = version + 1, updated_at = now(), updated_by = $6 WHERE role = $1", [
    role, next.qty, next.uom, next.item_id, next.status, actor.userId, next.display_name, next.is_visible,
  ]);
  const changes: Record<string, [unknown, unknown]> = {};
  if (Number(cur.qty) !== next.qty) changes.qty = [Number(cur.qty), next.qty];
  for (const k of ["uom", "item_id", "status", "display_name", "is_visible"] as const) if (cur[k] !== next[k]) changes[k] = [cur[k], next[k]];
  await writeAudit(tx, actor, { entityType: "oligo_reagent_rule", entityId: role, action: "update", changes, reason: data.reason });
}

const newRuleSchema = z.object({
  role: z.string().trim().regex(/^[A-Za-z0-9_+-]{2,40}$/, "mã vai trò: chữ, số, _ - +, 2–40 ký tự"),
  name: z.string().trim().min(1).max(100),
  basis: z.enum(["PER_CYCLE", "PER_COUPLING", "PER_MOD"]),
  qty: z.coerce.number().min(0),
  uom: z.string().min(1),
  item_id: z.string().uuid().nullable().optional(),
});

/**
 * A role of one's own (as OligoFlow): PER_CYCLE is used every coupling; a PER_MOD / PER_COUPLING role named
 * like a modification code (e.g. FAM) is that modification's own amidite rule instead of MOD_DEFAULT.
 */
export async function createReagentRule(tx: Tx, actor: AuthzActor, input: unknown) {
  await authorizeAnywhere(tx, actor, "oligo.reagent.manage");
  const d = parseInput(newRuleSchema, input);
  if ((await tx.query("SELECT 1 FROM oligo.reagent_rule WHERE role = $1", [d.role])).rowCount) throw invalid(`Đã có vai trò ${d.role}.`);
  await tx.query("INSERT INTO oligo.reagent_rule (role, name, basis, qty, uom, item_id, updated_by) VALUES ($1, $2, $3, $4, $5, $6, $7)", [
    d.role, d.name, d.basis, d.qty, d.uom, d.item_id ?? null, actor.userId,
  ]);
  await writeAudit(tx, actor, { entityType: "oligo_reagent_rule", entityId: d.role, action: "create", changes: { role: [null, d.role], qty: [null, d.qty] } });
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
  const synth = (await tx.query("SELECT column_positions FROM oligo.synthesizer WHERE asset_id = $1", [b.synthesizer_id])).rows[0];
  // what the batch holds or took from each lot (reservations before the run, the stock ledger after), with what the lot still has
  const lots = (
    await tx.query(
      `WITH moved AS (
         SELECT sl.item_id, sl.lot_id, -sum(sl.qty_delta_base) AS used
           FROM inv.stock_ledger sl JOIN inv.stock_document_line dl ON dl.id = sl.document_line_id JOIN inv.stock_document d ON d.id = dl.document_id
          WHERE d.source_entity_type = 'SYNTHESIS_BATCH' AND d.source_entity_id = $1 GROUP BY sl.item_id, sl.lot_id),
       held AS (
         SELECT item_id, lot_id, sum(qty_base - qty_consumed) AS held FROM inv.reservation
          WHERE demand_entity_type = 'SYNTHESIS_BATCH' AND demand_entity_id = $1 AND status = 'ACTIVE' GROUP BY item_id, lot_id)
       SELECT coalesce(m.item_id, h.item_id) AS item_id, coalesce(m.lot_id, h.lot_id) AS lot_id, coalesce(m.used, 0)::float AS used, coalesce(h.held, 0)::float AS held,
              i.code AS item_code, i.name AS item_name, i.base_uom, i.item_type, l.code AS lot_code, l.expiry_date,
              (SELECT coalesce(sum(qty_on_hand), 0) FROM inv.stock_balance WHERE lot_id = coalesce(m.lot_id, h.lot_id))::float AS on_hand,
              pu.port_no, pu.role AS port_role
         FROM moved m FULL JOIN held h ON h.item_id = m.item_id AND h.lot_id IS NOT DISTINCT FROM m.lot_id
         JOIN master.item i ON i.id = coalesce(m.item_id, h.item_id) LEFT JOIN inv.lot l ON l.id = coalesce(m.lot_id, h.lot_id)
         LEFT JOIN oligo.batch_port_use pu ON pu.batch_id = $1 AND pu.lot_id = coalesce(m.lot_id, h.lot_id)
        WHERE coalesce(m.used, 0) <> 0 OR coalesce(h.held, 0) <> 0
        ORDER BY i.item_type, i.code, l.code`,
      [id]
    )
  ).rows;
  return { ...b, column_positions: synth?.column_positions ?? null, positions, reagents, lots, actions: await listAllowedActions(tx, batchMachine, actor, b) };
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

const timesSchema = z.object({
  version: z.number().int().min(0),
  started_at: z.string().datetime({ offset: true }).optional().nullable(),
  finished_at: z.string().datetime({ offset: true }).optional().nullable(),
  reason: z.string().trim().min(3, "nhập lý do sửa giờ"),
});

/** Corrects the recorded run times (e.g. entered after the fact). Never in the future, start before end; audited old → new. */
export async function editBatchTimes(tx: Tx, actor: AuthzActor, id: string, input: unknown) {
  const d = parseInput(timesSchema, input);
  const b = (await tx.query("SELECT * FROM oligo.synthesis_batch WHERE id = $1 FOR UPDATE", [id])).rows[0];
  if (!b) throw notFound("mẻ tổng hợp");
  await authorize(tx, actor, "oligo.batch.manage", b.org_unit_id);
  if (b.version !== d.version) throw invalid("Mẻ vừa thay đổi. Tải lại.", undefined, "STALE_VERSION");
  if (!["RUNNING", "COMPLETED", "ABORTED"].includes(b.status)) throw invalid("Chỉ sửa giờ của mẻ đã bắt đầu chạy.");
  const started = d.started_at === undefined ? b.started_at : d.started_at ? new Date(d.started_at) : null;
  const finished = b.status === "RUNNING" ? null : d.finished_at === undefined ? b.finished_at : d.finished_at ? new Date(d.finished_at) : null;
  const now = Date.now() + 60_000;
  if (!started) throw invalid("Mẻ đã chạy phải có giờ bắt đầu.");
  if (started.getTime() > now || (finished && finished.getTime() > now)) throw invalid("Giờ không được ở tương lai.");
  if (finished && finished < started) throw invalid("Giờ kết thúc phải sau giờ bắt đầu.");
  if (b.status !== "RUNNING" && !finished) throw invalid("Mẻ đã kết thúc phải có giờ kết thúc.");
  await tx.query("UPDATE oligo.synthesis_batch SET started_at = $2, finished_at = $3, version = version + 1, updated_at = now(), updated_by = $4 WHERE id = $1", [id, started, finished, actor.userId]);
  await writeAudit(tx, actor, {
    entityType: "synthesis_batch",
    entityId: id,
    action: "edit_times",
    changes: { started_at: [b.started_at, started], finished_at: [b.finished_at, finished] },
    reason: d.reason,
  });
}

import { z } from "zod/v3";
import type { Tx } from "../core/db";
import { writeAudit } from "../core/audit";
import { authorize, authorizeAnywhere, type AuthzActor } from "../core/authz";
import { invalid, notFound } from "../core/errors";
import { parseInput } from "../core/records";
import { listAllowedActions } from "../core/stateMachine";
import { findCandidates } from "../inv/allocation";
import { autoReleaseNonQcPreparations } from "../prep/service";
import { batchMachine } from "./batches";
import { visibleOligoUnits } from "./orders";

/**
 * Matches an Oligo synthesis reagent role (`dA`, `dC`, `dG`, `dT`, `rA`, `rC`, `rG`, `rU`,
 * `DEBLOCK`, `CAP_A`, `CAP_B`, `OXIDATION`, `ACTIVATOR`, `ACN`, `ALKYL`) against a candidate
 * warehouse item or prepared reagent formula output (`code` / `name` / `formula_code` / `formula_name`).
 * Returns a relevance score (`> 0` if matched, `0` if unrelated).
 */
export function scoreItemForReagentRole(
  role: string,
  cand: { code: string; name: string; formula_code?: string | null; formula_name?: string | null }
): number {
  const r = role.trim();
  const codeU = (cand.code || "").trim().toUpperCase();
  const nameL = `${cand.name || ""} ${cand.formula_name || ""}`.toLowerCase();
  const fCodeU = (cand.formula_code || "").trim().toUpperCase();
  const isPreparedOut = Boolean(fCodeU) || codeU.endsWith("-OUT") || codeU.startsWith("STO");

  if (codeU === r.toUpperCase()) return 100;

  switch (r) {
    case "dA":
      if (/\b(amidite\s*da|da\s*0\.1\s*m|da[-\s]*amidite|da[-\s]*phosphoramidite|da[-\s]*ce)\b/i.test(nameL) && !/\b(powder|bột|lna|ome)\b/i.test(nameL)) {
        return isPreparedOut ? 95 : 85;
      }
      if (codeU === "STO007-OUT" || fCodeU === "STO007" || fCodeU === "AMIDITE_DIL") return 95;
      if (codeU === "AM1" && /da\b/i.test(nameL)) return 60;
      return 0;
    case "dC":
      if (/\b(amidite\s*dc|dc\s*0\.1\s*m|dc[-\s]*amidite|dc[-\s]*phosphoramidite|dc[-\s]*ce)\b/i.test(nameL) && !/\b(powder|bột|lna|ome|5-me|5mc)\b/i.test(nameL)) {
        return isPreparedOut ? 95 : 85;
      }
      if (codeU === "AM2" && /dc\b/i.test(nameL)) return 60;
      return 0;
    case "dG":
      if (/\b(amidite\s*dg|dg\s*0\.1\s*m|dg[-\s]*amidite|dg[-\s]*phosphoramidite|dg[-\s]*ce)\b/i.test(nameL) && !/\b(powder|bột|lna|ome)\b/i.test(nameL)) {
        return isPreparedOut ? 95 : 85;
      }
      if (codeU === "AM3" && /dg\b/i.test(nameL)) return 60;
      return 0;
    case "dT":
      if (/\b(amidite\s*dt|dt\s*0\.1\s*m|dt[-\s]*amidite|dt[-\s]*phosphoramidite|dt[-\s]*ce)\b/i.test(nameL) && !/\b(powder|bột|lna|ome|inverted)\b/i.test(nameL)) {
        return isPreparedOut ? 95 : 85;
      }
      if (codeU === "AM4" && /dt\b/i.test(nameL)) return 60;
      return 0;
    case "rA":
      if (/\b(amidite\s*ra|ra\s*0\.1\s*m|ra[-\s]*amidite|ra[-\s]*phosphoramidite)\b/i.test(nameL) && !/\b(powder|bột)\b/i.test(nameL)) {
        return isPreparedOut ? 95 : 85;
      }
      return 0;
    case "rC":
      if (/\b(amidite\s*rc|rc\s*0\.1\s*m|rc[-\s]*amidite|rc[-\s]*phosphoramidite)\b/i.test(nameL) && !/\b(powder|bột)\b/i.test(nameL)) {
        return isPreparedOut ? 95 : 85;
      }
      return 0;
    case "rG":
      if (/\b(amidite\s*rg|rg\s*0\.1\s*m|rg[-\s]*amidite|rg[-\s]*phosphoramidite)\b/i.test(nameL) && !/\b(powder|bột)\b/i.test(nameL)) {
        return isPreparedOut ? 95 : 85;
      }
      return 0;
    case "rU":
      if (/\b(amidite\s*ru|ru\s*0\.1\s*m|ru[-\s]*amidite|ru[-\s]*phosphoramidite)\b/i.test(nameL) && !/\b(powder|bột)\b/i.test(nameL)) {
        return isPreparedOut ? 95 : 85;
      }
      return 0;
    case "DEBLOCK":
      if (/\b(deblock|deblocking|3%\s*tca|tca\s*3%|tca\s*in\s*dcm|tca\/dcm)\b/i.test(nameL)) {
        return isPreparedOut ? 95 : 85;
      }
      return 0;
    case "CAP_A":
      if (/\b(cap\s*[-_]?a\b|capping\s*a\b)/i.test(nameL)) {
        return isPreparedOut ? 95 : 85;
      }
      return 0;
    case "CAP_B":
      if (/\b(cap\s*[-_]?b\b|capping\s*b\b|10%\s*nmi|nmi\s*in\s*thf)/i.test(nameL)) {
        return isPreparedOut ? 95 : 85;
      }
      return 0;
    case "OXIDATION":
      if (/\b(oxid|iodine\s*0\.0[1-5]\s*m|0\.0[1-5]\s*m\s*iodine|dung\s*dịch\s*i2|dung\s*dich\s*i2|oxi\s*hóa)/i.test(nameL)) {
        return isPreparedOut ? 95 : 85;
      }
      return 0;
    case "ACTIVATOR":
      if (/\b(activator|ett\s*0\.25\s*m|0\.25\s*m\s*ett|dung\s*dịch\s*ett|hoạt\s*hóa\s*amidite)\b/i.test(nameL)) {
        return isPreparedOut ? 95 : 85;
      }
      return 0;
    case "ACN":
      if (/\b(acetonitrile|acn\b)/i.test(nameL) && !/\b(amidite|ett|0\.1\s*m|0\.25\s*m|buffer|teaa)\b/i.test(nameL)) {
        return codeU === "LC9" ? 95 : 85;
      }
      return 0;
    case "ALKYL":
      if (/\b(alkyl\s*amidite|alkyl\s*phosphoramidite|alkyne\s*amidite)\b/i.test(nameL)) {
        return isPreparedOut ? 95 : 85;
      }
      return 0;
    default:
      return 0;
  }
}

/**
 * Automatically synchronizes Oligo synthesis reagent rules (`oligo.reagent_rule`) and unconfigured synthesizer ports (`oligo.synth_port`):
 * 1. Releases any in-house prepared reagent lots in `KHO-OLIGO` whose formula has `requires_qc = false` that were left in `QUARANTINE`.
 * 2. When a reagent rule is still pointing to an empty placeholder item (0 available stock in Oligo warehouses), checks if `KHO-OLIGO`
 *    has a stocked item or prepared formula output item matching that role (e.g. `STO007-OUT · Amidite dA 0.1M` for `dA`, `LC9 · Acetonitrile` for `ACN`,
 *    `STO004-OUT · ETT 0.25M` for `ACTIVATOR`) and updates the rule to point to the real stocked item.
 */
export async function autoSyncOligoReagentMappings(tx: Tx, actor: AuthzActor, orgUnitId?: string | null) {
  await autoReleaseNonQcPreparations(tx, actor, "OLIGO");

  const warehouses: string[] = orgUnitId
    ? (
        await tx.query(
          "SELECT id FROM master.warehouse WHERE (owner_org_unit_id = $1 OR owner_org_unit_id IS NULL OR code = 'KHO-OLIGO') AND status = 'ACTIVE'",
          [orgUnitId]
        )
      ).rows.map((r) => r.id as string)
    : (
        await tx.query(
          `SELECT w.id
             FROM master.warehouse w
             LEFT JOIN core.org_unit ou ON ou.id = w.owner_org_unit_id
            WHERE w.status = 'ACTIVE'
              AND (w.code = 'KHO-OLIGO' OR w.purpose = 'OLIGO' OR ou.code = 'P-OLIGO' OR ou.module_key = 'OLIGO')`
        )
      ).rows.map((r) => r.id as string);

  if (warehouses.length === 0) return;

  const rules = (
    await tx.query(
      `SELECT r.role, r.name, r.uom, r.item_id, i.code AS item_code
         FROM oligo.reagent_rule r
         LEFT JOIN master.item i ON i.id = r.item_id
        WHERE r.status = 'ACTIVE'`
    )
  ).rows as { role: string; name: string; uom: string; item_id: string | null; item_code: string | null }[];

  // Candidate items with positive released stock in Oligo warehouses or defined as OLIGO prep formula outputs
  const candidateItems = (
    await tx.query(
      `WITH stock AS (
         SELECT b.item_id, coalesce(sum(b.qty_on_hand - b.qty_reserved), 0)::float AS avail
           FROM inv.stock_balance b
           JOIN inv.lot l ON l.id = b.lot_id
           JOIN master.location loc ON loc.id = b.location_id
          WHERE loc.warehouse_id = ANY($1::uuid[])
            AND NOT loc.is_quarantine
            AND l.status = 'RELEASED'
            AND (l.expiry_date IS NULL OR l.expiry_date >= current_date)
          GROUP BY b.item_id
       ),
       f_out AS (
         SELECT DISTINCT ON (f.output_item_id) f.output_item_id AS item_id, f.code AS formula_code, f.name AS formula_name
           FROM prep.formula f
          WHERE f.dept_scope = 'OLIGO' AND f.status = 'ACTIVE'
          ORDER BY f.output_item_id, f.code
       )
       SELECT i.id, i.code, i.name, i.base_uom, coalesce(s.avail, 0)::float AS avail, fo.formula_code, fo.formula_name
         FROM master.item i
         LEFT JOIN stock s ON s.item_id = i.id
         LEFT JOIN f_out fo ON fo.item_id = i.id
        WHERE i.status = 'ACTIVE'
          AND (coalesce(s.avail, 0) > 0 OR fo.item_id IS NOT NULL)`,
      [warehouses]
    )
  ).rows as {
    id: string;
    code: string;
    name: string;
    base_uom: string;
    avail: number;
    formula_code: string | null;
    formula_name: string | null;
  }[];

  if (candidateItems.length === 0) return;

  const availById = new Map<string, number>();
  for (const c of candidateItems) availById.set(c.id, Number(c.avail));

  const DEFAULT_PLACEHOLDER_CODES = new Set([
    "DA",
    "DC",
    "DG",
    "DT",
    "RA",
    "RC",
    "RG",
    "RU",
    "DEBLOCK",
    "CAP_A",
    "CAP_B",
    "OXIDATION",
    "ACTIVATOR",
    "ACN",
    "ALKYL",
    "ALKYL-AMIDITE",
  ]);

  for (const r of rules) {
    if (!r.item_id) continue; // Keep explicitly unmapped (null) rules unmapped unless mapped by user
    const codeU = (r.item_code || "").trim().toUpperCase();
    const isDefaultPlaceholder = DEFAULT_PLACEHOLDER_CODES.has(codeU) || codeU === r.role.trim().toUpperCase();
    if (!isDefaultPlaceholder) continue;

    const curAvail = availById.get(r.item_id);
    if (curAvail !== undefined && curAvail > 0) continue;
    const cands = await findCandidates(tx, r.item_id, warehouses);
    const totalAvail = cands.reduce((s, c) => s + Number(c.available), 0);
    if (totalAvail > 0) continue;

    let best: { id: string; score: number; avail: number } | null = null;
    for (const c of candidateItems) {
      if (c.id === r.item_id) continue;
      if (c.avail <= 0) continue;
      const score = scoreItemForReagentRole(r.role, c);
      if (score <= 0) continue;
      const rank = score * 1000 + Math.min(999, c.avail);
      const bestRank = best ? best.score * 1000 + Math.min(999, best.avail) : -1;
      if (rank > bestRank) {
        best = { id: c.id, score, avail: c.avail };
      }
    }

    if (best) {
      await tx.query(
        "UPDATE oligo.reagent_rule SET item_id = $2, updated_at = now() WHERE role = $1",
        [r.role, best.id]
      );
      // Also update any synthesizer port for this role that has no installed bottle or whose bottle has 0 stock
      const bestCands = await findCandidates(tx, best.id, warehouses);
      const firstLotId = bestCands.find((c) => c.lot_id && Number(c.available) > 0)?.lot_id ?? null;
      await tx.query(
        `UPDATE oligo.synth_port
            SET item_id = $2,
                current_lot_id = COALESCE(current_lot_id, $3),
                installed_at = CASE WHEN current_lot_id IS NULL AND $3::uuid IS NOT NULL THEN now() ELSE installed_at END
          WHERE role = $1 AND (current_lot_id IS NULL OR item_id = $4)`,
        [r.role, best.id, firstLotId, r.item_id]
      );
    }
  }
}

export async function listReagentRules(tx: Tx, actor: AuthzActor) {
  await authorizeAnywhere(tx, actor, "oligo.view");
  await autoSyncOligoReagentMappings(tx, actor);
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

  // Đồng bộ sang các cổng máy tổng hợp đang gắn vai trò này nếu mã hàng thay đổi
  if (cur.item_id !== next.item_id) {
    await tx.query(
      `UPDATE oligo.synth_port p
          SET item_id = $2,
              current_lot_id = CASE
                WHEN p.current_lot_id IS NOT NULL AND EXISTS (SELECT 1 FROM inv.lot l WHERE l.id = p.current_lot_id AND l.item_id = $2)
                THEN p.current_lot_id
                ELSE NULL
              END,
              version = p.version + 1
        WHERE p.role = $1`,
      [role, next.item_id]
    );
  }
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
              (SELECT count(*)::int FROM oligo.synthesis_position p WHERE p.batch_id = b.id) AS position_count,
              ARRAY(
                SELECT DISTINCT o.code
                  FROM oligo.synthesis_position p
                  JOIN oligo.oligo_sequence s ON s.id = p.sequence_id
                  JOIN oligo.oligo_order o ON o.id = s.order_id
                 WHERE p.batch_id = b.id AND o.code IS NOT NULL
                 ORDER BY o.code
              ) AS order_codes
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
      `SELECT p.position_no, p.couplings, p.coupling_efficiency_pct::float AS coupling_efficiency_pct, p.result, p.contamination_warning,
              s.id AS sequence_id, s.code AS sequence_code, s.name, s.oligo_role, s.target_pathogen,
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
  await autoSyncOligoReagentMappings(tx, actor, orgUnitId);
  const sequences = (
    await tx.query(
      `SELECT s.id, s.code, s.name, s.normalized_sequence, s.base_count, s.scale_code, s.purification, s.relation,
              s.oligo_role, s.target_pathogen, s.product_type,
              s.order_id, o.code AS order_code, o.customer_label, o.due_date,
              io.code AS internal_order_code, io.kd_po_code
         FROM oligo.oligo_sequence s
         LEFT JOIN oligo.oligo_order o ON o.id = s.order_id
         LEFT JOIN intake.internal_order io ON io.id = o.internal_order_id
        WHERE s.org_unit_id = $1 AND s.status = 'PENDING'
        ORDER BY o.due_date NULLS LAST, o.code NULLS LAST, s.line_no NULLS LAST, s.code LIMIT 500`,
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
        WHERE (w.owner_org_unit_id = $1 OR w.owner_org_unit_id IS NULL) AND w.status = 'ACTIVE' AND NOT loc.is_quarantine AND i.item_type = 'CONSUMABLE'
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

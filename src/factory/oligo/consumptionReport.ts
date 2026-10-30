import { z } from "zod";
import type { Tx } from "../core/db";
import type { AuthzActor } from "../core/authz";
import { getNumberSetting } from "../core/settings";
import { parseInput } from "../core/records";
import { visibleOligoUnits } from "./orders";

const querySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

/**
 * Reagent consumption of finished batches (as OligoFlow's reports): per item the average (actual / theoretical,
 * actual per coupling) and per batch the variance between the estimate and what was booked. A variance beyond
 * the configured tolerance is flagged — the basis for correcting a consumption rule.
 */
export async function consumptionReport(tx: Tx, actor: AuthzActor, query: unknown) {
  const q = parseInput(querySchema, query);
  const units = await visibleOligoUnits(tx, actor);
  if (units !== "ALL" && !units.length) return { tolerance_pct: 0, average: [], variance: [] };
  const tolerance = await getNumberSetting(tx, "oligo.consumption_variance_pct", 10);
  const params = [units === "ALL" ? null : units, q.from ?? null, q.to ?? null];
  const where = `b.status = 'COMPLETED' AND ($1::uuid[] IS NULL OR b.org_unit_id = ANY($1::uuid[]))
                 AND ($2::date IS NULL OR b.finished_at >= $2::date) AND ($3::date IS NULL OR b.finished_at < $3::date + 1)`;
  const variance = (
    await tx.query(
      `SELECT b.id AS batch_id, b.code AS batch_code, b.finished_at, a.code AS synthesizer_code, i.code AS item_code, i.name AS item_name, i.base_uom, u.role,
              u.est_qty_base::float AS est, u.actual_qty_base::float AS actual, (u.actual_qty_base - u.est_qty_base)::float AS diff,
              CASE WHEN u.est_qty_base > 0 THEN round((u.actual_qty_base - u.est_qty_base) / u.est_qty_base * 100, 1)::float END AS diff_pct,
              p.display_name AS operator_name
         FROM oligo.synthesis_reagent_use u JOIN oligo.synthesis_batch b ON b.id = u.batch_id JOIN asset.asset a ON a.id = b.synthesizer_id
         JOIN master.item i ON i.id = u.item_id LEFT JOIN core.user_profile p ON p.user_id = b.operator_id
        WHERE ${where} AND u.actual_qty_base IS NOT NULL
        ORDER BY b.finished_at DESC, i.code LIMIT 2000`,
      params
    )
  ).rows.map((r) => ({ ...r, flagged: r.diff_pct != null && Math.abs(r.diff_pct) > tolerance }));
  const average = (
    await tx.query(
      `SELECT i.id AS item_id, i.code AS item_code, i.name AS item_name, i.base_uom, string_agg(DISTINCT u.role, ', ') AS roles,
              count(DISTINCT b.id)::int AS batches, sum(u.est_qty_base)::float AS est, sum(u.actual_qty_base)::float AS actual,
              sum((SELECT sum(p.couplings) FROM oligo.synthesis_position p WHERE p.batch_id = b.id))::int AS couplings,
              CASE WHEN sum(u.est_qty_base) > 0 THEN round(sum(u.actual_qty_base) / sum(u.est_qty_base), 4)::float END AS ratio
         FROM oligo.synthesis_reagent_use u JOIN oligo.synthesis_batch b ON b.id = u.batch_id JOIN master.item i ON i.id = u.item_id
        WHERE ${where} AND u.actual_qty_base IS NOT NULL
        GROUP BY i.id ORDER BY i.code`,
      params
    )
  ).rows.map((r) => ({ ...r, per_coupling: r.couplings ? Math.round((r.actual / r.couplings) * 1e4) / 1e4 : null }));
  return { tolerance_pct: tolerance, average, variance };
}

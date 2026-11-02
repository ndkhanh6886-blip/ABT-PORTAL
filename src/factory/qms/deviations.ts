import { z } from "zod";
import type { Tx } from "../core/db";
import { authorize, authorizeAnywhere, hasFactoryPermission, type AuthzActor } from "../core/authz";
import { invalid, notFound } from "../core/errors";
import { parseInput } from "../core/records";
import { listAllowedActions } from "../core/stateMachine";
import { raiseDeviation } from "./incidents";
import { deviationMachine } from "./ncr";

/** Where an incident can point to, and how its department is found (for the reporter's permission scope). */
const SUBJECTS: Record<string, { table: string; unit: string; label: string }> = {
  OLIGO_SEQUENCE: { table: "oligo.oligo_sequence", unit: "org_unit_id", label: "code" },
  SYNTHESIS_BATCH: { table: "oligo.synthesis_batch", unit: "org_unit_id", label: "code" },
  ASSET: { table: "asset.asset", unit: "owner_org_unit_id", label: "code" },
  LOT: { table: "inv.lot", unit: "NULL::uuid", label: "code" },
};

const reportSchema = z.object({
  entity_type: z.enum(["OLIGO_SEQUENCE", "SYNTHESIS_BATCH", "ASSET", "LOT"]),
  entity_code: z.string().trim().max(60).optional().nullable(),
  entity_id: z.string().uuid().optional().nullable(),
  title: z.string().trim().min(3, "nhập tiêu đề").max(200),
  severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
  step_ref: z.string().trim().max(200).optional().nullable(),
  performer_id: z.coerce.number().int().optional().nullable(),
  description: z.string().trim().min(10, "mô tả chi tiết sự cố (ít nhất 10 ký tự)").max(4000),
  // the product itself is affected: an NCR waits for QA's disposition (scrap, rework, resynthesis …)
  product_affected: z.boolean().default(false),
});

/**
 * An operational incident (as OligoFlow's "Báo cáo sự cố"): a deviation on a sequence, a batch, a lot or an instrument,
 * with the step and the person involved; QA is notified and investigates it into a CAPA.
 */
export async function reportIncident(tx: Tx, actor: AuthzActor, input: unknown) {
  const d = parseInput(reportSchema, input);
  if (!d.entity_code && !d.entity_id) throw invalid("nhập mã trình tự / mẻ / lô / thiết bị");
  const s = SUBJECTS[d.entity_type];
  const extraSelect = d.entity_type === "LOT" ? ", item_id" : "";
  const row = d.entity_id
    ? (await tx.query(`SELECT id, ${s.unit} AS unit${extraSelect} FROM ${s.table} WHERE id = $1`, [d.entity_id])).rows[0]
    : (await tx.query(`SELECT id, ${s.unit} AS unit${extraSelect} FROM ${s.table} WHERE upper(${s.label}) = upper($1)`, [d.entity_code])).rows[0];
  if (!row) throw notFound(`đối tượng mã ${d.entity_code ?? d.entity_id}`);
  if (row.unit) {
    await authorize(tx, actor, "qms.deviation.report", row.unit);
  } else {
    await authorizeAnywhere(tx, actor, "qms.deviation.report");
  }
  if (d.performer_id != null && !(await tx.query("SELECT 1 FROM core.user_profile WHERE user_id = $1", [d.performer_id])).rowCount) throw invalid("Nhân sự thực hiện không tồn tại.");
  const r = await raiseDeviation(tx, actor, {
    source_module: d.entity_type === "ASSET" ? "ASSET" : d.entity_type === "LOT" ? "QMS" : "OLIGO",
    entity_type: d.entity_type,
    entity_id: row.id,
    severity: d.severity,
    description: d.description,
    step_ref: d.step_ref ?? null,
    performer_id: d.performer_id ?? null,
    ncr:
      d.entity_type === "LOT" && d.product_affected
        ? { item_id: row.item_id ?? null, lot_id: row.id }
        : d.product_affected && d.entity_type === "OLIGO_SEQUENCE"
          ? {}
          : undefined,
  });
  await tx.query("UPDATE qms.deviation SET title = $2 WHERE id = $1", [r.deviation_id, d.title]);
  return r;
}

const listSchema = z.object({
  status: z.enum(["OPEN", "UNDER_INVESTIGATION", "ACTION_DEFINED", "CLOSED", "ACTIVE"]).default("ACTIVE"),
  q: z.string().trim().max(100).optional(),
});

const SELECT = `SELECT d.*, rp.display_name AS reporter_name, pp.display_name AS performer_name,
        coalesce(sq.code, sb.code, a.code, l.code) AS entity_code, coalesce(sq.name, a.name) AS entity_name,
        (SELECT n.code FROM qms.ncr n WHERE n.deviation_id = d.id LIMIT 1) AS ncr_code
   FROM qms.deviation d
   LEFT JOIN core.user_profile rp ON rp.user_id = d.detected_by LEFT JOIN core.user_profile pp ON pp.user_id = d.performer_id
   LEFT JOIN oligo.oligo_sequence sq ON d.entity_type = 'OLIGO_SEQUENCE' AND sq.id = d.entity_id
   LEFT JOIN oligo.synthesis_batch sb ON d.entity_type = 'SYNTHESIS_BATCH' AND sb.id = d.entity_id
   LEFT JOIN asset.asset a ON d.entity_type = 'ASSET' AND a.id = d.entity_id
   LEFT JOIN inv.lot l ON d.entity_type = 'LOT' AND l.id = d.entity_id`;

/** QA sees every deviation; a reporter without QC rights sees the ones they reported. */
export async function listDeviations(tx: Tx, actor: AuthzActor, query: unknown) {
  const q = parseInput(listSchema, query);
  const qa = await hasFactoryPermission(tx, actor, "qms.qc.view");
  if (!qa) await authorizeAnywhere(tx, actor, "qms.deviation.report");
  const rows = (
    await tx.query(
      `${SELECT}
        WHERE ($1::text = 'ACTIVE' AND d.status <> 'CLOSED' OR d.status = $1)
          AND ($2::boolean OR d.detected_by = $3)
          AND ($4::text IS NULL OR d.code ILIKE $4 OR d.title ILIKE $4 OR d.description ILIKE $4 OR sq.code ILIKE $4 OR sb.code ILIKE $4 OR a.code ILIKE $4)
        ORDER BY d.created_at DESC LIMIT 300`,
      [q.status, qa, actor.userId, q.q ? `%${q.q}%` : null]
    )
  ).rows;
  return Promise.all(rows.map(async (r) => ({ ...r, actions: await listAllowedActions(tx, deviationMachine, actor, r) })));
}

import { z } from "zod/v3";
import type { Tx } from "../core/db";
import { authorize, authorizeAnywhere, hasFactoryPermission, type AuthzActor } from "../core/authz";
import { invalid, notFound } from "../core/errors";
import { parseInput } from "../core/records";
import { listAllowedActions } from "../core/stateMachine";
import { raiseDeviation } from "./incidents";
import { deviationMachine } from "./ncr";

/** Where an incident can point to, and how its department is found (for the reporter's permission scope). */
const SUBJECTS: Record<string, { table: string; unit: string; label: string; defaultModule: string }> = {
  OLIGO_SEQUENCE: { table: "oligo.oligo_sequence", unit: "org_unit_id", label: "code", defaultModule: "OLIGO" },
  SYNTHESIS_BATCH: { table: "oligo.synthesis_batch", unit: "org_unit_id", label: "code", defaultModule: "OLIGO" },
  KIT_ORDER: { table: "kit.production_order", unit: "org_unit_id", label: "code", defaultModule: "KIT" },
  DEVICE_ORDER: { table: "device.device_order", unit: "org_unit_id", label: "code", defaultModule: "DEVICE" },
  DEVICE_UNIT: { table: "device.device_unit", unit: "NULL::uuid", label: "serial_no", defaultModule: "DEVICE" },
  ASSET: { table: "asset.asset", unit: "owner_org_unit_id", label: "code", defaultModule: "ASSET" },
  LOT: { table: "inv.lot", unit: "NULL::uuid", label: "code", defaultModule: "QMS" },
};

const reportSchema = z.object({
  entity_type: z.enum(["OLIGO_SEQUENCE", "SYNTHESIS_BATCH", "KIT_ORDER", "DEVICE_ORDER", "DEVICE_UNIT", "ASSET", "LOT"]),
  entity_code: z.string().trim().max(60).optional().nullable(),
  entity_id: z.string().uuid().optional().nullable(),
  source_module: z.enum(["RD", "KIT", "OLIGO", "DEVICE", "QMS", "ASSET"]).optional().nullable(),
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
  const extraSelect = d.entity_type === "LOT" ? ", item_id" : d.entity_type === "KIT_ORDER" ? ", product_item_id AS item_id, lot_id" : "";
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
    source_module: d.source_module || s.defaultModule,
    entity_type: d.entity_type,
    entity_id: row.id,
    severity: d.severity,
    description: d.description,
    step_ref: d.step_ref ?? null,
    performer_id: d.performer_id ?? null,
    ncr:
      (d.entity_type === "LOT" || d.entity_type === "KIT_ORDER") && d.product_affected
        ? { item_id: row.item_id ?? null, lot_id: d.entity_type === "LOT" ? row.id : row.lot_id ?? null }
        : d.product_affected && (d.entity_type === "OLIGO_SEQUENCE" || d.entity_type === "DEVICE_UNIT" || d.entity_type === "DEVICE_ORDER")
          ? {}
          : undefined,
  });
  await tx.query("UPDATE qms.deviation SET title = $2 WHERE id = $1", [r.deviation_id, d.title]);
  return r;
}

const listSchema = z.object({
  status: z.enum(["OPEN", "UNDER_INVESTIGATION", "ACTION_DEFINED", "CLOSED", "ACTIVE"]).default("ACTIVE"),
  q: z.string().trim().max(100).optional(),
  module_key: z.enum(["ALL", "RD", "KIT", "OLIGO", "DEVICE", "QMS"]).optional().default("ALL"),
});

const SELECT = `SELECT d.*, rp.display_name AS reporter_name, pp.display_name AS performer_name,
        coalesce(sq.code, sb.code, a.code, l.code, ko.code, ks.step_code, dunit.serial_no, dord.code, st.code) AS entity_code,
        coalesce(sq.name, a.name, ko_item.name, dm.name, st.symptom) AS entity_name,
        au.module_key AS asset_module_key,
        lw.module_key AS lot_warehouse_module_key,
        EXISTS (
          SELECT 1 FROM kit.production_order kpo
           WHERE kpo.lot_id = l.id
              OR EXISTS (SELECT 1 FROM kit.lot_genealogy lg WHERE lg.parent_lot_id = l.id OR lg.child_lot_id = l.id)
        ) AS is_kit_lot,
        EXISTS (
          SELECT 1 FROM device.device_unit_component duc WHERE duc.lot_id = l.id
        ) AS is_device_lot,
        (SELECT n.code FROM qms.ncr n WHERE n.deviation_id = d.id LIMIT 1) AS ncr_code
   FROM qms.deviation d
   LEFT JOIN core.user_profile rp ON rp.user_id = d.detected_by
   LEFT JOIN core.user_profile pp ON pp.user_id = d.performer_id
   LEFT JOIN oligo.oligo_sequence sq ON d.entity_type = 'OLIGO_SEQUENCE' AND sq.id = d.entity_id
   LEFT JOIN oligo.synthesis_batch sb ON d.entity_type = 'SYNTHESIS_BATCH' AND sb.id = d.entity_id
   LEFT JOIN asset.asset a ON d.entity_type = 'ASSET' AND a.id = d.entity_id
   LEFT JOIN core.org_unit au ON au.id = a.owner_org_unit_id
   LEFT JOIN inv.lot l ON d.entity_type = 'LOT' AND l.id = d.entity_id
   LEFT JOIN LATERAL (
     SELECT ou.module_key
       FROM inv.stock_balance sb2
       JOIN master.location loc ON loc.id = sb2.location_id
       JOIN master.warehouse w ON w.id = loc.warehouse_id
       JOIN core.org_unit ou ON ou.id = w.owner_org_unit_id
      WHERE sb2.lot_id = l.id
      ORDER BY sb2.qty_on_hand DESC
      LIMIT 1
   ) lw ON true
   LEFT JOIN kit.production_order ko ON d.entity_type = 'KIT_ORDER' AND ko.id = d.entity_id
   LEFT JOIN master.item ko_item ON ko_item.id = ko.product_item_id
   LEFT JOIN kit.production_step ks ON d.entity_type = 'KIT_STEP' AND ks.id = d.entity_id
   LEFT JOIN device.device_unit dunit ON d.entity_type = 'DEVICE_UNIT' AND dunit.id = d.entity_id
   LEFT JOIN device.device_order dord ON (d.entity_type = 'DEVICE_ORDER' AND dord.id = d.entity_id) OR (d.entity_type = 'DEVICE_UNIT' AND dord.id = dunit.order_id)
   LEFT JOIN device.device_model dm ON dm.id = dord.model_id
   LEFT JOIN device.service_ticket st ON d.entity_type = 'SERVICE_TICKET' AND st.id = d.entity_id`;

function matchesDepartmentModule(r: any, moduleKey: string): boolean {
  if (!moduleKey || moduleKey === "ALL" || moduleKey === "QMS") return true;
  const src = String(r.source_module || "").toUpperCase();
  const et = String(r.entity_type || "").toUpperCase();
  const assetMod = String(r.asset_module_key || "").toUpperCase();
  const lotWhMod = String(r.lot_warehouse_module_key || "").toUpperCase();

  // Backfill cascade quarantine or lot deviations that originated from Kit genealogy
  const effectiveModule =
    src === "KIT" || et === "KIT_ORDER" || et === "KIT_STEP" || r.step_ref === "CASCADE_QUARANTINE_360" || (et === "LOT" && r.is_kit_lot)
      ? "KIT"
      : src === "DEVICE" || ["DEVICE_UNIT", "DEVICE_ORDER", "SERVICE_TICKET", "SUBCONTRACT_LINE"].includes(et) || (et === "LOT" && r.is_device_lot)
        ? "DEVICE"
        : src === "OLIGO" || ["OLIGO_SEQUENCE", "SYNTHESIS_BATCH"].includes(et)
          ? "OLIGO"
          : src === "RD" || ["SOFTWARE_RELEASE", "RD_PROJECT", "RD_EXPERIMENT"].includes(et)
            ? "RD"
            : et === "ASSET" && assetMod
              ? assetMod
              : et === "LOT" && lotWhMod
                ? lotWhMod
                : src;

  return effectiveModule === moduleKey;
}

/** QA sees every deviation; department views filter to deviations belonging to that department. */
export async function listDeviations(tx: Tx, actor: AuthzActor, query: unknown) {
  const q = parseInput(listSchema, query);
  const qa = await hasFactoryPermission(tx, actor, "qms.qc.view");
  if (!qa) await authorizeAnywhere(tx, actor, "qms.deviation.report");
  const rows = (
    await tx.query(
      `${SELECT}
        WHERE ($1::text = 'ACTIVE' AND d.status <> 'CLOSED' OR d.status = $1)
          AND ($2::boolean OR d.detected_by = $3)
          AND ($4::text IS NULL OR d.code ILIKE $4 OR d.title ILIKE $4 OR d.description ILIKE $4 OR sq.code ILIKE $4 OR sb.code ILIKE $4 OR a.code ILIKE $4 OR l.code ILIKE $4 OR ko.code ILIKE $4 OR dunit.serial_no ILIKE $4 OR dord.code ILIKE $4)
        ORDER BY d.created_at DESC LIMIT 300`,
      [q.status, qa, actor.userId, q.q ? `%${q.q}%` : null]
    )
  ).rows;
  const filtered = rows.filter((r) => matchesDepartmentModule(r, q.module_key));
  return Promise.all(filtered.map(async (r) => ({ ...r, actions: await listAllowedActions(tx, deviationMachine, actor, r) })));
}

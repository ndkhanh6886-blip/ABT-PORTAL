import type { Tx } from "../core/db";
import type { AuthzActor } from "../core/authz";
import { writeAudit } from "../core/audit";
import { nextNumber } from "../core/numbering";
import { notifyUsers, usersWithPermission } from "../core/notifications";
import { releaseLotReservations } from "../inv/reservations";

export interface RaiseDeviation {
  source_module: string;
  entity_type: string;
  entity_id: string;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  description: string;
  step_ref?: string | null;
  performer_id?: number | null;
  /** Also open an NCR for the affected product / lot. */
  ncr?: { item_id?: string | null; lot_id?: string | null; qty_affected?: number | null };
}

/**
 * Automatically quarantines a lot (`ON_HOLD`), releases active reservations, and writes an audit entry
 * when a QC test fails or an incident/deviation is raised on the lot.
 */
export async function autoHoldLotOnIssue(tx: Tx, actor: AuthzActor, lotId: string, reason: string): Promise<void> {
  const lot = (await tx.query("SELECT id, status FROM inv.lot WHERE id = $1 FOR UPDATE", [lotId])).rows[0];
  if (!lot || !["RELEASED", "PENDING_QC", "QUARANTINE"].includes(lot.status)) return;
  const holdReason = reason.slice(0, 500);
  const res = await tx.query(
    `UPDATE inv.lot
        SET status = 'ON_HOLD', hold_reason = $2, version = version + 1, updated_at = now(), updated_by = $3
      WHERE id = $1 AND status NOT IN ('REJECTED', 'EXPIRED', 'ON_HOLD')`,
    [lotId, holdReason, actor.userId]
  );
  if (res.rowCount) {
    await releaseLotReservations(tx, actor, lotId);
    await writeAudit(tx, actor, {
      entityType: "lot",
      entityId: lotId,
      action: "auto_hold",
      changes: { status: [lot.status, "ON_HOLD"], hold_reason: [null, holdReason] },
      reason: holdReason,
    });
  }
}

/**
 * Automatically locks an instrument/asset when a HIGH or CRITICAL incident/deviation is reported on it.
 */
export async function autoLockAssetOnIssue(
  tx: Tx,
  actor: AuthzActor,
  assetId: string,
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL",
  reason: string
): Promise<void> {
  if (!["HIGH", "CRITICAL"].includes(severity)) return;
  const asset = (await tx.query("SELECT id, status FROM asset.asset WHERE id = $1 FOR UPDATE", [assetId])).rows[0];
  if (asset && asset.status !== "RETIRED") {
    const nextStatus = /hiệu chuẩn|calib/i.test(reason) ? "OUT_OF_CALIBRATION" : "OUT_OF_CALIBRATION";
    await tx.query(
      "UPDATE asset.asset SET status = $2, version = version + 1, updated_at = now(), updated_by = $3 WHERE id = $1",
      [assetId, nextStatus, actor.userId]
    );
    await writeAudit(tx, actor, {
      entityType: "asset",
      entityId: assetId,
      action: "auto_lock_on_deviation",
      changes: { status: [asset.status, nextStatus] },
      reason: reason.slice(0, 500),
    });
  }
  const hasInstrumentTable = (await tx.query("SELECT to_regclass('asset.instrument') AS reg")).rows[0]?.reg;
  if (hasInstrumentTable) {
    await tx.query(
      "UPDATE asset.instrument SET status = 'OUT_OF_CALIBRATION', updated_at = now() WHERE id = $1",
      [assetId]
    );
  }
}

/**
 * Every department reports problems through this one entry point (docs 02 §4.2–4.3): a deviation and,
 * when product is affected, an NCR waiting for a disposition. QA is notified.
 */
export async function raiseDeviation(tx: Tx, actor: AuthzActor, input: RaiseDeviation): Promise<{ deviation_id: string; ncr_id: string | null }> {
  const devCode = await nextNumber(tx, "DEVIATION");
  const dev = (
    await tx.query(
      `INSERT INTO qms.deviation (code, source_module, entity_type, entity_id, step_ref, severity, description, detected_by, performer_id, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $8, $8) RETURNING id`,
      [devCode, input.source_module, input.entity_type, input.entity_id, input.step_ref ?? null, input.severity, input.description, actor.userId, input.performer_id ?? null]
    )
  ).rows[0];
  await writeAudit(tx, actor, { entityType: "deviation", entityId: dev.id, action: "create", changes: { code: [null, devCode], severity: [null, input.severity] } });

  let ncrId: string | null = null;
  if (input.ncr) {
    const ncrCode = await nextNumber(tx, "NCR");
    ncrId = (
      await tx.query(
        `INSERT INTO qms.ncr (code, deviation_id, entity_type, entity_id, item_id, lot_id, qty_affected, description, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9) RETURNING id`,
        [ncrCode, dev.id, input.entity_type, input.entity_id, input.ncr.item_id ?? null, input.ncr.lot_id ?? null, input.ncr.qty_affected ?? null, input.description, actor.userId]
      )
    ).rows[0].id;
    await writeAudit(tx, actor, { entityType: "ncr", entityId: ncrId!, action: "create", changes: { code: [null, ncrCode] } });
  }

  const targetLotId = input.entity_type === "LOT" ? input.entity_id : input.ncr?.lot_id ?? null;
  if (targetLotId) {
    await autoHoldLotOnIssue(tx, actor, targetLotId, `Tạm giữ tự động theo sai lệch ${devCode}: ${input.description}`);
  }
  if (input.entity_type === "ASSET" && input.entity_id) {
    await autoLockAssetOnIssue(tx, actor, input.entity_id, input.severity, `Khóa thiết bị tự động theo sai lệch ${devCode}: ${input.description}`);
  }

  await notifyUsers(tx, await usersWithPermission(tx, "qms.qc.review", null), {
    type: "QMS_DEVIATION",
    title: `Sai lệch mới ${devCode} (${input.severity})`,
    body: input.description.slice(0, 300),
    entityType: "deviation",
    entityId: dev.id,
    link: "/?tab=factory-qa",
    sourceKey: `deviation:${dev.id}`,
  });
  return { deviation_id: dev.id, ncr_id: ncrId };
}

export async function hasOpenNcr(tx: Tx, lotId: string): Promise<boolean> {
  return ((await tx.query("SELECT 1 FROM qms.ncr WHERE lot_id = $1 AND status <> 'CLOSED' LIMIT 1", [lotId])).rowCount ?? 0) > 0;
}

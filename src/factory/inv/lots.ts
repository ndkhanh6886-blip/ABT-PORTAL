import type { Tx } from "../core/db";
import type { AuthzActor } from "../core/authz";
import { addDays, vnToday } from "../core/dates";
import { invalid } from "../core/errors";
import { nextNumber } from "../core/numbering";
import { insertRecord } from "../core/records";
import { defineMachine, runTransition, type Guard } from "../core/stateMachine";
import { releaseLotReservations } from "./reservations";
import "./permissions";

export type LotStatus = "QUARANTINE" | "PENDING_QC" | "RELEASED" | "ON_HOLD" | "REJECTED" | "EXPIRED";

export interface Lot {
  id: string;
  code: string;
  item_id: string;
  status: LotStatus;
  expiry_date: string | null;
  mfg_date: string | null;
  received_date: string;
  version: number;
}

/**
 * Release needs a passing QC result whose analyst is not the releaser. Until the QMS module registers
 * that check (phase 3), release is blocked: a lot is never released without QC evidence.
 */
export const QC_PENDING_GUARD: Guard<Lot> = {
  code: "QC_RESULT",
  message: "Chưa có phiếu QC đạt cho lô này (phân hệ QC chưa được kích hoạt).",
  check: () => false,
};
const releaseGuards: Guard<Lot>[] = [QC_PENDING_GUARD];
const unholdGuards: Guard<Lot>[] = [];

/** Called by the QMS module: replaces the placeholder with the real QC / NCR checks. */
export function registerLotQualityGuards(guards: { release: Guard<Lot>[]; unhold: Guard<Lot>[] }): void {
  releaseGuards.splice(0, releaseGuards.length, ...guards.release);
  unholdGuards.splice(0, unholdGuards.length, ...guards.unhold);
}

export const lotMachine = defineMachine<LotStatus, Lot>({
  entityType: "lot",
  table: "inv.lot",
  states: ["QUARANTINE", "PENDING_QC", "RELEASED", "ON_HOLD", "REJECTED", "EXPIRED"],
  terminal: ["REJECTED", "EXPIRED"],
  transitions: [
    {
      action: "skip_qc",
      from: "QUARANTINE",
      to: "RELEASED",
      permission: "inv.lot.system",
      guards: [
        {
          code: "QC_REQUIRED",
          message: "Vật tư này bắt buộc kiểm tra QC trước khi dùng.",
          check: async ({ tx, row }) =>
            !(await tx.query("SELECT receipt_qc_required FROM master.item WHERE id = $1", [row.item_id])).rows[0].receipt_qc_required,
        },
      ],
    },
    { action: "sample", from: "QUARANTINE", to: "PENDING_QC", permission: "inv.lot.sample" },
    { action: "release", from: "PENDING_QC", to: "RELEASED", permission: "inv.lot.release", signature: "RELEASED", guards: releaseGuards },
    { action: "reject", from: ["PENDING_QC", "ON_HOLD"], to: "REJECTED", permission: "inv.lot.reject", reasonRequired: true },
    {
      action: "hold",
      from: "RELEASED",
      to: "ON_HOLD",
      permission: "inv.lot.hold",
      reasonRequired: true,
      effects: ({ tx, actor, row }) => releaseLotReservations(tx, actor, row.id),
    },
    { action: "unhold", from: "ON_HOLD", to: "RELEASED", permission: "inv.lot.release", signature: "RELEASED", guards: unholdGuards },
    {
      action: "expire",
      from: "RELEASED",
      to: "EXPIRED",
      permission: "inv.lot.system",
      guards: [{ code: "NOT_EXPIRED", message: "Lô chưa hết hạn.", check: ({ row, payload }) => row.expiry_date != null && row.expiry_date < String(payload.today ?? vnToday()) }],
      effects: ({ tx, actor, row }) => releaseLotReservations(tx, actor, row.id),
    },
  ],
});

/** Expiry = manufacturing date + shelf life; fixed when the lot is created. */
export function computeExpiry(mfgDate: string, shelfLifeDays: number | null | undefined): string | null {
  return shelfLifeDays ? addDays(mfgDate, shelfLifeDays) : null;
}

/**
 * Creates a lot in QUARANTINE (receipts, production output, preparations). Module-internal: the
 * calling module has already authorised its own business action.
 */
export async function createLot(
  tx: Tx,
  actor: AuthzActor,
  input: {
    item_id: string;
    origin: "PURCHASE" | "PRODUCTION" | "PREPARATION" | "SYNTHESIS" | "RETURN" | "OPENING";
    sequence_key?: string;
    code?: string;
    mfr_lot_no?: string | null;
    supplier_id?: string | null;
    mfg_date?: string | null;
    expiry_date?: string | null;
    origin_entity_type?: string | null;
    origin_entity_id?: string | null;
  }
): Promise<Lot> {
  const item = (await tx.query("SELECT tracking, shelf_life_days, code FROM master.item WHERE id = $1", [input.item_id])).rows[0];
  if (!item) throw invalid("Vật tư không tồn tại.");
  if (item.tracking === "NONE") throw invalid(`Vật tư ${item.code} không quản lý theo lô.`);
  if (input.origin === "PURCHASE" && item.tracking === "LOT" && (!input.mfr_lot_no || !input.expiry_date)) {
    throw invalid(`Nhận hàng ${item.code}: bắt buộc nhập số lô nhà sản xuất và hạn dùng.`);
  }
  const expiry = input.expiry_date ?? (input.mfg_date ? computeExpiry(input.mfg_date, item.shelf_life_days) : null);
  const code = input.code ?? (await nextNumber(tx, input.sequence_key ?? "LOT_RECEIVED"));
  return insertRecord<Lot>(tx, actor, "inv.lot", "lot", {
    code,
    item_id: input.item_id,
    mfr_lot_no: input.mfr_lot_no ?? null,
    supplier_id: input.supplier_id ?? null,
    mfg_date: input.mfg_date ?? null,
    expiry_date: expiry,
    origin: input.origin,
    origin_entity_type: input.origin_entity_type ?? null,
    origin_entity_id: input.origin_entity_id ?? null,
  });
}

/** Daily job: RELEASED lots past their expiry date become EXPIRED (blocks any further issue). */
export async function expireLots(tx: Tx, systemActor: AuthzActor, today = vnToday()): Promise<string[]> {
  const due = await tx.query(
    "SELECT id, version FROM inv.lot WHERE status = 'RELEASED' AND expiry_date < $1 ORDER BY id FOR UPDATE SKIP LOCKED",
    [today]
  );
  const expired: string[] = [];
  for (const lot of due.rows) {
    await runTransition(tx, lotMachine, systemActor, { id: lot.id, action: "expire", expectedVersion: lot.version, payload: { today } });
    expired.push(lot.id);
  }
  return expired;
}

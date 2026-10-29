import { createOrgUnit, createUser, grant } from "../../__tests__/helpers";
import { SYSTEM_ACTOR, type AuthzActor } from "../../core/authz";
import { withTransaction } from "../../core/db";
import { runTransition } from "../../core/stateMachine";
import { createItem, createLocation, createWarehouse } from "../../master/service";
import { createStockDocument, postStockDocument } from "../documents";
import { createLot, lotMachine, type Lot } from "../lots";

export const ALL_INV = [
  "master.data.view",
  "master.item.manage",
  "master.partner.manage",
  "master.warehouse.manage",
  "inv.stock.view",
  "inv.document.create",
  "inv.document.post",
  "inv.document.reverse",
  "inv.reservation.manage",
  "inv.lot.sample",
  "inv.lot.release",
  "inv.lot.hold",
  "inv.lot.reject",
];

export interface Site {
  admin: AuthzActor;
  dept: string;
  warehouse: string;
  quarantine: string;
  shelf: string;
  shelf2: string;
}

const rnd = () => Math.random().toString(36).slice(2, 7).toUpperCase();

/** A department with one warehouse: a quarantine location and two normal shelves. */
export async function makeSite(): Promise<Site> {
  const admin = await createUser("Thủ kho");
  await grant(admin, ALL_INV);
  const dept = await createOrgUnit("KIT");
  return withTransaction(async (tx) => {
    const wh = await createWarehouse(tx, admin, { code: `WH-${rnd()}`, name: "Kho NVL", owner_org_unit_id: dept, purpose: "RAW" });
    const q = await createLocation(tx, admin, { warehouse_id: wh.id, code: "BT", name: "Biệt trữ", is_quarantine: true });
    const a = await createLocation(tx, admin, { warehouse_id: wh.id, code: "A1", name: "Kệ A1" });
    const b = await createLocation(tx, admin, { warehouse_id: wh.id, code: "A2", name: "Kệ A2" });
    return { admin, dept, warehouse: wh.id, quarantine: q.id, shelf: a.id, shelf2: b.id };
  });
}

export async function makeItem(site: Site, over: Record<string, unknown> = {}) {
  return withTransaction((tx) =>
    createItem(tx, site.admin, { name: `Hóa chất ${rnd()}`, item_type: "REAGENT", base_uom: "µL", receipt_qc_required: false, ...over })
  );
}

/** Lot received into quarantine with `qty` µL, then released (skip QC) and moved to a shelf. */
export async function stockedLot(site: Site, itemId: string, qty: number, expiry: string | null, opts: { release?: boolean; shelf?: string } = {}) {
  return withTransaction(async (tx) => {
    const lot = await createLot(tx, site.admin, {
      item_id: itemId,
      origin: "OPENING",
      expiry_date: expiry,
    });
    const rec = await createStockDocument(tx, site.admin, {
      doc_type: "RECEIPT",
      reason_code: "OPENING",
      warehouse_id: site.warehouse,
      lines: [{ item_id: itemId, lot_id: lot.id, to_location_id: site.quarantine, qty, uom: "µL" }],
    });
    await postStockDocument(tx, site.admin, rec.id, rec.version);
    if (opts.release === false) return lot;
    const released = await runTransition<any, Lot>(tx, lotMachine, SYSTEM_ACTOR, { id: lot.id, action: "skip_qc", expectedVersion: lot.version });
    const move = await createStockDocument(tx, site.admin, {
      doc_type: "TRANSFER",
      reason_code: "PUTAWAY",
      warehouse_id: site.warehouse,
      lines: [{ item_id: itemId, lot_id: lot.id, from_location_id: site.quarantine, to_location_id: opts.shelf ?? site.shelf, qty, uom: "µL" }],
    });
    await postStockDocument(tx, site.admin, move.id, move.version);
    return released;
  });
}

export async function issue(site: Site, actor: AuthzActor, itemId: string, lotId: string, qty: number, extra: Record<string, unknown> = {}) {
  return withTransaction(async (tx) => {
    const doc = await createStockDocument(tx, actor, {
      doc_type: "ISSUE",
      reason_code: "PRODUCTION",
      warehouse_id: site.warehouse,
      lines: [{ item_id: itemId, lot_id: lotId, from_location_id: site.shelf, qty, uom: "µL", ...extra }],
    });
    return postStockDocument(tx, actor, doc.id, doc.version);
  });
}
